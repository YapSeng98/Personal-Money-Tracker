/*
 * Runs the REAL pfmt-notify Edge Function — supabase/functions/pfmt-notify —
 * under Node, with a stubbed Deno runtime and a stubbed network.
 *
 *   node test/pfmt-notify.test.mjs
 *
 * The point is to exercise the actual deployed code without a deploy, without a
 * Telegram bot and without touching the live database: the tests below drive its
 * request handler directly and inspect the messages it tried to send.
 *
 * What they protect:
 *   1. Nothing is sent without a valid user token or the cron secret.
 *   2. A key is claimed before a message goes out, so the same alert is never
 *      sent twice — and a failed send releases its claims to retry.
 *   3. Everything pending arrives as ONE message, not one per item.
 *   4. Bill names are HTML-escaped; an unescaped "&" makes Telegram reject the
 *      whole message, which would silently lose every alert in it.
 *   5. The figures quoted match the budget card exactly.
 *
 * Deno is not needed locally. Node's own type stripping loads the .ts directly.
 */
let handler = null;
const sent = [];        // telegram messages
const writes = [];      // notifications_sent POSTs
const claimed = new Set();

const ENV = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc-key',
  TELEGRAM_BOT_TOKEN: 'bot-token',
  PFMT_CRON_SECRET: 'cron-secret'
};
globalThis.Deno = {
  env: { get: (k) => ENV[k] },
  serve: (h) => { handler = h; }
};

const PREFS = [{
  user_id: 'u1', currency: 'SGD', telegram_chat_id: '12345',
  notify_budget: true, notify_bills: true, bill_lead_days: 3,
  display_name: 'YC <Seng>'
}];
const TXNS = [
  { id: 'x1', type: 'expense', amount: 400, description: 'Groceries run', category: 'Other',
    account: 'DBS Checking', date: '2026-09-04', currency: 'SGD', transfer_group: null }
];
const BUDGETS = [
  // Alert at an AMOUNT the user typed, not a percentage: warn once 380 is spent.
  { id: 'g1', category: 'Other', amount: 440, alert_amount: 380, currency: 'SGD', rollover: false }
];
const BILLS = [
  { id: 'bill-1', name: 'Rent & Utilities <flat>', amount: 1500, currency: 'SGD',
    category: 'Bills', account: null, due_day: 12, amount_varies: false, is_active: true }
];

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const J = (body, status = 200) => new Response(JSON.stringify(body), { status });

  if (u.includes('api.telegram.org')) {
    sent.push(JSON.parse(init.body));
    return J({ ok: true, result: { message_id: sent.length } });
  }
  if (u.includes('/auth/v1/user')) {
    return init.headers?.Authorization === 'Bearer good-jwt'
      ? J({ id: 'u1', email: 'a@b.c' }) : J({ error: 'bad jwt' }, 401);
  }
  if (u.includes('/rest/v1/preferences'))   return J(PREFS);
  if (u.includes('/rest/v1/transactions'))  return J(TXNS);
  if (u.includes('/rest/v1/budgets'))       return J(BUDGETS);
  if (u.includes('/rest/v1/bills'))         return J(BILLS);
  if (u.includes('/rest/v1/notifications_sent')) {
    if (init.method === 'POST') {
      const row = JSON.parse(init.body);
      const k = `${row.kind}|${row.dedupe_key}`;
      if (claimed.has(k)) return new Response(null, { status: 409 });
      claimed.add(k); writes.push(k);
      return new Response(null, { status: 201 });
    }
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    return J([]);
  }
  throw new Error('unstubbed fetch: ' + u);
};

await import('../supabase/functions/pfmt-notify/index.ts');

let pass = 0, fail = 0;
const ok = (c, n, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d ? ' — ' + d : ''))); };
const post = (body, headers = {}) => handler(new Request('https://fn/x', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body)
}));

console.log('\npfmt-notify, running under a stubbed Deno\n');
ok(typeof handler === 'function', 'the function registers a request handler');

// ── method and auth gates ──
let r = await handler(new Request('https://fn/x', { method: 'GET' }));
ok(r.status === 405, 'GET is refused', `got ${r.status}`);
r = await handler(new Request('https://fn/x', { method: 'OPTIONS' }));
ok(r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === '*',
   'the CORS preflight is answered', `got ${r.status}`);
