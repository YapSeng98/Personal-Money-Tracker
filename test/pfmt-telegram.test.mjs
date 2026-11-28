#!/usr/bin/env node
/*
 * Quick add from Telegram (supabase/functions/pfmt-telegram), under a stubbed
 * Deno and a stubbed Supabase and Telegram.
 *
 *   • reading a message: the amount, the description, money in or out, an
 *     account hint, and messages with no amount;
 *   • choosing the account (the hint, else what was used before, else the
 *     usual one) and the category (what was used before for the same thing);
 *   • the webhook: refused without Telegram's secret; a chat linked to no
 *     account, or to two, adds nothing; a message is logged in the right
 *     account and currency with today's date and is replied to; undo takes
 *     the last one back; setup registers the webhook only for a signed-in user.
 */
import { parseQuickAdd, chooseAccount, chooseCategory, webhookSecret } from '../supabase/functions/pfmt-telegram/parse.js';

let pass = 0, fail = 0;
const ok = (c, name, detail) => { if (c) { pass++; return; } fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); };
console.log('\npfmt-telegram, running under a stubbed Deno\n');

// ── reading a message ──
const P = t => parseQuickAdd(t);
const same = (got, want) => JSON.stringify(got) === JSON.stringify(want);
ok(same(P('lunch 12.50'), { type: 'expense', amount: 12.5, description: 'lunch', hint: '' }), 'lunch 12.50', JSON.stringify(P('lunch 12.50')));
ok(same(P('grab 18.40 maybank'), { type: 'expense', amount: 18.4, description: 'grab', hint: 'maybank' }), 'an account after the amount is a hint');
ok(same(P('12.50 kopi and toast'), { type: 'expense', amount: 12.5, description: 'kopi and toast', hint: '' }), 'the amount may come first');
ok(same(P('+4000 salary dbs'), { type: 'income', amount: 4000, description: 'salary dbs', hint: '' }), 'a + makes it money in');
ok(P('got 46 from alex').type === 'income' && P('got 46 from alex').amount === 46, '"got" makes it money in');
ok(P('rent 1,234.50').amount === 1234.5 && P('rent 1,234.50').description === 'rent', 'thousands separators');
ok(P('S$8 coffee').amount === 8 && P('S$8 coffee').description === 'coffee', 'a currency sign before the amount');
ok(P('taxi 18 to the airport via card').hint === 'the airport via card', 'words after the amount go to the hint');
ok(P('hello') === null && P('') === null && P('lunch 0') === null && P('x'.repeat(300) + ' 5') === null, 'no amount, a zero, or a very long message is not logged');
ok(P('lunch 12.505') === null || P('lunch 12.505').amount !== 12.505, 'three decimals are not taken as cents');

// ── choosing the account and category ──
const ACC = [{ name: 'DBS Checking', currency: 'SGD' }, { name: 'Maybank', currency: 'MYR' }, { name: 'UOB Card', currency: 'SGD' }, { name: 'Old', currency: 'SGD', is_active: false }];
const RECENT = [
  { description: 'Grab', category: 'Transport', account: 'UOB Card', type: 'expense' },
  { description: 'grab', category: 'Transport', account: 'UOB Card', type: 'expense' },
  { description: 'Lunch', category: 'Food & Drink', account: 'DBS Checking', type: 'expense' },
  { description: 'Lunch', category: 'Food & Drink', account: 'DBS Checking', type: 'expense' },
  { description: 'Lunch', category: 'Other', account: 'Maybank', type: 'expense' },
  { description: 'Kopi', category: 'Food & Drink', account: 'DBS Checking', type: 'expense' }];
ok(chooseAccount(ACC, RECENT, P('grab 18.40 maybank')).name === 'Maybank', 'the hint picks the account');
ok(chooseAccount(ACC, RECENT, P('grab 18.40 card')).name === 'UOB Card', 'a word of the account name is enough');
ok(chooseAccount(ACC, RECENT, P('grab 18.40')).name === 'UOB Card', 'without a hint, the account used before for the same thing');
ok(chooseAccount(ACC, RECENT, P('books 30')).name === 'DBS Checking', 'otherwise the account used most');
ok(chooseAccount(ACC, RECENT, P('books 30 old')).name !== 'Old', 'a closed account is never used');
ok(chooseAccount([], RECENT, P('books 30')) === null, 'no accounts, no account');
ok(chooseCategory(RECENT, P('lunch 9')) === 'Food & Drink' && chooseCategory(RECENT, P('Grab 9')) === 'Transport' && chooseCategory(RECENT, P('books 9')) === 'Other',
   'the category used most before for the same thing, else Other');

