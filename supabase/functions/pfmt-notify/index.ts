// PFMT — pfmt-notify
//
// Sends budget and bill alerts to Telegram. Two ways in, one body of logic:
//
//   • With a signed-in user's JWT — the app calls this right after an expense is
//     recorded, and from the "Send test message" / "Check my alerts now" buttons
//     in Settings. Scope is that one user.
//   • With the x-pfmt-cron-secret header — the nightly pg_cron job calls it with
//     no user present. Scope is every user who has alerts switched on.
//
// The bot token lives only here, as an Edge Function secret. The app never holds
// it: a page served from GitHub Pages cannot keep a secret, and the token is
// shared across every user of the bot, so it belongs on the server side of the
// call. All the app stores is the chat id — an address, which on its own lets
// nobody send anything.
//
// Deploy:  supabase functions deploy pfmt-notify --no-verify-jwt
//   (--no-verify-jwt because the cron path authenticates with its own header
//    rather than a user token; the user path still verifies the JWT below, by
//    hand, before touching anything.)
//
// Secrets it needs:  TELEGRAM_BOT_TOKEN, PFMT_CRON_SECRET
// See TELEGRAM_SETUP.md for the one-time setup.

// The money maths, copied verbatim from index.html — see that file's
// "PFMT SHARED MONEY RULES" block, and tools/sync-shared-rules.js.
import {
  pfmtPrevMonth, pfmtBudgetAlerts, pfmtBillsToRemind
} from './shared-money-rules.js';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
                      Deno.env.get('SUPABASE_SECRET_KEY') ?? '';
const BOT_TOKEN     = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const CRON_SECRET   = Deno.env.get('PFMT_CRON_SECRET') ?? '';

// The book is kept in Singapore time. The cron job fires on a UTC clock, and
// "today" there is still yesterday here for the first eight hours of it — which
// would have reminded about bills a day late, every day.
const TZ_OFFSET_MIN = 480;

const CORS = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-pfmt-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};


// ── plumbing ───────────────────────────────────────────────────────────────

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body),
    { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Service-role REST call. Bypasses RLS by design: the cron path has no user
// session to act as, and every query below is filtered by user_id explicitly.
async function db(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
               'Content-Type': 'application/json', ...(init.headers ?? {}) }
  });
  return res;
}
async function dbGet(path: string) {
  const res = await db(path);
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return await res.json();
}

// Escapes for Telegram's HTML parse mode. Bill names and categories are typed by
// the user, and an unescaped "&" or "<" makes Telegram reject the whole message.
function esc(s: unknown) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const CUR_SYM: Record<string, string> = { SGD: 'S$', USD: 'US$', AUD: 'A$', MYR: 'RM' };
function money(n: number, cur: string) {
  return (CUR_SYM[cur] ?? cur + ' ') +
    Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayInTz() {
  return new Date(Date.now() + TZ_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

// Compares the cron secret without leaking its length or contents through how
// long the comparison takes.
function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sendTelegram(chatId: string, text: string) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML',
                              disable_web_page_preview: true })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    // Telegram's own description is far more useful than the status code —
    // "chat not found" means the user never messaged the bot, which is the
    // single most common thing to get wrong during setup.
    throw new Error(body.description ?? `telegram HTTP ${res.status}`);
  }
  return body;
}

// Claims one alert before it is sent. The primary key on notifications_sent does
// the work: a second attempt at the same key collides, which is how "once per
// month" is enforced even if two runs overlap. Returns false when it was already
// claimed, meaning this alert has already gone out.
async function claim(userId: string, kind: string, key: string) {
  const res = await db('notifications_sent', {
    method : 'POST',
    headers: { Prefer: 'return=minimal' },
    body   : JSON.stringify({ user_id: userId, kind, dedupe_key: key })
  });
  if (res.status === 409) return false;         // already sent
  if (!res.ok) throw new Error(`claim → ${res.status} ${await res.text()}`);
  return true;
}
async function unclaim(userId: string, kind: string, key: string) {
  await db(`notifications_sent?user_id=eq.${userId}&kind=eq.${kind}` +
           `&dedupe_key=eq.${encodeURIComponent(key)}`, { method: 'DELETE' });
}

