// ============================================================
// PFMT Business Rule 4 — Budget Calculated Fields
// Table    : x_pfmt_budget
// When     : Before · Insert + Update
// ============================================================

(function executeRule(current, previous) {

  var budgetAmt = parseFloat(current.budget_amount.toString())  || 0;
  var spentAmt  = parseFloat(current.spent_amount.toString())   || 0;

  current.remaining_amount = budgetAmt - spentAmt;

  // Auto-set period dates if not provided
  if (!current.period_start.nil()) return;

  var periodType = current.period_type.toString();
  var now        = new GlideDateTime();
  var start      = new GlideDateTime();
  var end        = new GlideDateTime();

  if (periodType === 'monthly') {
    var year  = now.getYearUTC();
    var month = now.getMonthUTC();
    start.setValueUTC(year + '-' + gs.zeroPad(month, 2) + '-01 00:00:00');
    end.addMonthsUTC(1); end.addDaysUTC(-1);
    end.setValueUTC(end.getYearUTC() + '-' + gs.zeroPad(end.getMonthUTC(), 2) + '-'
      + gs.zeroPad(end.getDayOfMonthUTC(), 2) + ' 23:59:59');
  } else if (periodType === 'weekly') {
    end.addDaysUTC(6);
  } else if (periodType === 'yearly') {
    end.addYearsUTC(1); end.addDaysUTC(-1);
  }

  current.period_start = start.getDate();
  current.period_end   = end.getDate();

})(current, previous);
