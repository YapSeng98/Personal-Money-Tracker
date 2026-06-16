// ============================================================
// PFMT Business Rule 3 — Validate Transaction
// Table    : x_887486_0_transaction
// When     : Before · Insert + Update
// ============================================================

(function executeRule(current, previous) {

  var amount = parseFloat(current.amount.toString()) || 0;

  // Amount must be positive
  if (amount <= 0) {
    current.setAbortAction(true);
    gs.addErrorMessage('Transaction amount must be greater than zero.');
    return;
  }

  // Account must be active
  var acctGR = new GlideRecord('x_887486_0_account');
  if (acctGR.get(current.account.toString())) {
    if (!acctGR.is_active) {
      current.setAbortAction(true);
      gs.addErrorMessage('Cannot post to an inactive account.');
      return;
    }
  }

  // Future dates: force to Draft state
  var txnDate = new GlideDate();
  txnDate.setValue(current.transaction_date.toString());
  var today   = new GlideDate();
  if (txnDate.after(today) && current.state.toString() !== '1') {
    current.state = '1'; // force Draft for future-dated
    gs.addInfoMessage('Future-dated transaction saved as Draft.');
  }

  // Set next_run_date for recurring transactions
  if (current.is_recurring && current.operation() === 'insert') {
    var freq    = current.recurring_frequency.toString();
    var nextRun = new GlideDateTime();
    if (freq === 'daily')   nextRun.addDaysUTC(1);
    if (freq === 'weekly')  nextRun.addDaysUTC(7);
    if (freq === 'monthly') nextRun.addMonthsUTC(1);
    current.next_run_date = nextRun.getDate();
  }

})(current, previous);