// ── the webhook ──
let handler = null;
const ENV = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', TELEGRAM_BOT_TOKEN: 'bot', PFMT_CRON_SECRET: 'cron-secret' };
globalThis.Deno = { env: { get: k => ENV[k] }, serve: h => { handler = h; } };
const sent = [], inserted = [], deleted = [], hooks = [];
let PREFS = [{ user_id: 'u1', currency: 'SGD' }];
const ADDED = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url), J = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
  if (u.includes('/sendMessage')) { sent.push(JSON.parse(init.body)); return J({ ok: true }); }
  if (u.includes('/setWebhook')) { hooks.push(JSON.parse(init.body)); return J({ ok: true }); }
  if (u.includes('/auth/v1/user')) return init.headers.Authorization === 'Bearer good-jwt' ? J({ id: 'u1' }) : J({}, 401);
  if (u.includes('/rest/v1/preferences')) return J(u.includes('telegram_chat_id=eq.555') ? PREFS : []);
  if (u.includes('/rest/v1/accounts')) return J(ACC);
  if (u.includes('/rest/v1/transactions')) {
    if (init.method === 'POST') { const row = JSON.parse(init.body); inserted.push(row); ADDED.unshift(row); return new Response(null, { status: 201 }); }
    if (init.method === 'DELETE') { deleted.push(u); return new Response(null, { status: 204 }); }
    if (u.includes('notes=eq.')) return J(ADDED.slice(0, 1));
    return J(RECENT);
  }
  throw new Error('unstubbed fetch: ' + u);
};
await import('../supabase/functions/pfmt-telegram/index.ts');
const secret = await webhookSecret('cron-secret');
const tg = (text, chat = 555, s = secret) => handler(new Request('https://fn/pfmt-telegram', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': s },
  body: JSON.stringify({ update_id: 1, message: { chat: { id: chat }, text } }) }));

let r = await tg('lunch 12.50', 555, 'wrong');
ok(r.status === 403 && !inserted.length && !sent.length, 'an update without Telegram\'s secret is refused');
r = await tg('lunch 12.50', 999);
ok(r.status === 200 && !inserted.length && /isn't linked/.test(sent[0].text) && /999/.test(sent[0].text), 'a chat linked to no account adds nothing and says which chat id to enter');
PREFS = [{ user_id: 'u1' }, { user_id: 'u2' }]; sent.length = 0;
await tg('lunch 12.50');
ok(!inserted.length && /more than one/.test(sent[0].text), 'a chat linked to two accounts adds nothing');
PREFS = [{ user_id: 'u1', currency: 'SGD' }]; sent.length = 0;
const realNow = Date.now; Date.now = () => Date.parse('2026-11-27T18:30:00Z');   // 2:30am on the 28th in Singapore
r = await tg('lunch 12.50');
const row = inserted[0];
ok(row && row.user_id === 'u1' && row.type === 'expense' && row.amount === 12.5 && row.description === 'lunch' && row.category === 'Food & Drink'
   && row.account === 'DBS Checking' && row.currency === 'SGD' && row.date === '2026-11-28' && row.notes === 'Added from Telegram' && /^[0-9a-f-]{36}$/.test(row.id),
   'a message is logged in the usual account and category, dated today in Singapore', JSON.stringify(row));
ok(/Logged <b>lunch<\/b> −S\$12\.50/.test(sent[0].text) && /undo/.test(sent[0].text), 'and the reply says what was logged and how to undo it', sent[0].text);
sent.length = 0;
await tg('grab 18.40 maybank');
ok(inserted[1].account === 'Maybank' && inserted[1].currency === 'MYR' && /−RM18\.40/.test(sent[0].text), 'a named account sets the currency');
sent.length = 0;
await tg('<b>gift</b> 20');
ok(/Logged <b>&lt;b&gt;gift&lt;\/b&gt;<\/b>/.test(sent[0].text), 'what you typed is escaped in the reply', sent[0].text);
sent.length = 0;
await tg('hello there');
ok(inserted.length === 3 && /couldn't find an amount/.test(sent[0].text), 'no amount: nothing logged, and it says how');
sent.length = 0;
await tg('undo');
ok(deleted.length === 1 && deleted[0].includes(`id=eq.${ADDED[0].id}`) && deleted[0].includes('user_id=eq.u1') && /Removed/.test(sent[0].text), 'undo removes the last one added here, for this account only');
sent.length = 0;
await tg('/help');
ok(/Quick add to PFMT/.test(sent[0].text) && inserted.length === 3, 'help explains, and logs nothing');
Date.now = realNow;
// setup
const setup = auth => handler(new Request('https://fn/pfmt-telegram', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: auth }, body: JSON.stringify({ action: 'setup' }) }));
r = await setup('Bearer bad');
ok(r.status === 401 && !hooks.length, 'setup refuses someone not signed in');
r = await setup('Bearer good-jwt');
const hook = hooks[0] || {};
ok(r.status === 200 && hook.url === 'https://proj.supabase.co/functions/v1/pfmt-telegram' && hook.secret_token === secret && hook.allowed_updates.join() === 'message',
   'setup registers this function as the bot\'s webhook, with the secret', JSON.stringify(hook));

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} checks passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
