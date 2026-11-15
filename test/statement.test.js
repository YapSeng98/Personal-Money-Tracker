#!/usr/bin/env node
/*
 * The monthly statement, checked against figures worked out independently.
 *
 * Run:  node test/statement.test.js
 *       PFMT_BACKUP=~/PFMT_Backups/<date> node test/statement.test.js
 *         (also checks every month of every book in a real backup)
 *
 * Loads the REAL buildStatement(), statementSheets() and the rest out of
 * index.html, then builds random books with every awkward case the app can
 * hold — several currencies, credit cards in debt, transfers, currency
 * exchanges, asset purchases, paybacks bigger than their category, work
 * claims, holdings added with no funding account, rows booked to no account,
 * one-sided transfers, legacy "transfer" rows, months crossing a year end and
 * February — and checks, for every month and for random ranges of months:
 *
 *   • every transaction in the period appears exactly once, under its own
 *     account and currency, or under "not linked to an account";
 *   • each account opens at its starting balance plus everything before the
 *     period, closes at everything up to its last day, and opening + in − out
 *     = closing, line by line;
 *   • one month's closing balance is the next month's opening, and the last
 *     one is the balance the Accounts page shows;
 *   • money in and out are exactly what the dashboard's curStats() says for
 *     that month, and every column adds up to its total;
 *   • any difference between the change in balances and net cash flow is
 *     fully explained, cause by cause;
 *   • a range of months is its months added together;
 *   • the Excel/CSV sheets carry the same figures, and a CSV cell can never be
 *     read by a spreadsheet as a formula.
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
    // A one-line const (an arrow function or a table) ends with its line.
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

const NAMES = ['PFMT_CLAIMS_CATEGORY', 'pfmtIsFlow', 'pfmtPaybackOffsets', 'paybackOffsets', 'isFlow',
  'legsByGroup', 'transferPartner', 'isCrossCurrencyLeg', 'isAssetGroup', 'localYM', 'localDateStr',
  'daysInMonth', 'daysSoFarIn', 'summaryMonthKeys', 'monthlyInOut', 'monthFlowData', 'curStats',
  'txnBalanceEffect', 'effectiveBal', 'stmtKind', 'monthsBetween', 'buildStatement', 'stmtNum',
  'stmtMonthEnd', 'stmtGapNote', 'stmtFlowNote', 'fmtDate', 'getMonthLabel', 'CUR_NAME', 'statementSheets', 'csvCell', 'sheetsToCSV',
  'pairProblems'];
const state = { currency: 'SGD', filterMonth: '2026-01', transactions: [], accounts: [] };
const OPTIONAL = new Set();
const src = 'let _legIndex = null, _legIndexOf = null, _legIndexLen = -1, _legIndexVer = -1, _txnVersion = 0;\n'
  + NAMES.map(n => { try { return extract(n); } catch (e) { if (OPTIONAL.has(n)) return `const ${n} = null;`; throw e; } }).join('\n');
const API = new Function('state', 'console', src + `; return {${NAMES.join(',')}};`)(state, console);

let failed = 0, passed = 0;
const shown = new Set();
function ok(cond, label, detail) {
  if (cond) { passed++; return; }
  failed++;
  // One line per kind of failure, so a broken rule doesn't print 10,000 times.
  if (shown.has(label)) return;
  shown.add(label);
  console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`);
}
const group = name => console.log('\n' + name);
const cents = v => Math.round(v * 100);
const same = (a, b) => cents(a) === cents(b);

// ── a seeded random source, so a failure can be reproduced ─────────────────
let seed = +(process.env.SEED || 20261112);   // SEED=n tries a different set of books
// mulberry32: an earlier multiply-and-add generator lost precision in doubles
// and fell into a loop of 10,466 numbers, so most runs repeated each other.
const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const money = () => {
  const r = rnd();
  const v = r < 0.05 ? 0.01 : r < 0.1 ? int(100000, 2000000) + int(0, 99) / 100 : int(1, 3000) + int(0, 99) / 100;
  return Math.round(v * 100) / 100;
};
const CATS = ['Food & Drink', 'Transport', 'Groceries', 'Shopping', 'Bills', 'Rental', 'Health', 'Investment', 'Claims', 'Other'];
const INC = ['Salary', 'Freelance', 'Investment', 'Other'];

function randomBook(fromMk, toMk) {
  const curs = ['SGD', 'MYR', 'USD', 'USDT'].filter((c, i) => i === 0 || rnd() < 0.7);
  const accounts = [];
  curs.forEach(cur => {
    for (let i = 0; i < int(1, 3); i++) {
      const card = rnd() < 0.25;
      accounts.push({ id: `${cur}-${i}`, name: `${cur} ${card ? 'Card' : 'Bank'} ${i}`, type: card ? 'Credit Card' : 'Savings',
                      institution: 'Test', currency: cur, balance: card ? -money() : (rnd() < 0.2 ? 0 : money()) });
    }
  });
  const months = API.monthsBetween(API.monthsBetween('2000-01', fromMk).length > 2 ? prevMk(prevMk(fromMk)) : fromMk, toMk);
  const date = () => { const mk = pick(months); return `${mk}-${String(int(1, +API.stmtMonthEnd(mk).slice(8))).padStart(2, '0')}`; };
  const T = [];
  let id = 0, g = 0;
  const row = (o) => { const t = Object.assign({ id: `t${++id}`, description: `Row ${id}`, notes: '', created: `2026-01-01 00:${String(int(0, 59)).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}` }, o); T.push(t); return t; };
  const accOf = cur => pick(accounts.filter(a => a.currency === cur));
  const n = int(20, 90);
  for (let i = 0; i < n; i++) {
    const cur = pick(curs), a = accOf(cur), d = date(), k = rnd();
    if (k < 0.35) row({ type: 'expense', amount: money(), category: pick(CATS), account: a.name, currency: cur, date: d });
    else if (k < 0.5) row({ type: 'income', amount: money(), category: pick(INC), account: a.name, currency: cur, date: d });
    else if (k < 0.6) row({ type: 'payback', amount: money(), category: pick(CATS), account: a.name, currency: cur, date: d });
    else if (k < 0.68) {                                       // same-currency transfer
      const to = accounts.filter(x => x.currency === cur && x !== a);
      if (!to.length) continue;
      const amt = money(), tg = `tg_${++g}`;
      row({ type: 'expense', amount: amt, category: 'Transfer', account: a.name, currency: cur, date: d, transferGroup: tg });
      row({ type: 'income', amount: amt, category: 'Transfer', account: pick(to).name, currency: cur, date: d, transferGroup: tg });
    } else if (k < 0.76 && curs.length > 1) {                  // currency exchange
      const other = pick(curs.filter(c => c !== cur)), tg = `tg_${++g}`;
      row({ type: 'expense', amount: money(), category: 'Transfer', account: a.name, currency: cur, date: d, transferGroup: tg });
      row({ type: 'income', amount: money(), category: 'Transfer', account: accOf(other).name, currency: other, date: d, transferGroup: tg });
    } else if (k < 0.82) {                                     // asset bought from a tracked account
      const to = accounts.filter(x => x.currency === cur && x !== a);
      if (!to.length) continue;
      const amt = money(), ag = `ag_${++g}`;
      row({ type: 'expense', amount: amt, category: 'Investment', account: a.name, currency: cur, date: d, transferGroup: ag });
      row({ type: 'asset', amount: amt, category: 'Investment', account: pick(to).name, currency: cur, date: d, transferGroup: ag });
    } else if (k < 0.835 && curs.length > 1) {                 // older data: a holding bought from another currency
      const other = pick(curs.filter(c => c !== cur)), ag = `ag_${++g}`;
      row({ type: 'expense', amount: money(), category: 'Investment', account: a.name, currency: cur, date: d, transferGroup: ag });
      row({ type: 'asset', amount: money(), category: 'Investment', account: accOf(other).name, currency: other, date: d, transferGroup: ag });
    } else if (k < 0.85) row({ type: 'asset', amount: money(), category: 'Investment', account: a.name, currency: cur, date: d });   // already owned
    else if (k < 0.9) row({ type: pick(['expense', 'income', 'payback']), amount: money(), category: pick(CATS), account: pick(['Cash', '', 'Closed account']), currency: cur, date: d });
    else if (k < 0.93) {                                       // booked to an account in another currency
      const wrong = accounts.find(x => x.currency !== cur);
      if (wrong) row({ type: 'expense', amount: money(), category: pick(CATS), account: wrong.name, currency: cur, date: d });
    } else if (k < 0.96) row({ type: pick(['expense', 'income']), amount: money(), category: 'Transfer', account: a.name, currency: cur, date: d, transferGroup: `tg_lone_${++g}` });
    else if (k < 0.98) row({ type: 'transfer', amount: money(), category: 'Transfer', account: a.name, currency: cur, date: d });
    else {                                                     // a payback bigger than everything in its category
      const cat = pick(CATS);
      row({ type: 'expense', amount: 10, category: cat, account: a.name, currency: cur, date: d });
      row({ type: 'payback', amount: 50, category: cat, account: a.name, currency: cur, date: d });
    }
  }
  return { accounts, transactions: T, home: pick(curs) };
}
function prevMk(mk) { const [y, m] = mk.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; }
function nextMk(mk) { const [y, m] = mk.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; }

function load(book) {
  state.accounts = book.accounts;
  state.transactions = book.transactions;
  state.currency = book.home;
}

// ── the rules, written out a second time from the README, not from the code ─
const effect = t => t.type === 'expense' ? -t.amount : (t.type === 'income' || t.type === 'asset' || t.type === 'payback') ? t.amount : 0;
const curOf = x => x.currency || state.currency;
function legs(t) { return t.transferGroup ? state.transactions.filter(x => x.transferGroup === t.transferGroup) : []; }
function partner(t) { return legs(t).find(x => x !== t) || null; }
// What a row adds to its currency's net cash flow.
function flowOf(t) {
  if (t.type === 'payback') return t.amount;                 // either lowers spending or is a refund: +amount to net either way
  if (t.type !== 'income' && t.type !== 'expense' && t.type !== 'asset') return 0;
  if (t.transferGroup) {
    const p = partner(t);
    if (!p || curOf(p) === curOf(t)) return 0;                // one-sided, or within one currency
    return t.type === 'expense' ? -t.amount : t.amount;       // an exchange
  }
  if (t.type === 'asset') return 0;                            // a holding recorded without a funding account
  return t.type === 'income' ? t.amount : -t.amount;
}
function refFlow(cur, mk) {
  const rows = state.transactions.filter(t => curOf(t) === cur && t.date.slice(0, 7) === mk);
  let inc = 0, xIn = 0, xOut = 0, back = 0, exp = 0;
  const spent = {}, paid = {};
  rows.forEach(t => {
    if (t.type === 'payback') { if (t.category === 'Claims') back += t.amount; else paid[t.category] = (paid[t.category] || 0) + t.amount; return; }
    if (t.transferGroup) {
      const p = partner(t);
      if (p && curOf(p) !== cur && (t.type === 'income' || t.type === 'asset')) xIn += t.amount;
      if (p && curOf(p) !== cur && t.type === 'expense') xOut += t.amount;
      return;
    }
    if (t.type === 'income') inc += t.amount;
    if (t.type === 'expense') spent[t.category] = (spent[t.category] || 0) + t.amount;
  });
  Object.keys(spent).forEach(c => { const b = paid[c] || 0; exp += b > spent[c] ? spent[c] : spent[c] - b; });
  Object.keys(paid).forEach(c => { if (paid[c] > (spent[c] || 0)) back += paid[c]; });
  return { inc, exp, xIn, xOut, back };
}

function checkStatement(st, label, opts = {}) {
  const months = new Set(st.months);
  const start = st.fromMk + '-01', end = API.stmtMonthEnd(st.toMk);
  const inRange = t => months.has(t.date.slice(0, 7));
  const expected = state.transactions.filter(inRange);

  // Every row exactly once, in the right place.
  const seen = new Map();
  st.sections.forEach(s => {
    s.accounts.forEach(x => x.lines.forEach(l => {
      seen.set(l.t.id, (seen.get(l.t.id) || 0) + 1);
      ok(l.t.account === x.a.name && curOf(l.t) === s.cur && curOf(x.a) === s.cur, `${label}: a ledger row sits under its own account and currency`, `${l.t.id} ${l.t.account}/${curOf(l.t)} under ${x.a.name}/${s.cur}`);
    }));
    s.unlinked.forEach(t => {
      seen.set(t.id, (seen.get(t.id) || 0) + 1);
      const home = state.accounts.find(a => a.name === t.account && curOf(a) === s.cur);
      ok(curOf(t) === s.cur && !home, `${label}: "not linked" rows really have no account in that currency`, `${t.id} ${t.account}`);
    });
  });
  ok(expected.every(t => seen.get(t.id) === 1) && seen.size === expected.length, `${label}: every transaction in the period appears exactly once`,
     `${expected.filter(t => seen.get(t.id) !== 1).map(t => t.id + '×' + (seen.get(t.id) || 0)).slice(0, 5).join(' ')} · ${seen.size} vs ${expected.length}`);

  // Currencies: once each, home first.
  const curs = st.sections.map(s => s.cur);
  ok(new Set(curs).size === curs.length && (!curs.includes(state.currency) || curs[0] === state.currency), `${label}: one section per currency, home first`, curs.join());

  st.sections.forEach(s => {
    const c = s.cur;
    // Balances.
    s.accounts.forEach(x => {
      const mine = state.transactions.filter(t => t.account === x.a.name && curOf(t) === c);
      const opening = x.a.balance + mine.filter(t => t.date < start).reduce((v, t) => v + effect(t), 0);
      const closing = x.a.balance + mine.filter(t => t.date <= end).reduce((v, t) => v + effect(t), 0);
      ok(same(x.opening, opening), `${label}: an account opens at its starting balance plus everything before the period`, `${x.a.name} ${x.opening} vs ${opening}`);
      ok(same(x.closing, closing), `${label}: an account closes at everything up to the period's last day`, `${x.a.name} ${x.closing} vs ${closing}`);
      ok(same(x.opening + x.moneyIn - x.moneyOut, x.closing), `${label}: opening + money in − money out = closing`, `${x.a.name}: ${x.opening} + ${x.moneyIn} − ${x.moneyOut} ≠ ${x.closing}`);
      let bal = x.opening, prev = null, sorted = true;
      x.lines.forEach(l => {
        ok(l.e === effect(l.t), `${label}: each line moves the balance by its own amount`, `${l.t.id} ${l.e} vs ${effect(l.t)}`);
        bal += l.e;
        ok(same(l.bal, bal), `${label}: the running balance adds up line by line`, `${l.t.id} ${l.bal} vs ${bal}`);
        if (prev && (prev.t.date > l.t.date || (prev.t.date === l.t.date && (prev.t.created || '') > (l.t.created || '')))) sorted = false;
        prev = l;
      });
      ok(sorted, `${label}: lines run oldest first`);
      ok(!x.lines.length || same(x.lines[x.lines.length - 1].bal, x.closing), `${label}: the last running balance is the closing balance`);
      ok(x.lines.every(l => l.e !== 0) || x.lines.some(l => l.t.type === 'transfer'), `${label}: only legacy transfer rows can move nothing`);
    });
    ok(same(s.openTot, s.accounts.reduce((v, x) => v + x.opening, 0)) && same(s.closeTot, s.accounts.reduce((v, x) => v + x.closing, 0))
       && same(s.accIn, s.accounts.reduce((v, x) => v + x.moneyIn, 0)) && same(s.accOut, s.accounts.reduce((v, x) => v + x.moneyOut, 0)),
       `${label}: the balances table's totals add up`);

    // Money in and out, against an independent tally, month by month.
    const ref = { inc: 0, exp: 0, xIn: 0, xOut: 0, back: 0 };
    st.months.forEach(mk => { const r = refFlow(c, mk); Object.keys(ref).forEach(k => { ref[k] += Math.round(r[k] * 100) / 100; }); });
    ['inc', 'exp', 'xIn', 'xOut', 'back'].forEach(k => ok(same(s.flow[k], ref[k]), `${label}: ${k} matches an independent tally`, `${c} ${k} ${s.flow[k]} vs ${ref[k]}`));
    ok(same(s.moneyIn, s.flow.inc + s.flow.back + s.flow.xIn) && same(s.moneyOut, s.flow.exp + s.flow.xOut)
       && same(s.net, s.moneyIn - s.moneyOut) && same(s.kept, s.flow.inc - s.flow.exp), `${label}: money in, out, net and kept are built from their parts`);
    if (st.months.length === 1) {
      const cs = API.curStats(c, state.transactions.filter(t => t.date.slice(0, 7) === st.fromMk), st.fromMk);
      ok(['inc', 'exp', 'xIn', 'xOut', 'back'].every(k => same(cs[k], s.flow[k])) && same(cs.net, s.net),
         `${label}: the statement agrees with the dashboard (curStats)`, `${c} ${JSON.stringify(s.flow)} vs ${JSON.stringify({ inc: cs.inc, exp: cs.exp, xIn: cs.xIn, xOut: cs.xOut, back: cs.back })}`);
    }
    // Columns foot, using the figures as printed (rounded to the cent).
    ok(same(s.income.reduce((v, x) => v + cents(x.amt), 0) / 100, s.flow.inc), `${label}: the income lines add up to Total income`, `${c} ${s.income.map(x => x.amt)} vs ${s.flow.inc}`);
    ok(same(s.spending.reduce((v, x) => v + cents(x.amt), 0) / 100, s.flow.exp), `${label}: the spending lines add up to Total spending`, `${c} ${s.spending.map(x => x.amt)} vs ${s.flow.exp}`);
    ok(s.spending.every(x => same(x.amt, x.spent - x.back) && x.back <= x.spent + 0.005 && x.amt >= -0.005), `${label}: a category never shows more paid back than spent`);
    ok(same(s.byMonth.reduce((v, r) => v + cents(r.inc - r.exp + r.xIn - r.xOut + r.back), 0) / 100, s.net), `${label}: the months add up to the period`);

    // The gap between balances and cash flow, explained cause by cause.
    const rows = expected.filter(t => curOf(t) === c);
    const linked = t => state.accounts.some(a => a.name === t.account && curOf(a) === c);
    const gapRef = rows.reduce((v, t) => v + (linked(t) ? effect(t) : 0) - flowOf(t), 0);
    ok(same(s.accounts.length ? s.gap : gapRef, gapRef) || !s.accounts.length, `${label}: the gap between balances and cash flow is exactly what the rows explain`, `${c} ${s.gap} vs ${gapRef}`);
    if (s.accounts.length && !s.gap) {
      const differ = !same(s.accIn, s.moneyIn) || !same(s.accOut, s.moneyOut);
      ok(same(s.accIn - s.accOut, s.net), `${label}: with no gap, account money in less out is the net cash flow`, `${c} ${s.accIn} − ${s.accOut} vs ${s.net}`);
      ok(!!API.stmtFlowNote(s) === differ && (!differ || API.stmtFlowNote(s).includes(API.stmtNum(s.net))),
         `${label}: the two "money in" figures are explained exactly when they differ`, `${c} ${API.stmtFlowNote(s)}`);
    }
    if (API.stmtGapNote && s.gap) {
      const note = API.stmtGapNote(s);
      ok(note.parts.length && same(note.parts.reduce((v, p) => v + p.amount, 0), s.gap), `${label}: the note explaining the gap accounts for all of it`,
         `${c} gap ${s.gap}: ${note.parts.map(p => p.kind + ' ' + p.amount).join(', ')}`);
    }
  });
  return st;
}

// ── 1. Random books, month by month ────────────────────────────────────────
group('Random books, every month');
const RANGES = [['2025-11', '2026-03'], ['2023-12', '2024-03'], ['2099-12', '2100-02']];
for (let b = 0; b < 400; b++) {
  const [from, to] = pick(RANGES);
  const book = randomBook(from, to);
  load(book);
  const months = API.monthsBetween(from, to);
  const sts = months.map(mk => checkStatement(API.buildStatement(mk), 'month'));
  // Each month opens where the last one closed, and the end is today's balance.
  for (let i = 1; i < sts.length; i++) {
    state.accounts.forEach(a => {
      const sec = st => (st.sections.find(s => s.cur === curOf(a)) || { accounts: [] }).accounts.find(x => x.a === a);
      const prev = sec(sts[i - 1]), cur = sec(sts[i]);
      const closing = prev ? prev.closing : null, opening = cur ? cur.opening : null;
      if (closing !== null && opening !== null) ok(same(closing, opening), 'month: one month closes where the next one opens', `${a.name} ${closing} → ${opening}`);
    });
  }
  const after = API.buildStatement(nextMk(to));
  state.accounts.forEach(a => {
    const sec = after.sections.find(s => s.cur === curOf(a));
    const x = sec && sec.accounts.find(y => y.a === a);
    ok(same(x ? x.closing : API.effectiveBal(a), API.effectiveBal(a)), 'month: after the last row, the closing balance is the Accounts page balance', `${a.name}`);
  });
  // A range is its months added together.
  const lo = int(0, months.length - 1), hi = int(lo, months.length - 1);
  const range = checkStatement(API.buildStatement(months[lo], months[hi]), 'range');
  const parts = months.slice(lo, hi + 1).map(mk => API.buildStatement(mk));
  range.sections.forEach(s => {
    const sum = k => parts.reduce((v, p) => v + cents((p.sections.find(q => q.cur === s.cur) || { [k]: 0 })[k] || 0), 0) / 100;
    ok(same(s.moneyIn, sum('moneyIn')) && same(s.moneyOut, sum('moneyOut')) && same(s.net, sum('net')), 'range: money in and out are the months added together', `${s.cur}`);
    s.accounts.forEach(x => {
      const first = parts.map(p => (p.sections.find(q => q.cur === s.cur) || { accounts: [] }).accounts.find(y => y.a === x.a)).find(Boolean);
      const lastSt = parts[parts.length - 1].sections.find(q => q.cur === s.cur);
      const last = lastSt && lastSt.accounts.find(y => y.a === x.a);
      if (first) ok(same(first.opening, x.opening), 'range: it opens where its first month opens', x.a.name);
      if (last) ok(same(last.closing, x.closing), 'range: it closes where its last month closes', x.a.name);
    });
  });

  // The Excel and CSV files carry the same figures.
  const st = API.buildStatement(pick(months));
  const sheets = API.statementSheets(st, 'Statement');
  const val = c => (c && typeof c === 'object') ? c.v : c;
  const sumRows = sheets[0].rows.filter(r => r.length === 6 && st.sections.some(s => val(r[0]) === s.cur));
  ok(sumRows.length === st.sections.length && sumRows.every(r => {
    const s = st.sections.find(q => q.cur === val(r[0]));
    return same(val(r[1]), s.moneyIn) && same(val(r[2]), s.moneyOut) && same(val(r[3]), s.net)
      && (!s.accounts.length || (same(val(r[4]), s.openTot) && same(val(r[5]), s.closeTot)));
  }), 'sheets: the Summary sheet has the statement\'s figures');
  st.sections.forEach(s => {
    const sh = sheets.find(x => x.name === s.cur);
    ok(!!sh, 'sheets: one sheet per currency', s.cur);
    if (!sh) return;
    const txRows = sh.rows.filter(r => r.length === 7 && val(r[0]) && /^\d{4}-\d{2}-\d{2}$/.test(val(r[0])) && val(r[1]) !== 'Opening balance' && val(r[1]) !== 'Closing balance' && val(r[1]) !== 'Balance brought forward');
    const lines = s.accounts.flatMap(x => x.lines);
    ok(txRows.length === lines.length && txRows.every((r, i) => same(val(r[6]), lines[i].bal) && same(val(r[4]) || 0, Math.max(0, lines[i].e)) && same(val(r[5]) || 0, Math.max(0, -lines[i].e))),
       'sheets: every ledger row and running balance matches the statement', `${s.cur}: ${txRows.length} rows vs ${lines.length} lines`);
    const closes = sh.rows.filter(r => val(r[1]) === 'Closing balance').map(r => val(r[6]));
    ok(closes.length === s.accounts.filter(x => x.lines.length).length && closes.every((v, i) => same(v, s.accounts.filter(x => x.lines.length)[i].closing)),
       'sheets: every closing balance matches');
  });
  const csv = API.sheetsToCSV(sheets);
  ok(csv.charCodeAt(0) === 0xFEFF && !/\r(?!\n)/.test(csv), 'csv: UTF-8 marker and CRLF line ends');
}

// ── 2. Text that a spreadsheet would run as a formula ──────────────────────
group('CSV cells can never become formulas');
['=1+1', '+65 9123 4567', '-S$12 refund', '@SUM(A1)', '\t=cmd', '=HYPERLINK("http://x","y")'].forEach(s => {
  const cell = API.csvCell(s);
  const inner = cell.replace(/^"|"$/g, '');
  ok(!/^[=+\-@\t\r]/.test(inner), `"${s}" is written so it stays text`, cell);
});
ok(API.csvCell('Kopi "O" & toast') === '"Kopi ""O"" & toast"', 'quotes inside a cell are doubled', API.csvCell('Kopi "O" & toast'));
ok(API.csvCell('-') === `"'-"` && API.csvCell('Salary') === '"Salary"', 'ordinary text is untouched; a lone dash stays text', API.csvCell('-'));

// ── 3. Calendar and number formatting ──────────────────────────────────────
group('Month ends and number format');
let endsOk = true, bad = '';
for (let y = 1900; y <= 2100; y++) for (let m = 1; m <= 12; m++) {
  const mk = `${y}-${String(m).padStart(2, '0')}`;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  if (API.stmtMonthEnd(mk) !== `${mk}-${String(days).padStart(2, '0')}`) { endsOk = false; bad = mk; }
}
ok(endsOk, 'every month from 1900 to 2100 ends on its last day (leap years too)', bad);
ok(API.monthsBetween('2025-11', '2026-02').join() === '2025-11,2025-12,2026-01,2026-02', 'months run across a year end');
ok(API.monthsBetween('2026-03', '2026-01').length === 0, 'a backwards range is empty, not endless');
ok(API.stmtNum(0) === '–' && API.stmtNum(0.004) === '–' && API.stmtNum(-0.004) === '–', 'nothing reads as a dash');
ok(API.stmtNum(1234567.891) === '1,234,567.89' && API.stmtNum(-1234.5) === '(1,234.50)' && API.stmtNum(0.1 + 0.2) === '0.30', 'thousands, two decimals, negatives in brackets', `${API.stmtNum(1234567.891)} ${API.stmtNum(-1234.5)} ${API.stmtNum(0.1 + 0.2)}`);
ok(API.stmtNum(-0.005) === '(0.01)' && API.stmtNum(0.005) === '0.01', 'half a cent rounds the same way either side of zero', `${API.stmtNum(-0.005)} ${API.stmtNum(0.005)}`);

// ── 4. A real backup, if given ─────────────────────────────────────────────
if (process.env.PFMT_BACKUP) {
  const dir = process.env.PFMT_BACKUP.replace(/^~/, require('os').homedir());
  group(`Real books in ${dir}`);
  const read = t => JSON.parse(fs.readFileSync(path.join(dir, t + '.json'), 'utf8'));
  const accs = read('accounts'), txns = read('transactions'), prefs = read('preferences');
  [...new Set(txns.map(t => t.user_id))].forEach(uid => {
    const pref = prefs.find(p => p.user_id === uid) || {};
    load({
      home: pref.currency || 'SGD',
      accounts: accs.filter(a => a.user_id === uid).map(a => ({ id: a.id, name: a.name, type: a.type, institution: a.institution || '', currency: a.currency || 'SGD', balance: +a.starting_balance })),
      transactions: txns.filter(t => t.user_id === uid).map(t => ({ id: t.id, type: t.type, amount: +t.amount, description: t.description, category: t.category,
        account: t.account, date: t.date, currency: t.currency || 'SGD', transferGroup: t.transfer_group || '',
        created: t.created_at ? new Date(t.created_at).toISOString().slice(0, 19).replace('T', ' ') : '' })),
    });
    const ms = state.transactions.map(t => t.date.slice(0, 7)).sort();
    const months = API.monthsBetween(ms[0], ms[ms.length - 1]);
    const before = failed;
    months.forEach(mk => checkStatement(API.buildStatement(mk), `book ${uid.slice(0, 8)}`));
    checkStatement(API.buildStatement(months[0], months[months.length - 1]), `book ${uid.slice(0, 8)} all months`);
    const lastClose = API.buildStatement(nextMk(months[months.length - 1]));
    const balOk = state.accounts.every(a => { const s = lastClose.sections.find(q => q.cur === curOf(a)); const x = s && s.accounts.find(y => y.a === a); return same(x ? x.closing : API.effectiveBal(a), API.effectiveBal(a)); });
    ok(balOk, `book ${uid.slice(0, 8)}: statements end on the Accounts page balances`);
    console.log(`  ${uid.slice(0, 8)}: ${months.length} monthly statements, ${state.transactions.length} transactions, ${state.accounts.length} accounts — ${failed === before ? 'all correct' : (failed - before) + ' problems'}`);
  });
}

console.log(`\n${failed ? 'FAIL' : 'PASS'} — ${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
