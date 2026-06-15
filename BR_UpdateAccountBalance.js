// ============================================================
// PFMT Business Rule 1 — Update Account Balance
// Table    : x_1472763_person_0_transaction
// When     : After · Insert + Update
// Condition: current.state == '2' (Confirmed)
// ============================================================

(function executeRule(current, previous) {

  var accountGR = new GlideRecord('x_1472763_person_0_account');
  if (!accountGR.get(current.account.toString())) {
    gs.error('PFMT BR1: Account not found - ' + current.account);
    return;
  }

  var amount   = parseFloat(current.amount.toString()) || 0;
  var txnType  = current.transaction_type.toString();
  var balance  = parseFloat(accountGR.current_balance.toString()) || 0;
  var isUpdate = (current.operation() === 'update');

  // On update, reverse the previous transaction first
  if (isUpdate && previous.state.toString() === '2') {
    var prevAmt  = parseFloat(previous.amount.toString()) || 0;
    var prevType = previous.transaction_type.toString();
    balance += (prevType === 'income') ? -prevAmt : prevAmt;
  }

  // Apply new transaction
  if (txnType === 'income') {
    balance += amount;
  } else if (txnType === 'expense') {
    balance -= amount;
  }
  // Transfer: handled by a separate paired transaction

  accountGR.current_balance = balance;
  accountGR.update();

  gs.info('PFMT BR1: Balance updated for account ' +
    accountGR.account_name + ' → ' + balance);

})(current, previous);
