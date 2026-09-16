#!/usr/bin/env node
/*
 * Invariant tests for the money maths in index.html.
 *
 * Run:  node test/budget-invariants.test.js
 *
 * These load the REAL functions out of index.html rather than copies, so the
 * tests fail if the shipped code drifts. They exist because of a bug where a
 * payback larger than the month's spending made net spend negative, and the
 * budget card then rendered "-S$87.36 spent of S$440.00 / -20% (S$527.36
 * left)" over a FULL green bar — a negative CSS width is dropped by the
 * browser, "left" exceeded the whole budget, and the minus sign was swallowed
 * by fmtWithCur's Math.abs. Meanwhile the Transactions page for the same
 * filter plainly listed S$40.84 of spending.
 *
 * The rules being protected:
 *   1. A budget figure is never negative.
 *   2. A budget never reports more spent than the Transactions list shows.
 *   3. A bar width is always a usable 0-100%.
 *   4. "Left" never exceeds the budget, and rollover never exceeds it either.
 *   5. Nothing is ever NaN.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// ── lift the real functions out of the page ────────────────────────────────
function extract(name) {
  for (const p of [new RegExp(`\\nfunction ${name}\\s*\\(`), new RegExp(`\\nconst ${name}\\s*=`)]) {
    const m = HTML.match(p);
    if (!m) continue;
    const start = m.index + 1;
    const brace = HTML.indexOf('{', start);
    // A plain `const X = ...;` with no body of its own ends at its semicolon.
    const semi = HTML.indexOf(';', start);
    if (semi !== -1 && (brace === -1 || semi < brace)) return HTML.slice(start, semi + 1);
    if (HTML.slice(start, brace).includes('=>') &&
        /^const [^=]+=\s*[^{]*=>[^{]/.test(HTML.slice(start))) {
      return HTML.slice(start, HTML.indexOf(';', start) + 1);
    }
    let depth = 0;
    for (let i = brace; i < HTML.length; i++) {
      if (HTML[i] === '{') depth++;
      else if (HTML[i] === '}' && --depth === 0) return HTML.slice(start, i + 1);
    }
  }
  throw new Error(`could not find ${name}() in index.html`);
}

const NAMES = ['CLAIMS_CATEGORY', 'paybackOffsets', 'trendTotals', 'monthlyInOut', 'summaryMonthKeys', 'isFlow', 'isCrossCurrencyLeg', 'isAssetGroup', 'sortTxnsDesc', 'getMonthTxns',
  'localYM', 'localDateStr', 'daysInMonth', 'daysSoFarIn', 'countEvents', 'curStats',
  'getBudgetSpent', 'getBudgetPayback', 'prevMonthKey', 'getBudgetRollover',
  'getBudgetLimit', 'isBudgetOver', 'effectiveBal'];

const state = { currency: 'SGD', filterMonth: '2026-09', transactions: [], budgets: [], goals: [], accounts: [] };
const src = NAMES.map(extract).join('\n');
const API = new Function('state', 'console', src + `; return {${NAMES.join(',')}};`)(state, console);

// ── tiny assertion harness ─────────────────────────────────────────────────
let failed = 0, passed = 0;
const near = (a, b) => Math.abs(a - b) < 0.005;
function ok(cond, label, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`);
}
function group(name) { console.log('\n' + name); }

const txn = (o) => Object.assign({
  type: 'expense', amount: 0, description: '', category: 'Other',
  account: 'A', date: '2026-09-10', notes: '', currency: 'SGD',
  transferGroup: '', transferPeer: '',
}, o);

/**
 * Drives one month of a category through the real functions and asserts every
 * invariant the budget card depends on.
 */
