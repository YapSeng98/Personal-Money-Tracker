// ============================================================
// PFMT Dashboard Widget — Server Script
// Paste into: Server Script tab of the widget
// Runs server-side; populates the 'data' object for the view
// ============================================================

(function() {
  var now  = new GlideDateTime();
  var year = now.getYearUTC();
  var mon  = gs.zeroPad(now.getMonthUTC(), 2);

  // ── Aggregate: income and expenses this month ─────────────
  var ga = new GlideAggregate('x_1472763_person_0_transaction');
  ga.addQuery('sys_created_by',  gs.getUserName());
  ga.addQuery('transaction_date', 'STARTSWITH', year + '-' + mon);
  ga.addQuery('state', '2'); // Confirmed only
  ga.addAggregate('SUM', 'amount');
  ga.groupBy('transaction_type');
  ga.query();

  var totalIncome = 0, totalExpenses = 0;
  while (ga.next()) {
    var amt = parseFloat(ga.getAggregate('SUM', 'amount')) || 0;
    if (ga.transaction_type.toString() === 'income')  totalIncome   = amt;
    if (ga.transaction_type.toString() === 'expense') totalExpenses = amt;
  }

  // ── Recent 10 transactions ────────────────────────────────
  var txns = [];
  var txnGR = new GlideRecord('x_1472763_person_0_transaction');
  txnGR.addQuery('sys_created_by', gs.getUserName());
  txnGR.addQuery('state', '2');
  txnGR.orderByDesc('transaction_date');
  txnGR.setLimit(10);
  txnGR.query();

  var icons = {
    'Food & Drink' : '🍜',
    'Transport'    : '🚇',
    'Groceries'    : '🛒',
    'Shopping'     : '🛍️',
    'Bills & Utilities': '🏠',
    'Health'       : '🏥',
    'Entertainment': '🎬',
    'Salary'       : '💼',
    'Freelance'    : '💻',
    'Investment'   : '📈',
    'Travel'       : '✈️'
  };

  while (txnGR.next()) {
    var cat = txnGR.category.category_name.toString();
    txns.push({
      description : txnGR.description.toString(),
      amount      : parseFloat(txnGR.amount.toString()),
      type        : txnGR.transaction_type.toString(),
      category    : cat,
      icon        : icons[cat] || '💰',
      date        : txnGR.transaction_date.toString()
    });
  }

  data.netBalance    = totalIncome - totalExpenses;
  data.totalIncome   = totalIncome;
  data.totalExpenses = totalExpenses;
  data.transactions  = txns;
  data.currency      = 'SGD';
})();
