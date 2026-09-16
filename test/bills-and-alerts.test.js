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
  'pfmtAlertAt', 'pfmtBudgetAlerts', 'pfmtBillDueDate', 'pfmtMatchBills', 'pfmtBillStatus',
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
  // The threshold is an AMOUNT the user typed, not a percentage of anything:
  // "warn me once I've spent 380 of my 400".
  const b400 = { id: 'g0', category: 'Other', amount: 400, alertAmount: 380, currency: 'SGD', rollover: false };
  const at = n => R.pfmtBudgetAlerts([b400], [txn({ amount: n, category: 'Other' })], '2026-09', 'SGD');
  ok(at(381).length === 1 && at(381)[0].level === 'near', 'spent 381 against a 380 threshold fires');
  ok(at(380).length === 1 && at(380)[0].level === 'near', 'spent exactly 380 fires — equal or more');
  ok(at(379).length === 0, 'spent 379 stays silent');
  ok(at(400).length === 1 && at(400)[0].level === 'near', 'spent exactly the limit is not yet over');
  ok(at(401).length === 1 && at(401)[0].level === 'over', 'spent 401 is over budget');
  ok(near(at(381)[0].at, 380), 'the alert carries the amount it fired at, for the message');

  // The real September book: the claim must not reduce another category.
  const budgets = [{ id: 'g1', category: 'Other', amount: 440, alertAmount: 400, currency: 'SGD', rollover: false }];
  const txns = [
    txn({ amount: 40.84, category: 'Other', date: '2026-09-04' }),
    txn({ amount: 128.20, category: 'Claims', type: 'payback', date: '2026-09-15' })
  ];
  const spent = R.pfmtBudgetSpent(txns, 'Other', 'SGD', '2026-09', 'SGD');
  ok(near(spent, 40.84), 'the claim does not reduce another category', `got ${spent}`);
  ok(R.pfmtBudgetAlerts(budgets, txns, '2026-09', 'SGD').length === 0,
     'S$40.84 against a S$400 threshold raises nothing');

  // Health, the case that started this: 432 spent, warn at 400.
  const health = [{ id: 'h', category: 'Health', amount: 480, alertAmount: 400, currency: 'SGD', rollover: false }];
  const hs = R.pfmtBudgetAlerts(health, [txn({ amount: 432, category: 'Health' })], '2026-09', 'SGD');
  ok(hs.length === 1 && hs[0].level === 'near' && near(hs[0].at, 400),
     'Health at 432 with a 400 threshold fires — the alert that was silently dead',
     JSON.stringify(hs.map(x => [x.level, x.at])));

  // Unset falls back to 80% of the limit rather than never warning.
  const unset = [{ id: 'u', category: 'Other', amount: 400, alertAmount: 0, currency: 'SGD', rollover: false }];
  ok(near(R.pfmtAlertAt(unset[0]), 320), 'an unset threshold falls back to 80% of the limit');
  ok(R.pfmtBudgetAlerts(unset, [txn({ amount: 330, category: 'Other' })], '2026-09', 'SGD').length === 1,
     'and still warns');

  // Rollover raises the limit, but the threshold is an amount and does not move.
  const rollOn = { id: 'r', category: 'Other', amount: 440, alertAmount: 400, currency: 'SGD', rollover: true };
  const ledger = [txn({ amount: 40, category: 'Other', date: '2026-08-04' }),
                  txn({ amount: 500, category: 'Other', date: '2026-09-04' })];
  const limit = R.pfmtBudgetLimit(rollOn, ledger, '2026-09', 'SGD');
  const aRoll = R.pfmtBudgetAlerts([rollOn], ledger, '2026-09', 'SGD');
  ok(near(limit, 840), "last month's unused 400 rolls into this month's limit", `got ${limit}`);
  ok(aRoll.length === 1 && aRoll[0].level === 'near',
     'S$500 passed the S$400 threshold but is under the rolled-over S$840 limit — near, not over',
     JSON.stringify(aRoll.map(x => x.level)));

  // Currencies never mix.
  const myr = [{ id: 'm', category: 'Other', amount: 100, alertAmount: 80, currency: 'MYR', rollover: false }];
  ok(R.pfmtBudgetAlerts(myr, [txn({ amount: 500, category: 'Other', currency: 'SGD' })], '2026-09', 'SGD').length === 0,
     'SGD spending never trips an MYR budget');

  // A budget of zero can't be judged at all.
  const zero = [{ id: 'z', category: 'Other', amount: 0, alertAmount: 0, currency: 'SGD', rollover: false }];
  const az = R.pfmtBudgetAlerts(zero, [txn({ amount: 500, category: 'Other' })], '2026-09', 'SGD');
  ok(az.length === 0, 'a zero budget raises no alert');
  ok(!az.some(a => Number.isNaN(a.pct)), 'and nothing is NaN');
}

// ── 5b. the threshold is an amount, and the app says so ────────────────────
group('A threshold is an amount the user typed');
{
  const V = new Function(extract('isValidAlertAmount') + '\nreturn {isValidAlertAmount};')();
  ok(V.isValidAlertAmount(380),   '380 is a valid threshold');
  ok(V.isValidAlertAmount(0.5),   'so is 0.50 — it is money, cents allowed');
  ok(V.isValidAlertAmount(10000), 'and so is an amount far above any limit — the user decides');
  ok(!V.isValidAlertAmount(0),    'zero is not a threshold');
  ok(!V.isValidAlertAmount(-5),   'nor is a negative amount');
  ok(!V.isValidAlertAmount(NaN),  'NaN is refused rather than silently passing');

  // A threshold above the limit is allowed but pointless — the card says so.
  ok(/const badPct = alertAboveLimit\(b\)/.test(HTML),
     'the budget card checks whether the threshold sits above the limit');
  ok(/budget-badpct-badge/.test(HTML), 'and renders a badge when it does');
  ok(/if \(!isValidAlertAmount\(alert\)\)/.test(HTML),
     'and saving refuses a zero or negative threshold');
  // The old percentage model must be gone from the page entirely.
  ok(!/alertPct/.test(HTML), 'no alertPct left anywhere in the page');
  ok(!/alert_pct/.test(HTML), 'and no alert_pct column reference either');
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