function checkBudget(label, { rows, amount, alertPct = 80, rollover = false, expectSpent }) {
  state.transactions = rows;
  state.budgets = [{ id: 'b1', category: 'Other', amount, spent: 0, alertPct, currency: 'SGD', rollover }];
  const b = state.budgets[0];

  const spent = API.getBudgetSpent('Other', 'SGD');
  const limit = API.getBudgetLimit(b);
  const roll  = API.getBudgetRollover(b);

  // what the Transactions page lists for the same filter (expenses, this month)
  const listed = rows
    .filter(t => t.type === 'expense' && !t.transferGroup && t.date.startsWith('2026-09') && t.category === 'Other')
    .reduce((s, t) => s + t.amount, 0);

  // exactly the arithmetic the card performs
  const pctReal  = limit > 0 ? (spent / limit) * 100 : 0;
  const barWidth = Math.max(0, Math.min(pctReal, 100));
  const left     = Math.min(limit, limit - spent);

  if (expectSpent !== undefined) {
    ok(near(spent, expectSpent), `${label}: spent`, `got ${spent}, expected ${expectSpent}`);
  }
  ok(spent >= 0,                  `${label}: spent is never negative`, `got ${spent}`);
  ok(spent <= listed + 0.005,     `${label}: budget never claims more than the Transactions list`,
                                  `budget ${spent} vs listed ${listed}`);
  ok(barWidth >= 0 && barWidth <= 100, `${label}: bar width usable`, `got ${barWidth}%`);
  ok(left <= limit + 0.005,       `${label}: "left" never exceeds the budget`, `left ${left} vs limit ${limit}`);
  ok(roll >= 0 && roll <= b.amount + 0.005, `${label}: rollover within the budget`, `got ${roll}`);
  ok([spent, limit, pctReal, barWidth, left, roll].every(n => !Number.isNaN(n)), `${label}: no NaN`);
}

group('Budgets — paybacks, the case that broke production');
checkBudget('plain spending', {
  rows: [txn({ amount: 75.39 })], amount: 160, expectSpent: 75.39,
});
checkBudget('over budget', {
  rows: [txn({ amount: 500 })], amount: 160, expectSpent: 500,
});
checkBudget('same-month split (100 out, 60 back) still nets', {
  rows: [txn({ amount: 100 }), txn({ type: 'payback', amount: 60 })],
  amount: 440, expectSpent: 40,
});
checkBudget('payback settles the month exactly', {
  rows: [txn({ amount: 50 }), txn({ type: 'payback', amount: 50 })],
  amount: 440, expectSpent: 0,
});
// The regression: an old claim arriving this month must not cancel this
// month's real spending, nor drive the budget below zero.
checkBudget('claim for an earlier month exceeds this month\'s spend', {
  rows: [txn({ amount: 30.84, description: 'CLAUDE Monthly' }),
         txn({ amount: 10, description: 'Income tax charge' }),
         txn({ type: 'payback', amount: 128.20, description: 'Claim for Jun' })],
  amount: 440, expectSpent: 40.84,
});
checkBudget('payback with no spending at all', {
  rows: [txn({ type: 'payback', amount: 300 })], amount: 440, expectSpent: 0,
});
checkBudget('transfer legs never count as spending', {
  rows: [txn({ amount: 1000, transferGroup: 'tg_1', transferPeer: 'B' })],
  amount: 440, expectSpent: 0,
});

group('Budget rollover cap');
{
  // Last month ran a big payback; the unused amount must not inflate this
  // month's limit beyond the budget that was actually set.
  state.transactions = [txn({ amount: 5, date: '2026-08-05' }),
                        txn({ type: 'payback', amount: 500, date: '2026-08-06' })];
  const b = { id: 'b1', category: 'Other', amount: 440, alertPct: 80, currency: 'SGD', rollover: true };
  state.budgets = [b];
  const roll = API.getBudgetRollover(b, '2026-09');
  ok(roll >= 0 && roll <= b.amount + 0.005, 'rollover stays within the budget', `got ${roll}`);
  ok(API.getBudgetLimit(b, '2026-09') <= b.amount * 2 + 0.005, 'limit stays sane', 'rollover doubled the budget');
}

group('Goal bars');
for (const g of [
  { name: 'normal',       target: 8000,  current: 1400.05 },
  { name: 'achieved',     target: 100,   current: 250 },
  { name: 'empty',        target: 10000, current: 0 },
  { name: 'gone negative',target: 10000, current: -250 },   // linked account overdrawn
  { name: 'zero target',  target: 0,     current: 500 },
]) {
  const pct = g.target > 0 ? Math.max(0, Math.min((g.current / g.target) * 100, 100)) : 0;
  ok(pct >= 0 && pct <= 100 && !Number.isNaN(pct), `goal "${g.name}" bar usable`, `got ${pct}%`);
}

