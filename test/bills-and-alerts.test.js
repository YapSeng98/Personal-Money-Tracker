#!/usr/bin/env node
/*
 * Tests for the monthly-bills checklist and the Telegram alerts.
 *
 * Run:  node test/bills-and-alerts.test.js
 *
 * Like budget-invariants.test.js, these load the REAL functions out of
 * index.html rather than copies, so the tests fail if the shipped code drifts.
 *
 * What they protect:
 *   1. The shared money-rules block is byte-identical in index.html and in the
 *      Edge Function. Two copies of money maths is how the Analytics trend came
 *      to disagree with the dashboard; this is the guard against a repeat.
 *   2. One transaction can never tick off two bills.
 *   3. A bill is only "paid" when the ledger really shows a matching payment —
 *      right category, right account, right currency, right month, right amount.
 *   4. A bill due on the 31st is still due in a 30-day month.
 *   5. An alert never contradicts the budget bar the user is looking at.
 *   6. An alert fires once per level per month, never once per expense.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let passed = 0, failed = 0;
function ok(cond, name, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function group(name) { console.log(`\n${name}\n`); }
const near = (a, b) => Math.abs(a - b) < 0.005;

// ── 1. the two copies must be identical ────────────────────────────────────
group('The shared money rules exist in exactly one form');
try {
  const out = execFileSync(process.execPath,
    [path.join(ROOT, 'tools', 'sync-shared-rules.js'), '--check'],
    { encoding: 'utf8' });
  ok(/in sync/.test(out), 'index.html and pfmt-notify agree character for character');
} catch (e) {
  ok(false, 'index.html and pfmt-notify agree character for character',
     'OUT OF SYNC — run `node tools/sync-shared-rules.js`');
}

// ── lift the shared block straight out of the page and run it ──────────────
const BEGIN = 'PFMT SHARED MONEY RULES — v1 — BEGIN';
const END   = 'PFMT SHARED MONEY RULES — v1 — END';
const blockStart = HTML.indexOf('\n', HTML.indexOf(BEGIN)) + 1;
const blockEnd   = HTML.lastIndexOf('\n', HTML.indexOf(END)) + 1;
const BLOCK      = HTML.slice(blockStart, blockEnd);
if (!BLOCK.trim()) { console.error('could not find the shared block in index.html'); process.exit(1); }

const EXPORTS = ['PFMT_CLAIMS_CATEGORY', 'pfmtIsFlow', 'pfmtPaybackOffsets', 'pfmtPrevMonth',
  'pfmtDaysInMonth', 'pfmtBudgetSpent', 'pfmtBudgetRollover', 'pfmtBudgetLimit',
  'pfmtBudgetAlerts', 'pfmtBillDueDate', 'pfmtMatchBills', 'pfmtBillStatus',
  'pfmtDaysUntil', 'pfmtBillsToRemind'];
const R = new Function(BLOCK + `\nreturn {${EXPORTS.join(',')}};`)();

// Everything the page itself adds on top of the shared rules.
function extract(name) {
  for (const p of [new RegExp(`\\nfunction ${name}\\s*\\(`), new RegExp(`\\nconst ${name}\\s*=`)]) {
    const m = HTML.match(p);
    if (!m) continue;
    const start = m.index + 1;
    const brace = HTML.indexOf('{', start);
    const semi  = HTML.indexOf(';', start);
    if (semi !== -1 && (brace === -1 || semi < brace)) return HTML.slice(start, semi + 1);
    let depth = 0;
    for (let i = brace; i < HTML.length; i++) {
      if (HTML[i] === '{') depth++;
      else if (HTML[i] === '}' && --depth === 0) return HTML.slice(start, i + 1);
    }
  }
  throw new Error(`could not find ${name}() in index.html`);
}
const PAGE_NAMES = ['billMatches', 'updateBillsBadge'];
const state = { currency: 'SGD', filterMonth: '2026-09', transactions: [], bills: [], budgets: [] };
const PAGE = new Function('state', 'document', 'localYM', 'localDateStr',
  ...EXPORTS,
  PAGE_NAMES.map(extract).join('\n') + `\nreturn {${PAGE_NAMES.join(',')}};`)(
  state, { getElementById: () => null }, () => '2026-09', () => '2026-09-16',
  ...EXPORTS.map(n => R[n]));

// ── fixtures ───────────────────────────────────────────────────────────────
const txn = (o) => Object.assign({
  id: 't' + Math.random().toString(36).slice(2), type: 'expense', amount: 0,
  description: '', category: 'Bills', account: 'DBS Checking', date: '2026-09-05',
  currency: 'SGD', transferGroup: ''
}, o);
const bill = (o) => Object.assign({
  id: 'b' + Math.random().toString(36).slice(2), name: 'Bill', amount: 0,
  currency: 'SGD', category: 'Bills', account: '', dueDay: 1,
  amountVaries: false, isActive: true
}, o);

// ── 2. matching ────────────────────────────────────────────────────────────
group('A bill is ticked off by the ledger, not by hand');
{
  const rent = bill({ id: 'rent', name: 'Rent', amount: 1500, dueDay: 1 });
  const phone = bill({ id: 'phone', name: 'Phone', amount: 42.90, dueDay: 12 });
  const bills = [rent, phone];
  const txns = [
    txn({ id: 'x1', amount: 1500, description: 'September rent', date: '2026-09-01' }),
    txn({ id: 'x2', amount: 42.90, description: 'Singtel', date: '2026-09-11' })
  ];
  const m = R.pfmtMatchBills(bills, txns, '2026-09', 'SGD');
  ok(m.rent && m.rent.id === 'x1', 'the rent payment ticks off rent');
  ok(m.phone && m.phone.id === 'x2', 'the phone payment ticks off the phone bill');

  const empty = R.pfmtMatchBills(bills, [], '2026-09', 'SGD');
  ok(empty.rent === null && empty.phone === null, 'nothing paid means nothing ticked');

  // The bug this guards: two bills in one category, one transaction.
  const a = bill({ id: 'a', name: 'Netflix', amount: 19.98, category: 'Entertainment' });
  const b = bill({ id: 'b', name: 'Spotify', amount: 19.98, category: 'Entertainment' });
  const one = [txn({ id: 'only', amount: 19.98, category: 'Entertainment' })];
  const m2 = R.pfmtMatchBills([a, b], one, '2026-09', 'SGD');
  const hits = [m2.a, m2.b].filter(Boolean);
  ok(hits.length === 1, 'one transaction can only ever tick off ONE bill',
     `ticked ${hits.length}`);

  // Two identical bills, two identical payments — both settled.
  const two = [txn({ id: 'p1', amount: 19.98, category: 'Entertainment' }),
               txn({ id: 'p2', amount: 19.98, category: 'Entertainment' })];
  const m3 = R.pfmtMatchBills([a, b], two, '2026-09', 'SGD');
  ok(m3.a && m3.b && m3.a.id !== m3.b.id, 'two payments settle two bills, one each');
}

group('A match has to be a real match');
{
  const b1 = bill({ id: 'b1', name: 'Insurance', amount: 200, category: 'Health' });
  const wrongCat  = [txn({ amount: 200, category: 'Shopping' })];
  const wrongCur  = [txn({ amount: 200, category: 'Health', currency: 'MYR' })];
  const wrongMonth= [txn({ amount: 200, category: 'Health', date: '2026-08-03' })];
  const income    = [txn({ amount: 200, category: 'Health', type: 'income' })];
  const transfer  = [txn({ amount: 200, category: 'Health', transferGroup: 'g1' })];
  const wrongAmt  = [txn({ amount: 260, category: 'Health' })];
  ok(R.pfmtMatchBills([b1], wrongCat,   '2026-09', 'SGD').b1 === null, 'a different category does not count');
  ok(R.pfmtMatchBills([b1], wrongCur,   '2026-09', 'SGD').b1 === null, 'a different currency does not count');
  ok(R.pfmtMatchBills([b1], wrongMonth, '2026-09', 'SGD').b1 === null, 'last month\'s payment does not count');
  ok(R.pfmtMatchBills([b1], income,     '2026-09', 'SGD').b1 === null, 'income does not pay a bill');
  ok(R.pfmtMatchBills([b1], transfer,   '2026-09', 'SGD').b1 === null, 'a transfer leg does not pay a bill');
  ok(R.pfmtMatchBills([b1], wrongAmt,   '2026-09', 'SGD').b1 === null, 'a very different amount does not count');

  // Small drift is fine — a bank fee or a cent of rounding.
  const close = [txn({ id: 'c', amount: 203, category: 'Health' })];
  ok(R.pfmtMatchBills([b1], close, '2026-09', 'SGD').b1 !== null,
     'a few dollars of drift still counts as paid (2% tolerance)');

  // A bill tied to one account is not settled from another.
  const tied = bill({ id: 'tied', amount: 200, category: 'Health', account: 'OCBC Savings' });
  ok(R.pfmtMatchBills([tied], [txn({ amount: 200, category: 'Health', account: 'DBS Checking' })],
     '2026-09', 'SGD').tied === null, 'a bill tied to one account is not paid from another');
  ok(R.pfmtMatchBills([tied], [txn({ amount: 200, category: 'Health', account: 'OCBC Savings' })],
     '2026-09', 'SGD').tied !== null, 'and is paid from the right one');

  // A varying bill ignores the amount entirely.
  const util = bill({ id: 'util', name: 'Utilities', amount: 90, amountVaries: true });
  ok(R.pfmtMatchBills([util], [txn({ amount: 231.40 })], '2026-09', 'SGD').util !== null,
     'a varying bill matches whatever the real amount turned out to be');

  // A paused bill is out of the picture.
  const off = bill({ id: 'off', amount: 200, category: 'Health', isActive: false });
  ok(R.pfmtMatchBills([off], [txn({ amount: 200, category: 'Health' })], '2026-09', 'SGD').off === undefined,
     'a paused bill is not matched at all');
}

// ── 3. due dates and status ────────────────────────────────────────────────
group('Due dates survive short months');
{
  const b31 = bill({ dueDay: 31 });
  ok(R.pfmtBillDueDate(b31, '2026-09') === '2026-09-30', 'a 31st bill is due on the 30th in September');
  ok(R.pfmtBillDueDate(b31, '2026-02') === '2026-02-28', 'and on the 28th in February 2026');
  ok(R.pfmtBillDueDate(b31, '2024-02') === '2024-02-29', 'and on the 29th in a leap February');
  ok(R.pfmtBillDueDate(bill({ dueDay: 5 }), '2026-09') === '2026-09-05', 'an ordinary due day is left alone');
  ok(R.pfmtBillDueDate(bill({ dueDay: 0 }), '2026-09') === '2026-09-01', 'a nonsense due day falls back to the 1st');
}

group('Bill status reads the calendar honestly');
{
  const b = bill({ dueDay: 10 });
  const today = '2026-09-16';
  ok(R.pfmtBillStatus(b, { id: 'x' }, '2026-09', today) === 'paid',   'matched is paid');
  ok(R.pfmtBillStatus(b, null, '2026-09', today) === 'overdue',       'unpaid past its due day is overdue');
  ok(R.pfmtBillStatus(bill({ dueDay: 25 }), null, '2026-09', today) === 'due', 'unpaid but not yet due is just due');
  ok(R.pfmtBillStatus(b, null, '2026-08', today) === 'missed',        'a finished month that never got paid is missed');
  ok(R.pfmtBillStatus(b, null, '2026-10', today) === 'upcoming',      'next month is upcoming, not overdue');
  ok(R.pfmtBillStatus(bill({ dueDay: 16 }), null, '2026-09', today) === 'due',
     'due TODAY is not yet overdue');
}

// ── 4. reminders ───────────────────────────────────────────────────────────
group('Reminders cover what is close and what is late');
{
  const bills = [
    bill({ id: 'soon', name: 'Rent',    amount: 1500, dueDay: 18 }),
    bill({ id: 'far',  name: 'Insurance', amount: 200, dueDay: 28 }),
    bill({ id: 'late', name: 'Phone',   amount: 42.90, dueDay: 12 }),
    bill({ id: 'done', name: 'Netflix', amount: 19.98, dueDay: 3, category: 'Entertainment' })
  ];
  const txns = [txn({ id: 'nf', amount: 19.98, category: 'Entertainment', date: '2026-09-03' })];
  const out = R.pfmtBillsToRemind(bills, txns, '2026-09', '2026-09-16', 3, 'SGD');
  const ids = out.map(o => o.bill.id);
  ok(ids.includes('late'), 'an overdue bill is reminded about');
  ok(ids.includes('soon'), 'a bill due in 2 days is reminded about');
  ok(!ids.includes('far'), 'a bill due in 12 days is left alone');
  ok(!ids.includes('done'), 'a bill already paid is never reminded about');
  ok(ids[0] === 'late', 'the latest one comes first', `got ${ids.join(', ')}`);
  ok(out.find(o => o.bill.id === 'late').days === -4, 'lateness is counted in days');

  const none = R.pfmtBillsToRemind(bills, txns, '2026-09', '2026-09-16', 0, 'SGD');
  ok(none.map(o => o.bill.id).sort().join(',') === 'late', 'zero lead days still catches what is already late');
  ok(R.pfmtBillsToRemind([], [], '2026-09', '2026-09-16', 3, 'SGD').length === 0, 'no bills, no reminders');
}

// ── 5. alerts agree with the page ──────────────────────────────────────────
group('An alert never contradicts the bar on screen');
{
  // The exact shape that broke production: a payback bigger than the month's
  // spending. The budget bar reads zero, so the alert must stay silent.
  const budgets = [{ id: 'g1', category: 'Other', amount: 440, alertPct: 80, currency: 'SGD', rollover: false }];
  const txns = [
    txn({ amount: 40.84, category: 'Other', date: '2026-09-04' }),
    txn({ amount: 128.20, category: 'Claims', type: 'payback', date: '2026-09-15' })
  ];
  const spent = R.pfmtBudgetSpent(txns, 'Other', 'SGD', '2026-09', 'SGD');
  ok(near(spent, 40.84), 'the claim does not reduce another category', `got ${spent}`);
  ok(R.pfmtBudgetAlerts(budgets, txns, '2026-09', 'SGD').length === 0,
     'a budget at 9% raises no alert');

  // Crossing the threshold, then going over.
  const near80 = [txn({ amount: 360, category: 'Other' })];
  const a1 = R.pfmtBudgetAlerts(budgets, near80, '2026-09', 'SGD');
  ok(a1.length === 1 && a1[0].level === 'near', 'crossing 80% raises one "near" alert',
     JSON.stringify(a1.map(a => a.level)));

  const over = [txn({ amount: 500, category: 'Other' })];
  const a2 = R.pfmtBudgetAlerts(budgets, over, '2026-09', 'SGD');
  ok(a2.length === 1 && a2[0].level === 'over', 'going over raises one "over" alert',
     JSON.stringify(a2.map(a => a.level)));
  ok(near(a2[0].spent, 500) && near(a2[0].limit, 440),
     'the alert quotes the same spent and limit the card shows');

  // Exactly on the line counts as reached, and exactly on the limit is not over.
  const at80 = R.pfmtBudgetAlerts(budgets, [txn({ amount: 352, category: 'Other' })], '2026-09', 'SGD');
  ok(at80.length === 1 && at80[0].level === 'near', 'exactly 80% is "near"');
  const atLimit = R.pfmtBudgetAlerts(budgets, [txn({ amount: 440, category: 'Other' })], '2026-09', 'SGD');
  ok(atLimit.length === 1 && atLimit[0].level === 'near', 'exactly on the limit is not yet over');

  // Rollover raises the limit the alert is judged against. The same S$500 is
  // "over" against a plain 440 budget and perfectly fine against a rolled-over
  // one — the alert has to follow the card, not the raw budget amount.
  const rollOn  = { id: 'g2', category: 'Other', amount: 440, alertPct: 80, currency: 'SGD', rollover: true };
  const rollOff = { id: 'g2', category: 'Other', amount: 440, alertPct: 80, currency: 'SGD', rollover: false };
  const ledger  = [txn({ amount: 40, category: 'Other', date: '2026-08-04' }),
                   txn({ amount: 500, category: 'Other', date: '2026-09-04' })];
  const limit = R.pfmtBudgetLimit(rollOn, ledger, '2026-09', 'SGD');
  ok(near(limit, 840), 'last month\'s unused 400 rolls into this month\'s limit', `got ${limit}`);
  const aOff = R.pfmtBudgetAlerts([rollOff], ledger, '2026-09', 'SGD');
  const aOn  = R.pfmtBudgetAlerts([rollOn],  ledger, '2026-09', 'SGD');
  ok(aOff.length === 1 && aOff[0].level === 'over',
     'S$500 is over a plain S$440 budget', JSON.stringify(aOff.map(a => a.level)));
  ok(aOn.length === 0,
     'and raises nothing once rollover has lifted the limit to S$840',
     JSON.stringify(aOn.map(a => [a.level, a.limit])));
  // Past the raised limit it does fire, quoting the raised limit.
  const wayOver = ledger.concat([txn({ amount: 400, category: 'Other', date: '2026-09-20' })]);
  const aBig = R.pfmtBudgetAlerts([rollOn], wayOver, '2026-09', 'SGD');
  ok(aBig.length === 1 && aBig[0].level === 'over' && near(aBig[0].limit, 840),
     'and past S$840 it fires, quoting S$840 — the figure the card shows',
     JSON.stringify(aBig.map(a => [a.level, a.limit])));

  // Currencies never mix.
  const myr = [{ id: 'g3', category: 'Other', amount: 100, alertPct: 80, currency: 'MYR', rollover: false }];
  const sgdOnly = [txn({ amount: 500, category: 'Other', currency: 'SGD' })];
  ok(R.pfmtBudgetAlerts(myr, sgdOnly, '2026-09', 'SGD').length === 0,
     'SGD spending never trips an MYR budget');

  // A budget of zero can't be a percentage of anything.
  const zero = [{ id: 'g4', category: 'Other', amount: 0, alertPct: 80, currency: 'SGD', rollover: false }];
  const az = R.pfmtBudgetAlerts(zero, over, '2026-09', 'SGD');
  ok(az.length === 0, 'a zero budget raises no alert rather than an infinite percentage');
  ok(!az.some(a => Number.isNaN(a.pct)), 'and nothing is NaN');
}

// ── 5b. an unreachable threshold must not fail silently ────────────────────
group('A threshold that can never be reached says so');
{
  const V = new Function(extract('ALERT_PCT_MIN') + '\n' + extract('isValidAlertPct') +
                         '\nreturn {ALERT_PCT_MIN, ALERT_PCT_MAX, isValidAlertPct};')();
  ok(V.isValidAlertPct(80),  '80 is a valid threshold');
  ok(V.isValidAlertPct(10),  '10, the floor, is valid');
  ok(V.isValidAlertPct(100), '100, the ceiling, is valid');
  // The exact values the ServiceNow import left behind, which switched budget
  // alerts off without a single visible symptom.
  ok(!V.isValidAlertPct(400), '400 is refused — nothing reaches 400% of its own limit');
  ok(!V.isValidAlertPct(150), '150 is refused');
  ok(!V.isValidAlertPct(9),   '9 is refused — below the floor');
  ok(!V.isValidAlertPct(0),   '0 is refused');
  ok(!V.isValidAlertPct(-80), 'a negative threshold is refused');
  ok(!V.isValidAlertPct(NaN), 'NaN is refused rather than silently passing');
  ok(!V.isValidAlertPct(Infinity), 'Infinity is refused');

  // The real-world consequence: with 400 stored, a budget at 90% stays silent.
  const budgets400 = [{ id: 'x', category: 'Health', amount: 480, alertPct: 400, currency: 'SGD', rollover: false }];
  const budgets80  = [{ id: 'x', category: 'Health', amount: 480, alertPct: 80,  currency: 'SGD', rollover: false }];
  const spend = [txn({ amount: 432, category: 'Health' })];
  ok(R.pfmtBudgetAlerts(budgets400, spend, '2026-09', 'SGD').length === 0,
     'a budget at 90% with a 400% threshold really does stay silent');
  ok(R.pfmtBudgetAlerts(budgets80, spend, '2026-09', 'SGD').length === 1,
     'and fires as soon as the threshold is a real percentage');

  // The card has to mark it, or the silence is invisible.
  ok(/const badPct = !isValidAlertPct\(b\.alertPct\)/.test(HTML),
     'the budget card computes whether its threshold is reachable');
  ok(/budget-badpct-badge/.test(HTML), 'and renders a badge when it is not');
  ok(/if \(!isValidAlertPct\(alert\)\)/.test(HTML),
     'and saving a budget refuses an out-of-range threshold outright');
}

// ── 6. dedupe keys ─────────────────────────────────────────────────────────
group('The same alert is never sent twice');
{
  // The keys are built in the Edge Function; this checks the SHAPE the
  // notifications_sent primary key relies on — one row per level per month.
  const FN = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'pfmt-notify', 'index.ts'), 'utf8');
  ok(/\$\{a\.budget\.category\}\|\$\{cur\}\|\$\{month\}\|\$\{a\.level\}/.test(FN),
     'a budget key carries category, currency, month and level');
  ok(/\$\{d\.bill\.id\}\|\$\{month\}\|\$\{level\}/.test(FN),
     'a bill key carries the bill, the month and whether it is late');
  ok(/if \(!await claim\(/.test(FN), 'nothing is sent without claiming the key first');
  ok(/for \(const \[kind, key\] of claimed\) await unclaim/.test(FN),
     'a failed send releases its claims so the next run retries');
  ok(/primary key \(user_id, kind, dedupe_key\)/.test(
       fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '002_bills_and_notifications.sql'), 'utf8')),
     'and the database enforces it, not just the code');
}

// ── 7. the page wrappers ───────────────────────────────────────────────────
group('The page asks the shared rules, and nothing else');
{
  state.bills = [bill({ id: 'p1', name: 'Rent', amount: 1500 })];
  state.transactions = [txn({ id: 'r1', amount: 1500, date: '2026-09-01' })];
  const m = PAGE.billMatches();
  ok(m.p1 && m.p1.id === 'r1', 'billMatches() defaults to the month being browsed');
  ok(PAGE.billMatches('2026-08').p1 === null, 'and can be asked about another month');
  // The badge only counts; with no DOM it must not throw.
  let threw = false;
  try { PAGE.updateBillsBadge(); } catch (e) { threw = true; }
  ok(!threw, 'the sidebar count is resilient to its element not existing yet');
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} checks passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
