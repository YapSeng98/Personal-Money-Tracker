// GENERATED — do not edit by hand.
//
// The block below is copied verbatim out of index.html by
// tools/sync-shared-rules.js. index.html is where money maths is edited; this
// file exists so the Edge Function can reach the same rules, and so the two can
// be compared character for character in the tests.
//
// It stays a .js file on purpose: the shared block carries no type annotations
// (it has to parse in a browser too), and Deno does not type-check plain .js,
// so index.ts keeps its own type checking.

/* ═══════════════ PFMT SHARED MONEY RULES — v1 — BEGIN ═══════════════ */

// Work money you front and later get back. The expense counts in the month you
// paid it — you really were out of pocket then — but the reimbursement is a
// pure in-and-out: it credits the account it lands in and touches nothing else,
// because the spending it settles was already counted in its own month.
// Netting it again where it lands would make an unrelated month look cheaper.
const PFMT_CLAIMS_CATEGORY = 'Claims';

// A transfer or asset purchase moves money without spending or earning it, so
// its two legs are excluded from every income/expense figure.
function pfmtIsFlow(t) { return !t.transferGroup; }

// THE definition of whether a payback comes off what a month cost you, used by
// every spending figure in the app — the dashboard tile, the trend chart, both
// category breakdowns, the budgets, and now the alerts. It lives in one place
// because it did not: the Claims rule was added to four of those five and the
// Analytics trend kept its own copy, so the same month read S$1,886.70 on the
// dashboard and S$1,758.50 on the chart below it.
function pfmtPaybackOffsets(t) {
  return t.type === 'payback' && t.category !== PFMT_CLAIMS_CATEGORY;
}

// 'YYYY-MM' arithmetic done on the string, never through a Date — a Date built
// from a month key is midnight UTC, which is the previous day in Singapore and
// silently moved month boundaries.
function pfmtPrevMonth(ym) {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  return py + '-' + String(pm).padStart(2, '0');
}
function pfmtDaysInMonth(ym) {
  return new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
}

// What a category cost in one month, in one currency. The single figure behind
// every budget bar, the dashboard tile and the alerts.
function pfmtBudgetSpent(txns, category, currency, month, fallbackCur) {
  const cur  = currency || fallbackCur;
  const mine = txns.filter(function (t) {
    return t.date.slice(0, 7) === month && t.category === category &&
           (t.currency || fallbackCur) === cur;
  });
  const spent = mine.filter(function (t) { return t.type === 'expense' && pfmtIsFlow(t); })
                    .reduce(function (s, t) { return s + t.amount; }, 0);
  // Money paid back to you for this category was never really your cost — so a
  // friend settling their share of this month's dinner correctly lowers what
  // the budget counts. Claims reimbursements are neutral (see
  // PFMT_CLAIMS_CATEGORY), so they never reduce a budget.
  const back = mine.filter(pfmtPaybackOffsets)
                   .reduce(function (s, t) { return s + t.amount; }, 0);
  // But only so much of it can be settling this month: a payback bigger than
  // everything spent in the category is covering something outside this month.
  // Past what was spent it stops offsetting, and the budget shows what went out.
  if (back > spent) return Math.round(spent * 100) / 100;
  return Math.round((spent - back) * 100) / 100;
}

// Last month's unspent room, for budgets with rollover switched on. Capped at
// the budget itself so a payback-heavy month can't raise this month's limit
// above what was set.
function pfmtBudgetRollover(b, txns, month, fallbackCur) {
  if (!b.rollover) return 0;
  const prev   = pfmtBudgetSpent(txns, b.category, b.currency, pfmtPrevMonth(month), fallbackCur);
  const unused = Math.round((b.amount - prev) * 100) / 100;
  return Math.min(b.amount, Math.max(0, unused));
}
function pfmtBudgetLimit(b, txns, month, fallbackCur) {
  return Math.round((b.amount + pfmtBudgetRollover(b, txns, month, fallbackCur)) * 100) / 100;
}

// Which budgets have earned a warning this month. Judged against the same
// effective limit the card draws, rollover included, so an alert can never
// contradict the bar the user is looking at.
function pfmtBudgetAlerts(budgets, txns, month, fallbackCur) {
  const out = [];
  budgets.forEach(function (b) {
    const limit = pfmtBudgetLimit(b, txns, month, fallbackCur);
    if (!(limit > 0)) return;
    const spent = pfmtBudgetSpent(txns, b.category, b.currency, month, fallbackCur);
    const pct   = (spent / limit) * 100;
    const at    = b.alertPct || 80;
    // 'over' and 'near' are separate levels, not one escalating message, so
    // crossing the threshold notifies once and going over notifies once more —
    // rather than a message per expense for the rest of the month.
    if (spent > limit)  out.push({ budget: b, spent: spent, limit: limit, pct: pct, level: 'over' });
    else if (pct >= at) out.push({ budget: b, spent: spent, limit: limit, pct: pct, level: 'near' });
  });
  return out;
}