// ── the work, for one user ─────────────────────────────────────────────────

type Pref = {
  user_id: string; currency: string; telegram_chat_id: string;
  notify_budget: boolean; notify_bills: boolean; bill_lead_days: number;
};

async function runForUser(pref: Pref, mode: string, today: string, month: string) {
  const chat = (pref.telegram_chat_id ?? '').trim();
  if (!chat) return { sent: 0, skipped: 'no chat id' };
  const fallbackCur = pref.currency || 'SGD';

  if (mode === 'test') {
    await sendTelegram(chat,
      '✅ <b>PFMT is connected.</b>\nBudget alerts and bill reminders will arrive here.');
    return { sent: 1 };
  }

  // Rollover looks at the previous month, so the window starts there.
  const from = pfmtPrevMonth(month) + '-01';
  const [txnRows, budgetRows, billRows] = await Promise.all([
    dbGet(`transactions?user_id=eq.${pref.user_id}&date=gte.${from}` +
          `&select=id,type,amount,description,category,account,date,currency,transfer_group`),
    dbGet(`budgets?user_id=eq.${pref.user_id}&select=id,category,amount,alert_pct,currency,rollover`),
    dbGet(`bills?user_id=eq.${pref.user_id}&select=id,name,amount,currency,category,account,due_day,amount_varies,is_active`)
  ]);

  // Into the shape the shared rules expect — the same shape the page holds in
  // state.transactions, so the maths below is the page's maths exactly.
  const txns = (txnRows as Record<string, unknown>[]).map(t => ({
    id: t.id, type: t.type, amount: +(t.amount as number),
    description: t.description, category: t.category, account: t.account,
    date: t.date as string, currency: t.currency, transferGroup: t.transfer_group || ''
  }));
  const budgets = (budgetRows as Record<string, unknown>[]).map(b => ({
    id: b.id, category: b.category, amount: +(b.amount as number),
    alertPct: (b.alert_pct as number) || 80, currency: b.currency, rollover: !!b.rollover
  }));
  const bills = (billRows as Record<string, unknown>[]).map(b => ({
    id: b.id, name: b.name, amount: +(b.amount as number), currency: b.currency,
    category: b.category, account: b.account || '', dueDay: (b.due_day as number) || 1,
    amountVaries: !!b.amount_varies, isActive: b.is_active !== false
  }));

  // Claim first, send after: anything claimed here is in the message, and if the
  // send fails every claim is released so the next run tries again.
  const lines: string[] = [];
  const claimed: Array<[string, string]> = [];

  if (pref.notify_budget) {
    const alerts = pfmtBudgetAlerts(budgets, txns, month, fallbackCur);
    for (const a of alerts) {
      const cur = a.budget.currency || fallbackCur;
      const key = `${a.budget.category}|${cur}|${month}|${a.level}`;
      if (!await claim(pref.user_id, 'budget', key)) continue;
      claimed.push(['budget', key]);
      lines.push(a.level === 'over'
        ? `🔴 <b>${esc(a.budget.category)}</b> is over budget — ${money(a.spent, cur)} of ${money(a.limit, cur)} (${money(a.spent - a.limit, cur)} over)`
        : `🟠 <b>${esc(a.budget.category)}</b> is at ${Math.round(a.pct)}% — ${money(a.spent, cur)} of ${money(a.limit, cur)}, ${money(a.limit - a.spent, cur)} left`);
    }
  }

  if (pref.notify_bills) {
    const lead = Number.isFinite(pref.bill_lead_days) ? pref.bill_lead_days : 3;
    const due  = pfmtBillsToRemind(bills, txns, month, today, lead, fallbackCur);
    for (const d of due) {
      const cur   = d.bill.currency || fallbackCur;
      // Two levels, so a bill gets one heads-up before it is due and one more
      // if it actually goes unpaid — but never a message a day.
      const level = d.days < 0 ? 'overdue' : 'due';
      const key   = `${d.bill.id}|${month}|${level}`;
      if (!await claim(pref.user_id, 'bill', key)) continue;
      claimed.push(['bill', key]);
      const when = d.days < 0  ? `${-d.days} day${d.days === -1 ? '' : 's'} late`
                 : d.days === 0 ? 'due today'
                 : `due in ${d.days} day${d.days === 1 ? '' : 's'}`;
      const amt  = d.bill.amountVaries ? `~${money(d.bill.amount, cur)}` : money(d.bill.amount, cur);
      lines.push(`${d.days < 0 ? '🔴' : '📅'} <b>${esc(d.bill.name)}</b> ${amt} — ${when} (${d.due})`);
    }
  }

  if (!lines.length) return { sent: 0 };

  const header = `<b>PFMT — ${month}</b>`;
  try {
    await sendTelegram(chat, [header, ...lines].join('\n'));
  } catch (e) {
    // Nothing was delivered, so nothing should count as said.
    for (const [kind, key] of claimed) await unclaim(pref.user_id, kind, key);
    throw e;
  }
  return { sent: lines.length };
}