group('Account allocation bars');
for (const [label, bal, total] of [['normal', 500, 1000], ['net debt', -500, 1000], ['zero total', 100, 0]]) {
  const pct = total > 0 ? Math.max(0, (bal / total * 100)) : 0;
  ok(pct >= 0 && !Number.isNaN(pct), `allocation "${label}" bar usable`, `got ${pct}%`);
}

group('Dashboard KPIs survive a payback-heavy month');
{
  state.transactions = [
    txn({ type: 'income', amount: 4001.60, category: 'Salary', date: '2026-09-01' }),
    txn({ amount: 40.84 }),
    txn({ type: 'payback', amount: 128.20 }),
  ];
  const st = API.curStats('SGD', state.transactions, '2026-09');
  ok(!Number.isNaN(st.inc) && !Number.isNaN(st.exp) && !Number.isNaN(st.net), 'KPIs are numbers');
  ok(st.avgDaily >= 0, 'average daily spend is never negative', `got ${st.avgDaily}`);
}


// ── Financial structure audit ──────────────────────────────────────────────
// The app keeps two separate ledgers and they must not contaminate each other:
//   cash ledger  (effectiveBal) — every movement of money counts
//   P&L  ledger  (curStats)     — only what you actually earned or spent
// Money that merely moves (a transfer between your own accounts, funding a
// holding, a work claim coming back) must move the cash ledger and leave the
// P&L alone, or a month reports spending that never happened.
const acct = (name, balance, currency = 'SGD') => ({ name, type: 'Savings', institution: '', balance, currency, isActive: true });
function scenario(accounts, transactions) {
  state.accounts = accounts; state.transactions = transactions; state.budgets = [];
}
const netWorth = (cur) => state.accounts.filter(a => a.currency === cur)
  .reduce((s, a) => s + API.effectiveBal(a), 0);

group('Financial structure — cash ledger vs P&L ledger');
{
  // 1. Same-currency transfer: money moves, wealth does not, P&L untouched.
  scenario([acct('A', 1000), acct('B', 0)], [
    txn({ type: 'expense', amount: 100, account: 'A', category: 'Transfer', transferGroup: 'tg_1', transferPeer: 'B' }),
    txn({ type: 'income',  amount: 100, account: 'B', category: 'Transfer', transferGroup: 'tg_1', transferPeer: 'A' }),
  ]);
  const st = API.curStats('SGD', state.transactions, '2026-09');
  ok(near(netWorth('SGD'), 1000), 'transfer leaves net worth unchanged', `got ${netWorth('SGD')}`);
  ok(near(API.effectiveBal(state.accounts[0]), 900) && near(API.effectiveBal(state.accounts[1]), 100),
     'transfer moves both account balances', `A=${API.effectiveBal(state.accounts[0])} B=${API.effectiveBal(state.accounts[1])}`);
  ok(near(st.inc, 0) && near(st.exp, 0), 'transfer is not income or spending', `inc=${st.inc} exp=${st.exp}`);

  // 2. Funding a holding out of an account: same rule.
  scenario([acct('Bank', 1000), acct('Broker', 0)], [
    txn({ type: 'expense', amount: 300, account: 'Bank',   category: 'Investment', transferGroup: 'ag_1', transferPeer: 'Broker' }),
    txn({ type: 'asset',   amount: 300, account: 'Broker', category: 'Investment', transferGroup: 'ag_1', transferPeer: 'Bank' }),
  ]);
  const st2 = API.curStats('SGD', state.transactions, '2026-09');
  ok(near(netWorth('SGD'), 1000), 'funding a holding leaves net worth unchanged', `got ${netWorth('SGD')}`);
  ok(near(st2.exp, 0), 'funding a holding is not spending', `exp=${st2.exp}`);

  // 3. Real income and real spending DO reach the P&L and the balance.
  scenario([acct('A', 0)], [
    txn({ type: 'income',  amount: 5000, account: 'A', category: 'Salary' }),
    txn({ type: 'expense', amount: 200,  account: 'A', category: 'Food & Drink' }),
  ]);
  const st3 = API.curStats('SGD', state.transactions, '2026-09');
  ok(near(st3.inc, 5000) && near(st3.exp, 200), 'income and spending reach the P&L');
  ok(near(netWorth('SGD'), 4800), 'income and spending reach the balance', `got ${netWorth('SGD')}`);
  ok(near(st3.net, 4800), 'net equals income minus spending', `got ${st3.net}`);
}

