// ============================================================
// PFMT Flow 2 — Monthly Budget Reset
// Trigger  : Scheduled · 1st of every month · 00:01 SGT
// Paste into: Flow Designer → New Flow → Script step
// ============================================================

(function() {
  var resetCount    = 0;
  var rolloverCount = 0;
  var today         = new GlideDateTime();
  var year          = today.getYearUTC();
  var month         = today.getMonthUTC();

  // Build new period date strings
  var newStart  = year + '-' + gs.zeroPad(month, 2) + '-01';
  var nextMonth = new GlideDateTime();
  nextMonth.addMonthsUTC(1);
  var newEnd    = nextMonth.getYearUTC() + '-' +
                  gs.zeroPad(nextMonth.getMonthUTC(), 2) + '-01';

  var budgetGR = new GlideRecord('x_887486_0_budget');
  budgetGR.addQuery('period_type', 'monthly');
  budgetGR.query();

  while (budgetGR.next()) {
    var prevSpent  = parseFloat(budgetGR.spent_amount.toString())  || 0;
    var budgetAmt  = parseFloat(budgetGR.budget_amount.toString()) || 0;
    var rollover   = (budgetGR.rollover_enabled.toString() === 'true');
    var remaining  = Math.max(0, budgetAmt - prevSpent);

    // Log history before reset
    gs.info('PFMT Flow2: Archiving budget [' + budgetGR.sys_id +
      '] spent=' + prevSpent + ' of ' + budgetAmt);

    // Apply rollover: carry unspent balance forward
    var newBudgetAmt = rollover ? (budgetAmt + remaining) : budgetAmt;

    budgetGR.budget_amount    = newBudgetAmt;
    budgetGR.spent_amount     = 0;
    budgetGR.remaining_amount = newBudgetAmt;
    budgetGR.period_start     = newStart;
    budgetGR.period_end       = newEnd;
    budgetGR.update();

    resetCount++;
    if (rollover) rolloverCount++;
  }

  outputs.budgets_reset     = resetCount;
  outputs.rollovers_applied = rolloverCount;
  outputs.new_period        = newStart + ' to ' + newEnd;
  gs.info('PFMT Flow2: Reset ' + resetCount + ' budgets. ' + rolloverCount + ' rollovers.');
})();
