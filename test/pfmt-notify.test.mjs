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
ok(sent[0].text.startsWith('Dear YC &lt;Seng&gt;,\n\n\u2705'),
   'the test message opens with the greeting, HTML-escaped', sent[0].text.slice(0, 40));

// ── the manual check: every budget at or past its amount, and bills ──
sent.length = 0; writes.length = 0; claimed.clear();
r = await post({ mode: 'check', today: '2026-09-09', month: '2026-09' },
               { Authorization: 'Bearer good-jwt' });
b = await r.json();
ok(r.status === 200 && b.sent === 2, 'one message covering both alerts', JSON.stringify(b));
ok(sent.length === 1, 'sent as ONE telegram message, not two', `got ${sent.length}`);
const text = sent[0]?.text ?? '';
ok(text.startsWith('Dear YC &lt;Seng&gt;,\n\n<b>PFMT - 9 Sep 2026</b>\n\n<b>SGD</b>\n'),
   'greeting, blank line, dated header, blank line, then the currency section',
   JSON.stringify(text.slice(0, 80)));
ok(/Other/.test(text) && /has passed S\$380\.00/.test(text),
   'names the budget and the amount it passed', text);
ok(/S\$400\.00/.test(text) && /S\$440\.00/.test(text), 'quotes spent of limit', text);
ok(/Rent &amp; Utilities &lt;flat&gt;/.test(text),
   'the bill name is HTML-escaped so telegram accepts it', text);
ok(/due in 3 days/.test(text), 'says how long until the bill is due', text);
// Budgets are no longer limited to once a month, so nothing is claimed for
// them — only the bill, which keeps its limit.
ok(writes.length === 1 && writes[0] === 'bill|bill-1|2026-09|due',
   'only the bill is claimed — budget alerts carry no monthly limit', writes.join(' / '));

// ── pressing it again: the budget repeats, the bill does not ──
sent.length = 0;
r = await post({ mode: 'check', today: '2026-09-09', month: '2026-09' },
               { Authorization: 'Bearer good-jwt' });
b = await r.json();
const again = sent[0]?.text ?? '';
ok(b.sent === 1 && /Other/.test(again) && !/Rent/.test(again),
   'a second check re-sends the budget with its total, but not the bill',
   JSON.stringify(b) + ' ' + again);
ok(Array.isArray(b.already) && b.already.some(x => /Rent/.test(x)) && !b.already.includes('Other'),
   'and names only the bill as already reported', JSON.stringify(b.already));

// ── the expense path: only the category that was just spent in ──
sent.length = 0; writes.length = 0;
r = await post({ mode: 'check', today: '2026-09-09', month: '2026-09',
                 category: 'Other', currency: 'SGD' },
               { Authorization: 'Bearer good-jwt' });
b = await r.json();
const exp1 = sent[0]?.text ?? '';
ok(b.sent === 1 && /Other/.test(exp1) && /has passed S\$380\.00/.test(exp1),
   'an expense in a category past its amount alerts for that category', JSON.stringify(b));
ok(!/Rent/.test(exp1), 'and never drags a bill into it', exp1);
ok(writes.length === 0, 'and claims nothing — it can fire again', writes.join(' / '));

sent.length = 0;
r = await post({ mode: 'check', today: '2026-09-09', month: '2026-09',
                 category: 'Other', currency: 'SGD' },
               { Authorization: 'Bearer good-jwt' });
b = await r.json();
ok(b.sent === 1 && sent.length === 1,
   'the NEXT expense in that category alerts again — every expense that hits',
   JSON.stringify(b));

sent.length = 0;
r = await post({ mode: 'check', today: '2026-09-09', month: '2026-09',
                 category: 'Transport', currency: 'SGD' },
               { Authorization: 'Bearer good-jwt' });
b = await r.json();
ok(b.sent === 0 && sent.length === 0,
   'an expense in a quiet category sends nothing, even while Other is past its amount',
   JSON.stringify(b));