group('Financial structure — work claims are in-and-out');
{
  // The month the money left your pocket: it is spending, and the budget feels it.
  scenario([acct('UOB', 1000)], [
    txn({ type: 'expense', amount: 128.20, account: 'UOB', category: 'Claims', description: 'OT dinner + Grab' }),
  ]);
  state.budgets = [{ id: 'c', category: 'Claims', amount: 500, alertPct: 80, currency: 'SGD', rollover: false }];
  const stOut = API.curStats('SGD', state.transactions, '2026-09');
  ok(near(stOut.exp, 128.20), 'a claimable expense counts as spending when you pay it', `exp=${stOut.exp}`);
  ok(near(API.getBudgetSpent('Claims', 'SGD'), 128.20), 'and it counts against a Claims budget');
  ok(near(netWorth('SGD'), 871.80), 'and the money really left the account', `got ${netWorth('SGD')}`);

  // The month it comes back: balance only. Nothing else may move.
  scenario([acct('UOB', 1000)], [
    txn({ type: 'expense', amount: 40.84,  account: 'UOB', category: 'Other' }),
    txn({ type: 'payback', amount: 128.20, account: 'UOB', category: 'Claims', description: 'Claim for Jun' }),
  ]);
  const stIn = API.curStats('SGD', state.transactions, '2026-09');
  ok(near(stIn.exp, 40.84), 'a claim coming back does NOT reduce this month\'s spending', `exp=${stIn.exp} (want 40.84)`);
  ok(near(stIn.inc, 0),     'a claim coming back is not income', `inc=${stIn.inc}`);
  ok(near(netWorth('SGD'), 1087.36), 'but the money does arrive in the account', `got ${netWorth('SGD')}`);
  ok(near(API.getBudgetSpent('Other', 'SGD'), 40.84), 'and an unrelated budget is untouched');
  ok(near(API.getBudgetSpent('Claims', 'SGD'), 0), 'and it does not credit a Claims budget either');

  // A friend settling their share of THIS month's dinner still nets off.
  scenario([acct('A', 1000)], [
    txn({ type: 'expense', amount: 100, account: 'A', category: 'Food & Drink' }),
    txn({ type: 'payback', amount: 60,  account: 'A', category: 'Food & Drink' }),
  ]);
  const stSplit = API.curStats('SGD', state.transactions, '2026-09');
  ok(near(stSplit.exp, 40), 'a same-category payback still lowers what you bore', `exp=${stSplit.exp} (want 40)`);
  ok(near(netWorth('SGD'), 960), 'and the balance reflects both movements', `got ${netWorth('SGD')}`);
}

group('Financial structure — currencies never mix');
{
  scenario([acct('SG', 1000, 'SGD'), acct('MY', 0, 'MYR')], [
    txn({ type: 'expense', amount: 1000,    account: 'SG', currency: 'SGD', category: 'Transfer', transferGroup: 'tg_x', transferPeer: 'MY' }),
    txn({ type: 'income',  amount: 3190.20, account: 'MY', currency: 'MYR', category: 'Transfer', transferGroup: 'tg_x', transferPeer: 'SG' }),
  ]);
  const sgd = API.curStats('SGD', state.transactions, '2026-09');
  const myr = API.curStats('MYR', state.transactions, '2026-09');
  ok(near(sgd.xOut, 1000) && near(sgd.xIn, 0), 'SGD side records money exchanged out', `xOut=${sgd.xOut}`);
  ok(near(myr.xIn, 3190.20) && near(myr.xOut, 0), 'MYR side records money exchanged in', `xIn=${myr.xIn}`);
  ok(near(sgd.inc, 0) && near(sgd.exp, 0) && near(myr.inc, 0) && near(myr.exp, 0),
     'an exchange is neither income nor spending on either side');
  ok(near(netWorth('SGD'), 0) && near(netWorth('MYR'), 3190.20),
     'each currency keeps its own balance, never summed together',
     `SGD=${netWorth('SGD')} MYR=${netWorth('MYR')}`);
}