// The day a bill falls due in a given month, clamped to months that are too
// short for it — a 31st-of-the-month bill is due on the 30th in September.
function pfmtBillDueDate(bill, month) {
  const day = Math.min(Math.max(Number(bill.dueDay) || 1, 1), pfmtDaysInMonth(month));
  return month + '-' + String(day).padStart(2, '0');
}

// Which transaction, if any, paid each bill this month.
//
// The bill is an expectation the user typed once; the transaction is what
// actually left the account. Nothing is stored — matching is recomputed on
// every render, the same way budgets and savings rate are — so there is no
// "paid" flag that can fall out of step with the ledger.
//
// One transaction can only settle one bill: bills with the fewest candidates
// are matched first, so a bill whose only possible payment is a single row is
// never robbed of it by a looser bill that had other options.
function pfmtMatchBills(bills, txns, month, fallbackCur) {
  const pool = txns.filter(function (t) {
    return t.type === 'expense' && pfmtIsFlow(t) && t.date.slice(0, 7) === month;
  });
  const ranked = bills.filter(function (b) { return b.isActive !== false; }).map(function (b) {
    const cur = b.currency || fallbackCur;
    // A fixed bill has to match its amount, within rounding and small fee
    // drift. A bill marked as varying (utilities, phone) matches on category
    // and account alone, because its amount is never the same twice.
    const tol = b.amountVaries ? Infinity : Math.max(1, Math.abs(b.amount) * 0.02);
    return { bill: b, cands: pool.filter(function (t) {
      return (t.currency || fallbackCur) === cur && t.category === b.category &&
             (!b.account || t.account === b.account) &&
             Math.abs(t.amount - b.amount) <= tol;
    }) };
  });
  ranked.sort(function (a, b) {
    return a.cands.length - b.cands.length || String(a.bill.id).localeCompare(String(b.bill.id));
  });
  const claimed = {}, out = {};
  ranked.forEach(function (r) {
    let best = null;
    r.cands.forEach(function (t) {
      if (claimed[t.id]) return;
      if (!best || Math.abs(t.amount - r.bill.amount) < Math.abs(best.amount - r.bill.amount)) best = t;
    });
    if (best) claimed[best.id] = true;
    out[r.bill.id] = best;
  });
  return out;
}

// 'paid' | 'overdue' | 'due' | 'upcoming' | 'missed'.
// A month that has already ended and never got a matching transaction reads as
// 'missed' when you page back to it; the month in progress always starts clean,
// because nothing about a bill is carried forward.
function pfmtBillStatus(bill, matched, month, today) {
  if (matched) return 'paid';
  const thisMonth = today.slice(0, 7);
  if (month < thisMonth) return 'missed';
  if (month > thisMonth) return 'upcoming';
  return pfmtBillDueDate(bill, month) < today ? 'overdue' : 'due';
}

// Days from today until a bill is due — negative once it is late.
function pfmtDaysUntil(dateStr, today) {
  return Math.round((Date.parse(dateStr + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
}

// Unpaid bills close enough to due to be worth a message, soonest first.
// Anything already late is included, however late it is.
function pfmtBillsToRemind(bills, txns, month, today, leadDays, fallbackCur) {
  const matched = pfmtMatchBills(bills, txns, month, fallbackCur);
  const out = [];
  bills.filter(function (b) { return b.isActive !== false; }).forEach(function (b) {
    if (matched[b.id]) return;
    const due  = pfmtBillDueDate(b, month);
    const days = pfmtDaysUntil(due, today);
    if (days <= leadDays) out.push({ bill: b, due: due, days: days });
  });
  return out.sort(function (a, b) { return a.days - b.days; });
}

/* ═══════════════ PFMT SHARED MONEY RULES — v1 — END ═══════════════ */

export {
  PFMT_CLAIMS_CATEGORY,
  pfmtIsFlow,
  pfmtPaybackOffsets,
  pfmtPrevMonth,
  pfmtDaysInMonth,
  pfmtBudgetSpent,
  pfmtBudgetRollover,
  pfmtBudgetLimit,
  pfmtBudgetAlerts,
  pfmtBillDueDate,
  pfmtMatchBills,
  pfmtBillStatus,
  pfmtDaysUntil,
  pfmtBillsToRemind
};