sent.length = 0;
r = await post({ mode: 'check', today: '2026-09-09', month: '2026-09',
                 category: 'Other', currency: 'MYR' },
               { Authorization: 'Bearer good-jwt' });
b = await r.json();
ok(b.sent === 0, 'the same category in another currency is a different budget', JSON.stringify(b));

// ── overdue is a separate, second bill reminder ──
sent.length = 0;
r = await post({ mode: 'check', today: '2026-09-20', month: '2026-09' },
               { Authorization: 'Bearer good-jwt' });
b = await r.json();
ok(/8 days late/.test(sent[0]?.text ?? ''),
   'once a bill is actually late, one more reminder goes out',
   JSON.stringify(b) + ' ' + (sent[0]?.text ?? ''));

// ── the cron path: bills only ──
sent.length = 0; claimed.clear(); writes.length = 0;
r = await post({}, { 'x-pfmt-cron-secret': 'cron-secret' });
b = await r.json();
ok(r.status === 200 && b.users === 1 && b.sent > 0,
   'the cron path runs for every subscribed user with no JWT', JSON.stringify(b));
ok(Array.isArray(b.failures) && b.failures.length === 0, 'and reports no failures', JSON.stringify(b.failures));
ok(!/Other/.test(sent[0]?.text ?? '') && /Rent/.test(sent[0]?.text ?? ''),
   'the daily run sends bills, never a budget with no new expense behind it',
   sent[0]?.text ?? '');

// ── one section per currency, the book's own currency first ──
BUDGETS.push({ id: 'g-myr', category: 'Food & Drink', amount: 600, alert_amount: 500,
               currency: 'MYR', rollover: false });
TXNS.push({ id: 'x-myr', type: 'expense', amount: 540, description: 'Makan', category: 'Food & Drink',
            account: 'Maybank', date: '2026-09-04', currency: 'MYR', transfer_group: null });
sent.length = 0; claimed.clear();
r = await post({ mode: 'check', today: '2026-09-09', month: '2026-09' },
               { Authorization: 'Bearer good-jwt' });
const mixed = sent[0]?.text ?? '';
const sgdAt = mixed.indexOf('<b>SGD</b>'), myrAt = mixed.indexOf('<b>MYR</b>');
ok(sgdAt > 0 && myrAt > sgdAt, 'SGD and MYR get their own sections, SGD first', mixed);
ok(mixed.indexOf('RM540.00') > myrAt && mixed.indexOf('S$400.00') < myrAt,
   'each line sits under its own currency, never mixed', mixed);
ok(/\n\n<b>MYR<\/b>\n/.test(mixed), 'a blank line separates the sections', JSON.stringify(mixed));

// ── the LIVE post-expense path also fires for a non-primary currency ──
// Only the manual check above (no category/currency in the request) was
// proven to include a MYR budget. notifyAfterSpend() — what actually fires
// the moment a user saves an expense in the app — passes { category,
// currency } and index.ts:222-225 filters alerts down to that exact pair.
// That's a different code path with its own filter, so prove it separately
// rather than assuming the manual check's pass covers it too.
sent.length = 0;
r = await post({ mode: 'check', today: '2026-09-09', month: '2026-09',
                 category: 'Food & Drink', currency: 'MYR' },
               { Authorization: 'Bearer good-jwt' });
b = await r.json();
const myrExp = sent[0]?.text ?? '';
ok(/Food &amp; Drink/.test(myrExp) && /RM540\.00/.test(myrExp),
   'a MYR expense triggers its own MYR budget through the live post-save path, not just the manual check',
   JSON.stringify(b) + ' ' + myrExp);

// ── after an expense: the budget just hit first, then the rest already past ──
const justAt = myrExp.indexOf('<b>Just now · MYR</b>');
const alsoAt = myrExp.indexOf('<b>Also past their alert</b>');
ok(justAt > 0 && myrExp.indexOf('RM540.00') > justAt && myrExp.indexOf('RM540.00') < alsoAt,
   'the budget the expense just hit leads the message, under "Just now"', myrExp);
