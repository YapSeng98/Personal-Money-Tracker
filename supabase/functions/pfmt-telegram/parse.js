// PFMT — pfmt-telegram: the parts that read a message and choose an account
// and category. Plain JavaScript with no Deno or network, so the tests run it
// under Node exactly as the function runs it.

// "lunch 12.50", "grab 18.40 maybank", "12.50 kopi", "+4000 salary dbs",
// "got 46 from alex", "rent 1,234.50", "S$8 coffee". The first number is the
// amount; words before it are the description (or the words after, when the
// amount comes first); words after it are an account hint. A leading +, or
// "income", "got", "received", makes it income.
const AMOUNT = /(^|\s)([+-]?)(?:S\$|RM|US\$|\$|SGD|MYR|USD|USDT)?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?=\s|$)/i;
const INCOME_WORDS = /^(income|got|received|receive|salary in)\b\s*/i;

export function parseQuickAdd(text) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 200) return null;
  let type = 'expense';
  if (INCOME_WORDS.test(t)) { type = 'income'; t = t.replace(INCOME_WORDS, ''); }
  const m = t.match(AMOUNT);
  if (!m) return null;
  if (m[2] === '+') type = 'income';
  const amount = Number(m[3].replace(/,/g, '') + (m[4] ? '.' + m[4] : ''));
  if (!(amount > 0) || amount > 10000000) return null;
  const at = m.index + m[1].length;
  const before = t.slice(0, at).trim(), after = t.slice(at + m[0].length - m[1].length).trim();
  let description = before, hint = after;
  if (!description) { description = after; hint = ''; }
  description = description.replace(/^(for|on)\s+/i, '').slice(0, 100).trim();
  hint = hint.replace(/^(from|to|on|via|by|with)\s+/i, '').trim();
  if (!description) description = type === 'income' ? 'Income' : 'Expense';
  return { type, amount: Math.round(amount * 100) / 100, description, hint };
}

const norm = s => String(s || '').trim().toLowerCase();

// The account a hint names ("maybank", "dbs", "card"): a name that starts with
// it first, then one that contains it. Without a hint, or with one that names
// nothing: the account last used for this description, else the one used most
// in the recent rows, else the first account.
export function chooseAccount(accounts, recent, parsed) {
  const live = accounts.filter(a => a.is_active !== false);
  if (!live.length) return null;
  const h = norm(parsed.hint);
  if (h) {
    const words = h.split(' ');
    for (const test of [a => norm(a.name) === h, a => norm(a.name).startsWith(h), a => norm(a.name).includes(h),
                        a => words.some(w => w.length >= 3 && norm(a.name).split(/\s+/).some(n => n.startsWith(w)))]) {
      const hit = live.find(test);
      if (hit) return hit;
    }
  }
  const byName = name => live.find(a => a.name === name);
  const same = recent.find(r => norm(r.description) === norm(parsed.description) && r.type === parsed.type && byName(r.account));
  if (same) return byName(same.account);
  const count = {};
  recent.forEach(r => { if (byName(r.account)) count[r.account] = (count[r.account] || 0) + 1; });
  const top = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
  return top ? byName(top) : live[0];
}

// The category used most for this description before; otherwise Other.
export function chooseCategory(recent, parsed) {
  const count = {};
  recent.forEach(r => {
    if (r.type === parsed.type && norm(r.description) === norm(parsed.description) && r.category && r.category !== 'Transfer') count[r.category] = (count[r.category] || 0) + 1;
  });
  return Object.keys(count).sort((a, b) => count[b] - count[a])[0] || 'Other';
}

// The secret Telegram sends back with every update, derived from the cron
// secret the project already has, so there is no new secret to set.
export async function webhookSecret(base) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(base), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('pfmt-telegram-webhook'));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}

export const QUICK_ADD_NOTE = 'Added from Telegram';
