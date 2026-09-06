// ============================================================
// PFMT Business Rule 1 — Update Account Balance
// Table    : x_887486_0_transaction
// When     : After · Insert + Update
// Condition: current.state == '2' (Confirmed)
// ============================================================
//
// ⚠️  DO NOT ACTIVATE THIS ALONGSIDE THE APP — IT DOUBLE-COUNTS.
//
// The app treats account.current_balance as a STARTING balance: effectiveBal()
// in the tracker reads that field and then applies every linked transaction on
// top of it. This rule treats the same field as a RUNNING balance and applies
// each transaction to it server-side. With both live, every transaction lands
// twice and an account reads start + 2 × movement.
//
// The tracker is the more complete of the two — it also handles 'asset' and
// 'payback' rows and both legs of a transfer, none of which this rule touches.
// So the app owns the balance, and this rule should stay inactive.
//
// To check whether it is running: note an account's balance, add a S$100
// expense, then sync. A S$200 drop means this rule is active — deactivate it
// (System Definition → Business Rules) and correct the affected accounts'
// current_balance back to their true starting figures.
//
// Kept in the repo for reference and for anyone running the ServiceNow-native
// UI *without* the tracker app, where it is the only thing maintaining a balance.

(function executeRule(current, previous) {

  var accountGR = new GlideRecord('x_887486_0_account');
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
