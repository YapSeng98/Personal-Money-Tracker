// PFMT — pfmt-telegram
//
// Quick add from Telegram: message the PFMT bot "lunch 12.50" or "grab 18.40
// maybank" and the transaction is logged in your book; "undo" takes the last
// one back; "help" explains. Two ways in:
//
//   • From Telegram (the bot's webhook). Every update carries the secret set
//     when the webhook was registered (X-Telegram-Bot-Api-Secret-Token); one
//     without it is refused. The chat is matched to the one account whose
//     Settings hold that chat id; a chat matching none, or more than one, is
//     told so and nothing is written.
//   • From the app, with the signed-in user's token and {action: 'setup'}:
//     registers this function as the bot's webhook. Pressed once, in
//     Settings → Alerts → Quick add from Telegram.
//
// Deploy:  supabase functions deploy pfmt-telegram --no-verify-jwt
//   (Telegram sends no Supabase token; the webhook secret and, for setup, the
//    user's token checked below by hand, are what guard it.)
// Secrets: the same TELEGRAM_BOT_TOKEN and PFMT_CRON_SECRET as pfmt-notify.

import { parseQuickAdd, chooseAccount, chooseCategory, webhookSecret, QUICK_ADD_NOTE } from './parse.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? '';
const BOT_TOKEN    = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const CRON_SECRET  = Deno.env.get('PFMT_CRON_SECRET') ?? '';
const TZ_OFFSET_MIN = 480;   // the book is kept in Singapore time

const CORS = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SYM: Record<string, string> = { SGD: 'S$', USD: 'US$', AUD: 'A$', MYR: 'RM', USDT: 'USDT ' };
const money = (n: number, cur: string) => (SYM[cur] ?? cur + ' ') +
  Number(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date(Date.now() + TZ_OFFSET_MIN * 60000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() + TZ_OFFSET_MIN * 60000 - n * 86400000).toISOString().slice(0, 10);

async function db(path: string, init: RequestInit = {}) {
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) }
  });
}
async function dbGet(path: string) {
  const res = await db(path);
  if (!res.ok) throw new Error(`${path.split('?')[0]} → ${res.status}`);
  return await res.json();
}
async function reply(chatId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
}

const HELP = [
  '<b>Quick add to PFMT</b>',
  'Send what and how much, e.g.',
  '• <code>lunch 12.50</code>',
  '• <code>grab 18.40 maybank</code> (an account after the amount)',
  '• <code>+4000 salary</code> or <code>got 46 from alex</code> for money in',
  'The category and account are taken from what you entered before for the same thing.',
  'Send <code>undo</code> to remove the last one added here.'
].join('\n');

async function handleSetup(req: Request) {
  const auth = req.headers.get('Authorization') ?? '';
  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: auth } });
  if (!who.ok) return json({ ok: false, error: 'not signed in' }, 401);
  const secret = await webhookSecret(CRON_SECRET);
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${SUPABASE_URL}/functions/v1/pfmt-telegram`, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: true })
  });
  const out = await res.json().catch(() => ({}));
  return out.ok ? json({ ok: true }) : json({ ok: false, error: out.description || `telegram ${res.status}` }, 502);
}

async function handleMessage(msg: { chat?: { id?: number | string }; text?: string }) {
  const chatId = String(msg?.chat?.id ?? '');
  const text = String(msg?.text ?? '').trim();
  if (!chatId || !text) return json({ ok: true });
  const prefs = await dbGet(`preferences?telegram_chat_id=eq.${encodeURIComponent(chatId)}&select=user_id,currency`);
  if (prefs.length !== 1) {
    await reply(chatId, prefs.length
      ? 'This chat is linked to more than one PFMT account, so nothing was added. Keep the chat id in one account only.'
      : `This chat isn't linked to a PFMT account. In PFMT → Settings → Alerts, enter this chat id: <code>${esc(chatId)}</code>`);
    return json({ ok: true, linked: prefs.length });
  }
  const uid = prefs[0].user_id;
  if (/^\/?(start|help)\b/i.test(text)) { await reply(chatId, HELP); return json({ ok: true }); }

  if (/^\/?undo$/i.test(text)) {
    const last = await dbGet(`transactions?user_id=eq.${uid}&notes=eq.${encodeURIComponent(QUICK_ADD_NOTE)}&created_at=gte.${daysAgo(1)}` +
                             `&select=id,description,amount,currency&order=created_at.desc&limit=1`);
    if (!last.length) { await reply(chatId, 'Nothing added here in the last day to undo.'); return json({ ok: true }); }
    const res = await db(`transactions?id=eq.${last[0].id}&user_id=eq.${uid}`, { method: 'DELETE' });
    await reply(chatId, res.ok ? `↩️ Removed <b>${esc(last[0].description)}</b> ${money(last[0].amount, last[0].currency)}.` : 'Could not remove it just now; try again.');
    return json({ ok: res.ok });
  }

  const parsed = parseQuickAdd(text);
  if (!parsed) { await reply(chatId, "I couldn't find an amount in that. Try <code>lunch 12.50</code>, or send <code>help</code>."); return json({ ok: true, parsed: false }); }
  const [accounts, recent] = await Promise.all([
    dbGet(`accounts?user_id=eq.${uid}&select=name,currency,is_active`),
    dbGet(`transactions?user_id=eq.${uid}&date=gte.${daysAgo(180)}&transfer_group=is.null&select=description,category,account,type&order=date.desc&limit=2000`)
  ]);
  const acc = chooseAccount(accounts, recent, parsed);
  if (!acc) { await reply(chatId, 'Add an account in PFMT first, then try again.'); return json({ ok: true, account: false }); }
  const cur = acc.currency || prefs[0].currency || 'SGD';
  const row = { id: crypto.randomUUID(), user_id: uid, type: parsed.type, amount: parsed.amount, description: parsed.description,
                category: chooseCategory(recent, parsed), account: acc.name, currency: cur, date: today(), notes: QUICK_ADD_NOTE };
  const res = await db('transactions', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
  if (!res.ok) { await reply(chatId, `Not saved (${res.status}). Nothing was added.`); return json({ ok: false, status: res.status }, 200); }
  await reply(chatId, `✅ Logged <b>${esc(row.description)}</b> ${row.type === 'expense' ? '−' : '+'}${money(row.amount, cur)}\n` +
                      `${esc(row.category)} · ${esc(row.account)} · today\nSend <code>undo</code> to remove it.`);
  return json({ ok: true, id: row.id });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!SERVICE_KEY || !BOT_TOKEN || !CRON_SECRET) return json({ error: 'the function is missing a secret' }, 500);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    if (body.action === 'setup') return await handleSetup(req);
    if (req.headers.get('x-telegram-bot-api-secret-token') !== await webhookSecret(CRON_SECRET)) return json({ error: 'forbidden' }, 403);
    return await handleMessage((body.message ?? {}) as { chat?: { id?: number }; text?: string });
  } catch (e) {
    console.error('pfmt-telegram:', e);
    // Telegram retries anything but a 200; a fault is logged, not retried forever.
    return json({ ok: false, error: String((e as Error).message || e) });
  }
});
