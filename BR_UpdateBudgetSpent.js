// ============================================================
// PFMT Business Rule 2 — Update Budget Spent Amount
// Table    : x_887486_0_transaction
// When     : After · Insert
// Condition: current.transaction_type == 'expense'
// ============================================================

(function executeRule(current, previous) {

  var categoryID = current.category.toString();
  var amount     = parseFloat(current.amount.toString()) || 0;
  var today      = new GlideDateTime();

  // Find active budget for this category in the current period.
  // Scoped to the owner and the currency: querying on category alone matched
  // the first budget in the table for that category regardless of whose it was,
  // so one user's expense incremented another user's spent_amount and could
  // fire their threshold alert. A budget is per user, per category, per
  // currency — all three have to be in the query.
  var budgetGR = new GlideRecord('x_887486_0_budget');
  budgetGR.addQuery('user_profile', current.user_profile.toString());
  budgetGR.addQuery('category', categoryID);
  budgetGR.addQuery('currency', current.currency.toString() || 'SGD');
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
