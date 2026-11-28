#!/usr/bin/env node
/*
 * Running high, budgets from history, and year in review.
 *
 * Run:  node test/insights.test.js
 *       SEED=n node test/insights.test.js   (another set of random books)
 *
 * Loads the REAL pfmtCategorySpentTo(), pfmtSpendTrends(), budgetSuggestions()
 * and yearReview() out of index.html and checks them on random books (two
 * currencies, transfers, claims, paybacks bigger than the spending, months
 * with nothing) against figures worked out here, the long way:
 *
 *   • spending to a day counts only that month's days up to it, net of
 *     paybacks in the same category, never below zero, claims never offsetting;
 *   • a category is "running high" exactly when it has spending in two of the
 *     three months before, is 20% and 20 above their average, each month
 *     counted to the same day (whole months for a finished month);
 *   • budget suggestions are last month and the 3- and 6-month averages;
 *   • a year's income, spending (per month and per category), what was kept,
 *     and each currency's net worth on 31 Dec the year before and at the end.
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
const NAMES = ['PFMT_CLAIMS_CATEGORY', 'pfmtIsFlow', 'pfmtPaybackOffsets', 'pfmtPrevMonth', 'pfmtDaysInMonth', 'pfmtBudgetSpent',
  'pfmtCategorySpentTo', 'PFMT_TREND_MIN_PCT', 'PFMT_TREND_MIN_AMT', 'pfmtSpendTrends', 'budgetSuggestions',
  'txnBalanceEffect', 'effectiveBal', 'balanceOn', 'yearReview'];
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
const near = (a, b) => Math.abs(a - b) < 0.006;

let seed = +(process.env.SEED || 20261128);
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const prevM = ym => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const dim = ym => new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate();

// A random book over two years: expenses in a few categories (some months
// empty), income, paybacks (some bigger than the spending, some for Claims),
// and transfers whose legs never count as spending.
function book() {
  const cats = ['Food', 'Travel', 'Claims', 'Rent', 'Fun'];
  const curs = ['SGD', 'MYR'];
  const accounts = [
    { id: 1, name: 'DBS', currency: 'SGD', balance: r2(rnd() * 3000), type: 'Checking' },
    { id: 2, name: 'Card', currency: 'SGD', balance: -r2(rnd() * 500), type: 'Credit Card' },
    { id: 3, name: 'Maybank', currency: 'MYR', balance: r2(rnd() * 5000), type: 'Savings' }];
  const accFor = cur => cur === 'SGD' ? pick(['DBS', 'Card']) : 'Maybank';
  const txns = [];
  let id = 0;
  const months = [];
  let m = '2026-11';
  for (let i = 0; i < 26; i++) { months.unshift(m); m = prevM(m); }
  months.forEach(mk => {
    curs.forEach(cur => {
      cats.forEach(cat => {
        if (rnd() < 0.35) return;                       // a month with nothing in this category
        const n = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          txns.push({ id: ++id, type: 'expense', amount: r2(5 + rnd() * 120), description: cat, category: cat, account: accFor(cur),
            date: `${mk}-${String(1 + Math.floor(rnd() * dim(mk))).padStart(2, '0')}`, currency: cur });
        }
        if (rnd() < 0.25) txns.push({ id: ++id, type: 'payback', amount: r2(rnd() < 0.3 ? 400 : 10 + rnd() * 40), description: 'back', category: cat,
          account: accFor(cur), date: `${mk}-${String(1 + Math.floor(rnd() * dim(mk))).padStart(2, '0')}`, currency: cur });
      });
      if (rnd() < 0.8) txns.push({ id: ++id, type: 'income', amount: r2(1000 + rnd() * 3000), description: 'Salary', category: 'Salary',
        account: accFor(cur), date: `${mk}-${String(1 + Math.floor(rnd() * 27)).padStart(2, '0')}`, currency: cur });
    });
    if (rnd() < 0.5) {
      const g = 'tg' + (++id), d = `${mk}-${String(1 + Math.floor(rnd() * 27)).padStart(2, '0')}`, amt = r2(50 + rnd() * 200);
      txns.push({ id: ++id, type: 'expense', amount: amt, description: 'move', category: 'Transfer', account: 'DBS', date: d, currency: 'SGD', transferGroup: g });
      txns.push({ id: ++id, type: 'income', amount: amt, description: 'move', category: 'Transfer', account: 'Card', date: d, currency: 'SGD', transferGroup: g });
    }
  });
  return { txns, accounts, cats, curs };
}

// ── the long way ──
function spentTo(txns, cat, cur, mk, lastDay) {
  let s = 0, b = 0;
  txns.forEach(t => {
    if (t.date.slice(0, 7) !== mk || t.category !== cat || (t.currency || 'SGD') !== cur || +t.date.slice(8, 10) > lastDay) return;
    if (t.type === 'expense' && !t.transferGroup) s += t.amount;
    if (t.type === 'payback' && t.category !== 'Claims') b += t.amount;
  });
  return r2(b > s ? s : s - b);
}
function balanceAt(txns, acc, date) {
  let v = acc.balance;
  txns.forEach(t => {
    if (t.account !== acc.name || (t.currency || 'SGD') !== acc.currency || t.date > date) return;
    v += (t.type === 'expense' ? -1 : 1) * t.amount;
  });
  return r2(v);
}

const RUNS = +(process.env.RUNS || 30);
for (let run = 0; run < RUNS; run++) {
  const B = book();
  state.transactions = B.txns; state.accounts = B.accounts;

  if (run === 0) group('Spending to a day of the month');
  for (let k = 0; k < 40; k++) {
    const cat = pick(B.cats), cur = pick(B.curs), mk = pick(['2026-11', '2026-10', '2026-02', '2025-12', '2025-03']), day = 1 + Math.floor(rnd() * 31);
    const got = API.pfmtCategorySpentTo(B.txns, cat, cur, mk, day, 'SGD'), want = spentTo(B.txns, cat, cur, mk, day);
    ok(near(got, want), 'spending to a day: expenses up to that day, net of same-category paybacks, never below zero', `${cat} ${cur} ${mk} to ${day}: ${got} vs ${want}`);
    ok(near(API.pfmtBudgetSpent(B.txns, cat, cur, mk, 'SGD'), spentTo(B.txns, cat, cur, mk, 31)), 'the budget figure is still the whole month');
  }

  if (run === 0) group('Running high');
  for (const [mk, lastDay] of [['2026-11', 28], ['2026-10', 31], ['2026-03', 9], ['2026-02', 28], ['2025-12', 31]]) {
    const got = API.pfmtSpendTrends(B.txns, mk, lastDay, 'SGD');
    const whole = lastDay >= dim(mk);
    const want = [];
    const keys = new Set(B.txns.filter(t => t.type === 'expense' && !t.transferGroup).map(t => t.currency + '|' + t.category));
    keys.forEach(k => {
      const [cur, cat] = k.split('|');
      const now = spentTo(B.txns, cat, cur, mk, lastDay);
      const past = [];
      let m = mk;
      for (let i = 0; i < 3; i++) { m = prevM(m); past.push(spentTo(B.txns, cat, cur, m, whole ? dim(m) : Math.min(lastDay, dim(m)))); }
      if (past.filter(v => v > 0).length < 2) return;
      const usual = r2((past[0] + past[1] + past[2]) / 3);
      const pct = Math.round((now / usual - 1) * 100);
      want.push({ cat, cur, now, usual, pct, high: pct >= 20 && now - usual >= 20 });
    });
    ok(got.length === want.length, 'running high: every category with a usual is assessed, and only those', `${mk}: ${got.length} vs ${want.length}`);
    want.forEach(w => {
      const g = got.find(x => x.category === w.cat && x.currency === w.cur);
      ok(g && near(g.now, w.now) && near(g.usual, w.usual) && g.pct === w.pct && g.high === w.high,
         'running high: this month to the day against the same days of the 3 before; 20% and 20 over', `${mk} ${w.cur} ${w.cat}: ${JSON.stringify(g)} vs ${JSON.stringify(w)}`);
    });
    ok(got.every((x, i) => i === 0 || got[i - 1].pct >= x.pct), 'running high: the biggest rise comes first');
  }

  if (run === 0) group('Budgets from your history');
  for (let k = 0; k < 10; k++) {
    const cat = pick(B.cats), cur = pick(B.curs), mk = pick(['2026-11', '2026-06', '2026-01']);
    const s = API.budgetSuggestions(B.txns, cat, cur, mk, 'SGD');
    const ms = [];
    let m = mk;
    for (let i = 0; i < 6; i++) { m = prevM(m); ms.push(spentTo(B.txns, cat, cur, m, 31)); }
    if (!ms.some(v => v > 0)) { ok(s === null, 'budgets from history: nothing to suggest without spending'); continue; }
    ok(s && near(s.last, ms[0]) && near(s.avg3, r2((ms[0] + ms[1] + ms[2]) / 3)) && near(s.avg6, r2(ms.reduce((a, b) => a + b, 0) / 6)),
       'budgets from history: last month, and the 3- and 6-month averages of whole months', `${cat} ${cur} ${mk}: ${JSON.stringify(s)} vs ${ms}`);
  }

  if (run === 0) group('Year in review');
  for (const [year, today] of [[2026, '2026-11-28'], [2025, '2026-11-28']]) {
    const r = API.yearReview(B.txns, B.accounts, year, today, 'SGD');
    const last = year === 2026 ? 11 : 12;
    const months = Array.from({ length: last }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    ok(r.months.length === last && r.end === (year === 2026 ? today : '2025-12-31'), 'year: a year in progress runs to today; a past year to 31 Dec');
    B.curs.forEach(cur => {
      const x = r.byCur[cur];
      const income = r2(B.txns.filter(t => t.type === 'income' && !t.transferGroup && t.currency === cur && months.includes(t.date.slice(0, 7))).reduce((s, t) => s + t.amount, 0));
      const perMonth = months.map(mk => r2(B.cats.reduce((s, c) => s + spentTo(B.txns, c, cur, mk, 31), 0)));
      const spent = r2(perMonth.reduce((a, b) => a + b, 0));
      ok(x && near(x.income, income), 'year: income is every income row of the year (transfers left out)', `${cur} ${year}: ${x && x.income} vs ${income}`);
      ok(x && near(x.spent, spent) && x.months.every((v, i) => near(v, perMonth[i])), 'year: spending month by month, net of paybacks the way budgets count it', `${cur} ${year}: ${x && x.spent} vs ${spent}`);
      ok(x && (income > 0 ? near(x.kept, Math.round((income - spent) / income * 1000) / 10) : x.kept === null), 'year: kept is the share of income not spent');
      const catSum = x ? r2(x.cats.reduce((s, c) => s + c.amount, 0)) : 0;
      ok(x && near(catSum, spent) && x.cats.every((c, i) => c.amount > 0 && (i === 0 || x.cats[i - 1].amount >= c.amount)), 'year: categories add up to the spending, biggest first', `${catSum} vs ${spent}`);
      const accs = B.accounts.filter(a => a.currency === cur);
      const start = r2(accs.reduce((s, a) => s + balanceAt(B.txns, a, `${year - 1}-12-31`), 0));
      const end = r2(accs.reduce((s, a) => s + balanceAt(B.txns, a, r.end), 0));
      ok(x && near(x.worthStart, start) && near(x.worthEnd, end) && near(x.worthChange, r2(end - start)), 'year: net worth from 31 Dec the year before to the end, per currency', `${cur}: ${x && x.worthStart}→${x && x.worthEnd} vs ${start}→${end}`);
    });
  }
}

console.log(`\n${failed ? 'FAIL' : 'PASS'}  insights: ${passed} checks passed, ${failed} failed (${RUNS} random books, seed ${process.env.SEED || 20261128})`);
process.exit(failed ? 1 : 0);