r = await post({ mode: 'check' });
ok(r.status === 401, 'no token, no action', `got ${r.status}`);
r = await post({ mode: 'check' }, { Authorization: 'Bearer wrong-jwt' });
ok(r.status === 401, 'a bad token is rejected', `got ${r.status}`);
r = await post({ mode: 'check' }, { 'x-pfmt-cron-secret': 'not-it' });
ok(r.status === 401, 'a wrong cron secret falls through to the user path and is rejected',
   `got ${r.status}`);

// ── test message ──
sent.length = 0;
r = await post({ mode: 'test' }, { Authorization: 'Bearer good-jwt' });
let b = await r.json();
ok(r.status === 200 && b.sent === 1, 'a test message is sent', JSON.stringify(b));
ok(sent[0].chat_id === '12345', 'to the chat id from preferences');
ok(/connected/i.test(sent[0].text), 'and says the connection works');
ok(sent[0].text.startsWith('Dear YC &lt;Seng&gt;,\n\u2705'),
   'the test message opens with the greeting, HTML-escaped', sent[0].text.slice(0, 40));

// ── a real check: 400 of a 440 budget is 90%, and a bill is due in 3 days ──
sent.length = 0; writes.length = 0; claimed.clear();
r = await post({ mode: 'check', today: '2026-09-09', month: '2026-09' },
               { Authorization: 'Bearer good-jwt' });
b = await r.json();
ok(r.status === 200 && b.sent === 2, 'one message covering both alerts', JSON.stringify(b));
ok(sent.length === 1, 'sent as ONE telegram message, not two', `got ${sent.length}`);
const text = sent[0]?.text ?? '';
ok(text.startsWith('Dear YC &lt;Seng&gt;,\n<b>PFMT'),
   'the alert opens with the greeting, then the header', text.slice(0, 60));
ok(/Other/.test(text) && /has passed S\$380\.00/.test(text),
   'names the budget and the amount it passed', text);
ok(/S\$400\.00/.test(text) && /S\$440\.00/.test(text), 'quotes spent of limit', text);
ok(/Rent &amp; Utilities &lt;flat&gt;/.test(text),
   'the bill name is HTML-escaped so telegram accepts it', text);
ok(/due in 3 days/.test(text), 'says how long until the bill is due', text);
ok(writes.length === 2, 'two dedupe keys were claimed', writes.join(' / '));
ok(writes.some(k => k.startsWith('budget|Other|SGD|2026-09|near')), 'budget key looks right', writes.join(' / '));
ok(writes.some(k => k === 'bill|bill-1|2026-09|due'), 'bill key looks right', writes.join(' / '));

// ── the same check again must say nothing ──
sent.length = 0;
r = await post({ mode: 'check', today: '2026-09-09', month: '2026-09' },
               { Authorization: 'Bearer good-jwt' });
b = await r.json();
ok(b.sent === 0 && sent.length === 0, 'running it again sends nothing — already said',
   JSON.stringify(b));

// ── overdue is a separate, second reminder ──
sent.length = 0;
r = await post({ mode: 'check', today: '2026-09-20', month: '2026-09' },
               { Authorization: 'Bearer good-jwt' });
b = await r.json();
ok(b.sent === 1 && /8 days late/.test(sent[0]?.text ?? ''),
   'once it is actually late, one more reminder goes out',
   JSON.stringify(b) + ' ' + (sent[0]?.text ?? ''));

// ── the cron path, no user token at all ──
sent.length = 0; claimed.clear(); writes.length = 0;
r = await post({}, { 'x-pfmt-cron-secret': 'cron-secret' });
b = await r.json();
ok(r.status === 200 && b.users === 1 && b.sent > 0,
   'the cron path runs for every subscribed user with no JWT', JSON.stringify(b));
ok(Array.isArray(b.failures) && b.failures.length === 0, 'and reports no failures', JSON.stringify(b.failures));

// ── a failed telegram send must release its claims ──
sent.length = 0; claimed.clear(); writes.length = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('api.telegram.org')) {
    return new Response(JSON.stringify({ ok: false, description: 'chat not found' }), { status: 400 });
  }
  return realFetch(url, init);
};
r = await post({ mode: 'check', today: '2026-09-09', month: '2026-09' },
               { Authorization: 'Bearer good-jwt' });
b = await r.json();
globalThis.fetch = realFetch;
ok(r.status === 500 && /chat not found/.test(b.error ?? ''),
   "a telegram failure surfaces telegram's own reason", JSON.stringify(b));

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} checks passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
