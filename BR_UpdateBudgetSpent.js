// ============================================================
// PFMT Business Rule 2 — Update Budget Spent Amount
// Table    : x_pfmt_transaction
// When     : After · Insert
// Condition: current.transaction_type == 'expense'
// ============================================================

(function executeRule(current, previous) {

  var categoryID = current.category.toString();
  var amount     = parseFloat(current.amount.toString()) || 0;
  var today      = new GlideDateTime();

  // Find active budget for this category in the current period
  var budgetGR = new GlideRecord('x_pfmt_budget');
  budgetGR.addQuery('category', categoryID);
  budgetGR.addQuery('period_start', '<=', today);
  budgetGR.addQuery('period_end',   '>=', today);
  budgetGR.query();

  if (!budgetGR.next()) return; // no active budget for this category

  var currentSpent = parseFloat(budgetGR.spent_amount.toString())  || 0;
  var budgetLimit  = parseFloat(budgetGR.budget_amount.toString())  || 0;
  var newSpent     = currentSpent + amount;
  var alertPct     = parseInt(budgetGR.alert_threshold_pct.toString()) || 80;

  budgetGR.spent_amount     = newSpent;
  budgetGR.remaining_amount = budgetLimit - newSpent;
  budgetGR.update();

  // Trigger alert notification if threshold crossed
  var pct = budgetLimit > 0 ? (newSpent / budgetLimit) * 100 : 0;
  if (pct >= alertPct) {
    gs.eventQueue(
      'x_pfmt.budget.threshold_reached',
      budgetGR,
      pct.toFixed(1),
      budgetGR.category.category_name
    );
  }

})(current, previous);