// ── entry point ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST')    return json({ error: 'POST only' }, 405);
  if (!BOT_TOKEN)               return json({ error: 'TELEGRAM_BOT_TOKEN is not set on this function' }, 500);
  if (!SERVICE_KEY)             return json({ error: 'service role key missing from the function environment' }, 500);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const mode = body.mode === 'test' ? 'test' : 'check';

  const cronHeader = req.headers.get('x-pfmt-cron-secret') ?? '';
  const isCron = CRON_SECRET.length > 0 && constantTimeEqual(cronHeader, CRON_SECRET);

  try {
    // ── cron: every user who asked for alerts ──
    if (isCron) {
      const today = todayInTz();
      const month = today.slice(0, 7);
      const prefs = await dbGet(
        'preferences?select=user_id,currency,telegram_chat_id,notify_budget,notify_bills,bill_lead_days' +
        '&telegram_chat_id=neq.&or=(notify_budget.eq.true,notify_bills.eq.true)') as Pref[];
      let sent = 0;
      const failures: string[] = [];
      for (const p of prefs) {
        // One user's bad chat id must not stop everybody else's alerts.
        try { sent += (await runForUser(p, 'check', today, month)).sent; }
        catch (e) { failures.push(`${p.user_id}: ${(e as Error).message}`); }
      }
      return json({ ok: true, users: prefs.length, sent, failures });
    }

    // ── user: verify the JWT, then act only for that user ──
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return json({ error: 'Not signed in' }, 401);
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: auth, apikey: SERVICE_KEY }
    });
    if (!who.ok) return json({ error: 'Session is not valid' }, 401);
    const user = await who.json();
    if (!user?.id) return json({ error: 'Session is not valid' }, 401);

    const prefs = await dbGet(
      `preferences?user_id=eq.${user.id}` +
      '&select=user_id,currency,telegram_chat_id,notify_budget,notify_bills,bill_lead_days') as Pref[];
    if (!prefs.length) return json({ error: 'No preferences row for this account' }, 400);

    // The browser knows the user's real local date; trust it when it looks like
    // one, and fall back to the book's timezone when it does not.
    const today = /^\d{4}-\d{2}-\d{2}$/.test(String(body.today)) ? String(body.today) : todayInTz();
    const month = /^\d{4}-\d{2}$/.test(String(body.month)) ? String(body.month) : today.slice(0, 7);

    const r = await runForUser(prefs[0], mode, today, month);
    return json({ ok: true, ...r });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