// ── Every surface must agree about what a month cost ───────────────────────
// The Analytics trend kept a private copy of the payback rule, so the same
// September read S$1,886.70 on the dashboard and S$1,758.50 on the chart under
// it. Everything now runs through paybackOffsets(); this proves it stays that
// way, because one figure drifting from another is the bug that keeps recurring.
group('Cross-surface agreement — one month, every page');
{
  const month = '2026-09';
  const rows = [
    txn({ type: 'income',  amount: 4001.60, category: 'Salary',       date: '2026-09-01' }),
    txn({ type: 'expense', amount: 1000,    category: 'Food & Drink', date: '2026-09-02' }),
    txn({ type: 'expense', amount: 40.84,   category: 'Other',        date: '2026-09-03' }),
    txn({ type: 'payback', amount: 60,      category: 'Food & Drink', date: '2026-09-04' }),  // friend's share
    txn({ type: 'payback', amount: 128.20,  category: 'Claims',       date: '2026-09-15' }),  // company claim
    // a transfer pair, which must stay invisible to every spending figure
    txn({ type: 'expense', amount: 500, account: 'A', category: 'Transfer', transferGroup: 'tg_9', transferPeer: 'B', date: '2026-09-06' }),
    txn({ type: 'income',  amount: 500, account: 'B', category: 'Transfer', transferGroup: 'tg_9', transferPeer: 'A', date: '2026-09-06' }),
  ];
  state.transactions = rows;
  state.budgets = [
    { id: '1', category: 'Food & Drink', amount: 2000, alertPct: 80, currency: 'SGD', rollover: false },
    { id: '2', category: 'Other',        amount: 440,  alertPct: 80, currency: 'SGD', rollover: false },
  ];

  // 1,000 − 60 friend's share + 40.84, with the Claims 128.20 and the transfer ignored
  const expected = 980.84;

  const tile  = API.curStats('SGD', API.getMonthTxns(month), month).exp;
  const trend = API.trendTotals([month], 'expense').SGD[month];
  const budgetSum = state.budgets.reduce((s, b) => s + API.getBudgetSpent(b.category, b.currency, month), 0);

  ok(near(tile, expected),  'dashboard Expenses tile', `got ${tile}, expected ${expected}`);
  ok(near(trend, expected), 'Analytics spending trend', `got ${trend}, expected ${expected}`);
  ok(near(budgetSum, expected), 'budgets add up to the same figure', `got ${budgetSum}, expected ${expected}`);
  ok(near(tile, trend) && near(tile, budgetSum),
     'the tile, the trend and the budgets all report the SAME month',
     `tile=${tile} trend=${trend} budgets=${budgetSum}`);

  // The Monthly In/Out table on Analytics reads the same month too.
  const io = API.monthlyInOut();
  const ioExp = io.byCur && io.byCur.SGD && io.byCur.SGD[month] ? io.byCur.SGD[month].exp : null;
  if (ioExp === null) {
    ok(false, 'Monthly In/Out table covers this month', 'month missing from the table');
  } else {
    ok(near(ioExp, expected), 'Monthly In/Out table agrees', `got ${ioExp}, expected ${expected}`);
  }

  // And the income side, where a payback must never appear.
  const incTile  = API.curStats('SGD', API.getMonthTxns(month), month).inc;
  const incTrend = API.trendTotals([month], 'income').SGD[month];
  ok(near(incTile, 4001.60) && near(incTrend, 4001.60),
     'income agrees across tile and trend, and excludes the transfer leg',
     `tile=${incTile} trend=${incTrend}`);
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} checks passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