ok(alsoAt > justAt && myrExp.indexOf('<b>SGD</b>') > alsoAt && myrExp.indexOf('S$400.00') > alsoAt,
   'every other budget already past its alert follows below, in its own currency section', myrExp);
ok(myrExp.split('RM540.00').length === 2, 'and the budget just hit is not listed twice', myrExp);
ok(b.sent === 2, 'both lines are counted as sent', JSON.stringify(b));

sent.length = 0;
r = await post({ mode: 'check', today: '2026-09-09', month: '2026-09',
                 category: 'Transport', currency: 'SGD' },
               { Authorization: 'Bearer good-jwt' });
b = await r.json();
ok(b.sent === 0 && sent.length === 0,
   'an expense in a quiet category still sends nothing, even with two budgets past their alert',
   JSON.stringify(b));

sent.length = 0;
r = await post({ mode: 'check', today: '2026-09-09', month: '2026-09',
                 category: 'Other', currency: 'SGD' },
               { Authorization: 'Bearer good-jwt' });
const sgdExp = sent[0]?.text ?? '';
ok(sgdExp.indexOf('<b>Just now · SGD</b>') < sgdExp.indexOf('S$400.00') &&
   sgdExp.indexOf('S$400.00') < sgdExp.indexOf('<b>Also past their alert</b>') &&
   sgdExp.indexOf('<b>Also past their alert</b>') < sgdExp.indexOf('RM540.00'),
   'the same works the other way round: SGD just hit, MYR listed below', sgdExp);

// ── every currency past its alert is listed, not just SGD and MYR ──
BUDGETS.push({ id: 'g-usd', category: 'Travel', amount: 1000, alert_amount: 800, currency: 'USD', rollover: false },
             { id: 'g-aud', category: 'Shopping', amount: 300, alert_amount: 250, currency: 'AUD', rollover: false },
             { id: 'g-aud2', category: 'Health', amount: 500, alert_amount: 400, currency: 'AUD', rollover: false });
TXNS.push({ id: 'x-usd', type: 'expense', amount: 1100, description: 'Flight', category: 'Travel',
            account: 'Wise', date: '2026-09-05', currency: 'USD', transfer_group: null },
          { id: 'x-aud', type: 'expense', amount: 260, description: 'Shoes', category: 'Shopping',
            account: 'CommBank', date: '2026-09-06', currency: 'AUD', transfer_group: null },
          { id: 'x-aud2', type: 'expense', amount: 50, description: 'Pharmacy', category: 'Health',
            account: 'CommBank', date: '2026-09-06', currency: 'AUD', transfer_group: null });
sent.length = 0;
r = await post({ mode: 'check', today: '2026-09-09', month: '2026-09',
                 category: 'Food & Drink', currency: 'MYR' },
               { Authorization: 'Bearer good-jwt' });
b = await r.json();
const allCur = sent[0]?.text ?? '';
const at = s => allCur.indexOf(s);
ok(at('<b>Just now · MYR</b>') > 0 && at('RM540.00') < at('<b>Also past their alert</b>'),
   'with four currencies, the MYR budget just hit still leads', allCur);
ok(at('<b>SGD</b>') > at('<b>Also past their alert</b>') && at('S$400.00') > at('<b>SGD</b>'),
   'SGD is listed below it', allCur);
ok(at('<b>AUD</b>') > 0 && at('A$260.00') > at('<b>AUD</b>'), 'AUD is listed below it', allCur);
ok(at('<b>USD</b>') > 0 && at('US$1,100.00') > at('<b>USD</b>') && /Travel<\/b> is over budget/.test(allCur),
   'USD is listed below it, over budget', allCur);
ok(at('<b>SGD</b>') < at('<b>AUD</b>') && at('<b>AUD</b>') < at('<b>USD</b>'),
   'main currency first, then the rest alphabetically', allCur);
ok(!/Health/.test(allCur), 'a budget still under its alert is left out', allCur);
ok(b.sent === 4, 'all four lines are counted', JSON.stringify(b));
BUDGETS.splice(-3); TXNS.splice(-3);

BUDGETS.pop(); TXNS.pop();

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
