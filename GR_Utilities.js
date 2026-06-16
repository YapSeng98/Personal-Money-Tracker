// ============================================================
// PFMT GlideRecord Utility Library
// Usage: Paste into a Script Include named "PFMTUtils"
//        OR run individual functions in Scripts - Background
// ============================================================


// ── 1. Get all transactions for a user this month ──────────
function getMonthlyTransactions(userProfileSysID) {
  var results = [];
  var now     = new GlideDateTime();
  var year    = now.getYearUTC();
  var month   = gs.zeroPad(now.getMonthUTC(), 2);

  var startGDT = new GlideDateTime(year + '-' + month + '-01 00:00:00');
  var endGDT   = new GlideDateTime();
  endGDT.addMonthsUTC(1);
  endGDT.addDaysUTC(-1);

  var gr = new GlideRecord('x_887486_0_transaction');
  gr.addQuery('account.user_profile', userProfileSysID); // dot-walk
  gr.addQuery('transaction_date', '>=', startGDT.getDate());
  gr.addQuery('transaction_date', '<=', endGDT.getDate());
  gr.addQuery('state', '2'); // Confirmed only
  gr.orderByDesc('transaction_date');
  gr.query();

  while (gr.next()) {
    results.push({
      sys_id      : gr.sys_id.toString(),
      description : gr.description.toString(),
      amount      : parseFloat(gr.amount.toString()),
      type        : gr.transaction_type.toString(),
      category    : gr.category.category_name.toString(),
      account     : gr.account.account_name.toString(),
      date        : gr.transaction_date.toString()
    });
  }
  return results;
}


// ── 2. Aggregate spend totals per category this month ──────
function getCategorySpendTotals(userProfileSysID) {
  var now   = new GlideDateTime();
  var year  = now.getYearUTC();
  var month = gs.zeroPad(now.getMonthUTC(), 2);

  var ga = new GlideAggregate('x_887486_0_transaction');
  ga.addQuery('transaction_type',        'expense');
  ga.addQuery('account.user_profile',    userProfileSysID);
  ga.addQuery('transaction_date', '>=',  year + '-' + month + '-01');
  ga.addAggregate('SUM', 'amount');
  ga.groupBy('category');
  ga.orderByAggregate('SUM', 'amount');
  ga.query();

  var totals = {};
  while (ga.next()) {
    var catName = ga.category.category_name.toString();
    totals[catName] = parseFloat(ga.getAggregate('SUM', 'amount')) || 0;
  }
  return totals;
}


// ── 3. Update savings goal progress ───────────────────────
// Use inside Flow Designer Action script step.
// inputs.goalSysID  - sys_id of x_887486_0_savings_goal
// inputs.addAmount  - amount to add to current_amount
function updateGoalProgress() {
  var goalID    = inputs.goalSysID;
  var addAmount = parseFloat(inputs.addAmount) || 0;

  var goalGR = new GlideRecord('x_887486_0_savings_goal');
  if (!goalGR.get(goalID)) {
    outputs.status  = 'error';
    outputs.message = 'Goal not found';
    return;
  }

  var current = parseFloat(goalGR.current_amount.toString()) || 0;
  var target  = parseFloat(goalGR.target_amount.toString())  || 0;
  var updated = current + addAmount;

  goalGR.current_amount = updated;

  if (updated >= target) {
    goalGR.goal_status = 'achieved';
    outputs.achieved   = true;
    outputs.message    = 'Goal achieved! 🎉';
  } else {
    goalGR.goal_status  = 'in_progress';
    var pct             = ((updated / target) * 100).toFixed(1);
    var contrib         = parseFloat(goalGR.monthly_contribution.toString()) || 0;
    var remaining       = target - updated;
    var monthsLeft      = contrib > 0 ? Math.ceil(remaining / contrib) : 0;
    outputs.achieved    = false;
    outputs.message     = pct + '% complete. ' +
                          (monthsLeft > 0 ? monthsLeft + ' months to target.' : '');
  }

  goalGR.update();
  outputs.status        = 'success';
  outputs.progress_pct  = Math.min((updated / target) * 100, 100).toFixed(1);
}


// ── 4. Seed default categories (run in Scripts - Background) ─
function seedCategories() {
  var categories = [
    { name: 'Food & Drink',    type: 'expense', icon: '🍜', color: '#8B5CF6' },
    { name: 'Transport',       type: 'expense', icon: '🚇', color: '#00C896' },
    { name: 'Groceries',       type: 'expense', icon: '🛒', color: '#3B82F6' },
    { name: 'Shopping',        type: 'expense', icon: '🛍️', color: '#FF5B5B' },
    { name: 'Bills & Utilities', type: 'expense', icon: '🏠', color: '#F59E0B' },
    { name: 'Health',          type: 'expense', icon: '🏥', color: '#EC4899' },
    { name: 'Entertainment',   type: 'expense', icon: '🎬', color: '#F97316' },
    { name: 'Education',       type: 'expense', icon: '📚', color: '#6366F1' },
    { name: 'Travel',          type: 'expense', icon: '✈️', color: '#14B8A6' },
    { name: 'Salary',          type: 'income',  icon: '💼', color: '#00C896' },
    { name: 'Freelance',       type: 'income',  icon: '💻', color: '#3B82F6' },
    { name: 'Investment',      type: 'income',  icon: '📈', color: '#8B5CF6' },
    { name: 'Other',           type: 'expense', icon: '💰', color: '#6B7280' }
  ];

  categories.forEach(function(cat) {
    var gr = new GlideRecord('x_887486_0_category');
    gr.initialize();
    gr.category_name    = cat.name;
    gr.category_type    = cat.type;
    gr.icon_emoji       = cat.icon;
    gr.color_hex        = cat.color;
    gr.is_system_default = true;
    gr.insert();
    gs.info('Created category: ' + cat.name);
  });

  gs.info('PFMT: ' + categories.length + ' categories seeded.');
}
