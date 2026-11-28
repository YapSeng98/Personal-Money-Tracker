#!/usr/bin/env node
/*
 * Investment returns and repeat suggestions.
 *
 * Run:  node test/returns-and-repeats.test.js
 *       SEED=n node test/returns-and-repeats.test.js
 *
 * Loads the REAL monthReturn(), periodReturn() and repeatSuggestions() out of
 * index.html.
 *
 *   • Returns, on random market accounts with deposits, withdrawals,
 *     transfers and Update balance rows, against the Modified Dietz formula
 *     worked out here: gain ÷ (balance at the start + half the money moved).
 *     Money moved in or out is never profit; a month with no update is
 *     "no figure", and chaining months multiplies their growth.
 *   • Repeat suggestions on hand-made cases: three months in a row is offered,
 *     two is not, a gap is not, twice in a month is not, a drifting day or
 *     amount is not, a row already repeating is not, Not now is remembered,
 *     and transfers are never offered.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extract(name) {
  for (const p of [new RegExp(`\\nfunction ${name}\\s*\\(`), new RegExp(`\\nconst ${name}\\s*=`)]) {
    const m = HTML.match(p);
    if (!m) continue;
    const start = m.index + 1;
    const line = HTML.slice(start, HTML.indexOf('\n', start));
    if (line.startsWith('const ') && /;\s*$/.test(line)) return line;
    const brace = HTML.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < HTML.length; i++) {
      if (HTML[i] === '{') depth++;
      else if (HTML[i] === '}' && --depth === 0) return HTML.slice(start, i + 1);
    }
  }
  throw new Error(`could not find ${name} in index.html`);
}
const NAMES = ['pfmtPrevMonth', 'pfmtDaysInMonth', 'GAIN_LOSS_CATEGORY', 'txnBalanceEffect', 'effectiveBal', 'balanceOn',
  'monthEndDate', 'monthReturn', 'periodReturn', 'repeatSuggestions'];
const state = { currency: 'SGD', transactions: [], accounts: [] };
const API = new Function('state', NAMES.map(extract).join('\n') + `; return {${NAMES.join(',')}};`)(state);

let failed = 0, passed = 0;
const shown = new Set();
function ok(cond, label, detail) {
  if (cond) { passed++; return; }
  failed++;
  if (shown.has(label)) return;
  shown.add(label);
  console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`);
}
const group = name => console.log('\n' + name);
const r2 = v => Math.round(v * 100) / 100;
let seed = +(process.env.SEED || 20261129);
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const prevM = ym => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const dim = ym => new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate();
const day = (mk, d) => `${mk}-${String(Math.min(d, dim(mk))).padStart(2, '0')}`;

// ── Returns ──
group('Investment returns');
const MONTHS = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
for (let run = 0; run < 200; run++) {
  const acc = { id: 1, name: 'MooMoo', type: 'Investment', currency: 'SGD', balance: r2(rnd() < 0.15 ? 0 : 500 + rnd() * 5000) };
  const txns = [];
  let id = 0;
  MONTHS.forEach(mk => {
    if (rnd() < 0.6) txns.push({ id: ++id, type: 'income', amount: r2(50 + rnd() * 800), category: 'Transfer', account: 'MooMoo', currency: 'SGD', date: day(mk, 1 + Math.floor(rnd() * 27)), transferGroup: rnd() < 0.5 ? 'g' + id : undefined });
    if (rnd() < 0.3) txns.push({ id: ++id, type: 'expense', amount: r2(20 + rnd() * 300), category: 'Transfer', account: 'MooMoo', currency: 'SGD', date: day(mk, 1 + Math.floor(rnd() * 27)) });
    if (rnd() < 0.7) { const up = rnd() < 0.6; txns.push({ id: ++id, type: up ? 'income' : 'expense', amount: r2(1 + rnd() * 200), category: 'Gain/Loss', account: 'MooMoo', currency: 'SGD', date: day(mk, 28) }); }
    // noise: another account, another currency on this account's name
    txns.push({ id: ++id, type: 'income', amount: 999, category: 'Gain/Loss', account: 'OKX', currency: 'SGD', date: day(mk, 10) });
    txns.push({ id: ++id, type: 'income', amount: 777, category: 'Gain/Loss', account: 'MooMoo', currency: 'USD', date: day(mk, 11) });
  });
  state.transactions = txns; state.accounts = [acc];
  const bal = date => r2(txns.filter(t => t.account === 'MooMoo' && t.currency === 'SGD' && t.date <= date).reduce((s, t) => s + (t.type === 'expense' ? -1 : 1) * t.amount, acc.balance));
  const want = mk => {
    const start = bal(day(prevM(mk), 31));
    const mine = txns.filter(t => t.account === 'MooMoo' && t.currency === 'SGD' && t.date.slice(0, 7) === mk);
    const g = mine.filter(t => t.category === 'Gain/Loss' && !t.transferGroup);
    const gain = r2(g.reduce((s, t) => s + (t.type === 'expense' ? -1 : 1) * t.amount, 0));
    const flows = r2(mine.filter(t => !(t.category === 'Gain/Loss' && !t.transferGroup)).reduce((s, t) => s + (t.type === 'expense' ? -1 : 1) * t.amount, 0));
    const base = start + flows / 2;
    return { updated: g.length > 0, gain, flows, start, ret: g.length && base > 0 ? gain / base : null };
  };
  MONTHS.forEach(mk => {
    const got = API.monthReturn(acc, mk), w = want(mk);
    ok(got.updated === w.updated && Math.abs(got.gain - w.gain) < 0.006 && Math.abs(got.flows - w.flows) < 0.006 && Math.abs(got.start - w.start) < 0.006,
       'returns: the gain is the Gain/Loss rows; everything else on the account is money moved', `${mk}: ${JSON.stringify(got)} vs ${JSON.stringify(w)}`);
    ok((got.ret === null && w.ret === null) || (got.ret !== null && w.ret !== null && Math.abs(got.ret - w.ret) < 1e-9),
       'returns: gain ÷ (start + half the money moved); none without an update or with nothing in it', `${mk}: ${got.ret} vs ${w.ret}`);
  });
  const three = MONTHS.slice(3);
  let growth = 1, any = false, dead = false;
  three.forEach(mk => { const w = want(mk); if (!w.updated) return; if (w.ret === null) { dead = true; return; } any = true; growth *= 1 + w.ret; });
  const gotP = API.periodReturn(acc, three), wantP = dead || !any ? null : growth - 1;
  ok((gotP === null && wantP === null) || (gotP !== null && wantP !== null && Math.abs(gotP - wantP) < 1e-9), 'returns: months chain by multiplying their growth', `${gotP} vs ${wantP}`);
}
// A deposit alone is never a return.
state.accounts = [{ id: 1, name: 'OKX', type: 'Crypto', currency: 'USDT', balance: 1000 }];
state.transactions = [{ id: 1, type: 'income', amount: 5000, category: 'Transfer', account: 'OKX', currency: 'USDT', date: '2026-11-05' }];
ok(API.monthReturn(state.accounts[0], '2026-11').ret === null && API.periodReturn(state.accounts[0], ['2026-10', '2026-11']) === null, 'returns: putting money in, with no update, shows no return at all');
state.transactions.push({ id: 2, type: 'income', amount: 60, category: 'Gain/Loss', account: 'OKX', currency: 'USDT', date: '2026-11-28' });
ok(Math.abs(API.monthReturn(state.accounts[0], '2026-11').ret - 60 / 3500) < 1e-12, 'returns: 60 earned on 1,000 plus a 5,000 deposit mid-month is 60 ÷ 3,500');

// ── Repeat suggestions ──
group('Repeat suggestions');
const T = (id, date, extra = {}) => Object.assign({ id, type: 'expense', amount: 120, description: 'Insurance', category: 'Health', account: 'DBS', currency: 'SGD', date }, extra);
const sug = (txns, today = '2026-11-28', dismissed = []) => API.repeatSuggestions(txns, today, 'SGD', dismissed);
let r = sug([T(1, '2026-09-03'), T(2, '2026-10-03'), T(3, '2026-11-03')]);
ok(r.length === 1 && r[0].latest.id === 3 && r[0].day === 3 && r[0].amount === 120 && r[0].months.join() === '2026-09,2026-10,2026-11', 'repeat: three months in a row, same day and amount, is offered', JSON.stringify(r));
ok(sug([T(1, '2026-08-03'), T(2, '2026-09-03'), T(3, '2026-10-03')]).length === 1, 'repeat: the latest may be last month (this month\'s not typed yet)');
ok(sug([T(1, '2026-07-03'), T(2, '2026-08-03'), T(3, '2026-09-03')]).length === 0, 'repeat: not when it stopped two months ago');
ok(sug([T(1, '2026-10-03'), T(2, '2026-11-03')]).length === 0, 'repeat: two months is not enough');
ok(sug([T(1, '2026-08-03'), T(2, '2026-09-03'), T(3, '2026-11-03')]).length === 0, 'repeat: a gap month breaks it');
ok(sug([T(1, '2026-09-03'), T(2, '2026-10-03'), T(3, '2026-11-03'), T(4, '2026-11-20')]).length === 0, 'repeat: twice in a month is not a monthly payment');
ok(sug([T(1, '2026-09-01'), T(2, '2026-10-12'), T(3, '2026-11-03')]).length === 0, 'repeat: a day that wanders more than 6 days is not offered');
ok(sug([T(1, '2026-09-30'), T(2, '2026-10-31'), T(3, '2026-11-28')]).length === 1, 'repeat: month-end dates (30th, 31st, 28th) count as the same day');
ok(sug([T(1, '2026-09-03', { amount: 100 }), T(2, '2026-10-03'), T(3, '2026-11-03')]).length === 0, 'repeat: an amount more than 10% off is not offered');
ok(sug([T(1, '2026-09-03', { amount: 112 }), T(2, '2026-10-03', { amount: 118 }), T(3, '2026-11-03')]).length === 1, 'repeat: within 10% is the same payment');
ok(sug([T(1, '2026-09-03', { description: 'insurance ' }), T(2, '2026-10-03', { description: 'INSURANCE' }), T(3, '2026-11-03')]).length === 1, 'repeat: the description is matched ignoring case and spaces');
ok(sug([T(1, '2026-09-03', { account: 'Card' }), T(2, '2026-10-03'), T(3, '2026-11-03')]).length === 0, 'repeat: a different account is a different payment');
ok(sug([T(1, '2026-09-03'), T(2, '2026-10-03'), T(3, '2026-11-03'), T(9, '2026-06-03', { isRecurring: true, recurringFrequency: 'monthly' })]).length === 0, 'repeat: not when a repeating row already covers it');
ok(sug([T(1, '2026-09-03'), T(2, '2026-10-03'), T(3, '2026-11-03'), T(9, '2026-06-03', { isRecurring: true, description: 'Netflix', amount: 18 })]).length === 1, 'repeat: an unrelated repeating row in the same category does not hide it');
ok(sug([T(1, '2026-09-03', { recurringSource: 'x' }), T(2, '2026-10-03', { recurringSource: 'x' }), T(3, '2026-11-03', { recurringSource: 'x' })]).length === 0, 'repeat: rows the app added on a schedule are never offered');
ok(sug([T(1, '2026-09-03', { transferGroup: 'a' }), T(2, '2026-10-03', { transferGroup: 'b' }), T(3, '2026-11-03', { transferGroup: 'c' })]).length === 0, 'repeat: transfers are never offered');
const key = r[0].key;
ok(sug([T(1, '2026-09-03'), T(2, '2026-10-03'), T(3, '2026-11-03')], '2026-11-28', [key]).length === 0, 'repeat: Not now is remembered');
ok(sug([T(1, '2026-09-25', { type: 'income', description: 'Salary', category: 'Salary', amount: 4000 }), T(2, '2026-10-25', { type: 'income', description: 'Salary', category: 'Salary', amount: 4100 }), T(3, '2026-11-25', { type: 'income', description: 'Salary', category: 'Salary', amount: 4000 })]).length === 1,
   'repeat: income repeats too');
// Random books: everything offered really does meet every rule.
for (let run = 0; run < 300; run++) {
  const txns = [];
  let id = 0;
  ['Insurance', 'Gym', 'Phone', 'Lunch'].forEach(desc => {
    ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11'].forEach(mk => {
      if (rnd() < 0.25) return;
      const n = rnd() < 0.15 ? 2 : 1;
      for (let k = 0; k < n; k++) txns.push(T(++id, day(mk, 1 + Math.floor(rnd() * 28)), { description: desc, amount: r2(100 * (0.85 + rnd() * 0.3)), account: rnd() < 0.9 ? 'DBS' : 'Card' }));
    });
  });
  sug(txns).forEach(s => {
    const same = txns.filter(t => [t.type, t.description.trim().toLowerCase(), t.category, t.account, t.currency].join('|') === s.key);
    const months = s.months;
    const rows = months.map(mk => same.filter(t => t.date.slice(0, 7) === mk));
    const days = rows.map(x => Math.min(+x[0].date.slice(8, 10), 28));
    ok(rows.every(x => x.length === 1) && months[1] === prevM(months[2]) && months[0] === prevM(months[1]) && ['2026-11', '2026-10'].includes(months[2])
       && Math.max(...days) - Math.min(...days) <= 6 && rows.every(x => Math.abs(x[0].amount - s.amount) <= s.amount * 0.1 + 1e-9),
       'repeat: every suggestion on a random book meets every rule', JSON.stringify(s.months));
  });
}

console.log(`\n${failed ? 'FAIL' : 'PASS'}  returns and repeats: ${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
