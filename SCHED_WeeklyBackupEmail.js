// ============================================================
// PFMT Scheduled Job — Weekly Backup Email
// Trigger    : Scheduled Job, weekly (recommend Monday 06:00, user's TZ)
// Paste into : System Definition → Scheduled Jobs → New →
//              "Automatically run a script of your choosing"
//              Name: PFMT Weekly Backup Email
//              Run: Weekly, pick a day/time
// Runs as a background script — no request/response context.
// ============================================================

(function() {

  var today   = new GlideDateTime();
  var dateTag = today.getYearUTC() + '-' + gs.zeroPad(today.getMonthUTC(), 2) + '-' + gs.zeroPad(today.getDayOfMonthUTC(), 2);

  function csvEscape(v) {
    return '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
  }
  function csvRow(cells) { return cells.map(csvEscape).join(',') + '\n'; }

  function buildAccountsCSV(profileSysId) {
    var csv = csvRow(['Name', 'Type', 'Institution', 'Balance', 'Currency']);
    var gr = new GlideRecord('x_887486_0_account');
    gr.addQuery('user_profile', profileSysId);
    gr.orderBy('account_name');
    gr.query();
    var count = 0;
    while (gr.next()) {
      csv += csvRow([
        gr.getValue('account_name'), gr.getValue('account_type'), gr.getValue('institution_name'),
        parseFloat(gr.getValue('current_balance')) || 0, gr.getValue('currency') || 'SGD'
      ]);
      count++;
    }
    return { csv: csv, count: count };
  }

  function buildTransactionsCSV(profileSysId) {
    var csv = csvRow(['Date', 'Type', 'Description', 'Category', 'Account', 'Currency', 'Amount', 'Notes']);
    var gr = new GlideRecord('x_887486_0_transaction');
    gr.addQuery('user_profile', profileSysId);
    gr.orderByDesc('transaction_date');
    gr.query();
    var count = 0;
    while (gr.next()) {
      csv += csvRow([
        gr.getValue('transaction_date'), gr.transaction_type.toString(), gr.getValue('description'),
        gr.category.category_name ? gr.category.category_name.toString() : '',
        gr.account.account_name ? gr.account.account_name.toString() : '',
        gr.getValue('currency') || 'SGD', parseFloat(gr.getValue('amount')) || 0, gr.getValue('notes')
      ]);
      count++;
    }
    return { csv: csv, count: count };
  }

  function buildBudgetsCSV(profileSysId) {
    var csv = csvRow(['Category', 'Amount', 'Spent', 'Currency', 'AlertPct']);
    var gr = new GlideRecord('x_887486_0_budget');
    gr.addQuery('user_profile', profileSysId);
    gr.query();
    var count = 0;
    while (gr.next()) {
      csv += csvRow([
        gr.category.category_name ? gr.category.category_name.toString() : '',
        parseFloat(gr.getValue('budget_amount')) || 0, parseFloat(gr.getValue('spent_amount')) || 0,
        gr.getValue('currency') || 'SGD', parseInt(gr.getValue('alert_threshold')) || 80
      ]);
      count++;
    }
    return { csv: csv, count: count };
  }

  function buildGoalsCSV(profileSysId) {
    var csv = csvRow(['Name', 'Target', 'Current', 'Currency', 'MonthlyContribution', 'TargetDate', 'LinkedAccount']);
    var gr = new GlideRecord('x_887486_0_savings_goal');
    gr.addQuery('user_profile', profileSysId);
    gr.query();
    var count = 0;
    while (gr.next()) {
      csv += csvRow([
        gr.getValue('goal_name'), parseFloat(gr.getValue('target_amount')) || 0, parseFloat(gr.getValue('current_amount')) || 0,
        gr.getValue('currency') || 'SGD', parseFloat(gr.getValue('monthly_contribution')) || 0, gr.getValue('target_date'),
        gr.account.account_name ? gr.account.account_name.toString() : ''
      ]);
      count++;
    }
    return { csv: csv, count: count };
  }

  var profileGR = new GlideRecord('x_887486_0_user_profile');
  profileGR.addNotNullQuery('email');
  profileGR.query();

  var emailed = 0, skipped = 0;

  while (profileGR.next()) {
    var profileSysId = profileGR.getUniqueValue();
    var email        = profileGR.getValue('email');
    var displayName  = profileGR.getValue('display_name') || profileGR.getValue('username') || 'there';

    var accounts     = buildAccountsCSV(profileSysId);
    var transactions = buildTransactionsCSV(profileSysId);
    var budgets      = buildBudgetsCSV(profileSysId);
    var goals        = buildGoalsCSV(profileSysId);

    var totalRecords = accounts.count + transactions.count + budgets.count + goals.count;
    if (totalRecords === 0) { skipped++; continue; } // nothing to back up yet

    var emailGR = new GlideRecord('sys_email');
    emailGR.initialize();
    emailGR.type         = 'send-ready';
    emailGR.target_table  = 'x_887486_0_user_profile';
    emailGR.instance      = profileSysId;
    emailGR.recipients    = email;
    emailGR.subject       = 'Your PFMT Weekly Backup — ' + dateTag;
    emailGR.content_type  = 'text/plain';
    emailGR.body          = 'Hi ' + displayName + ',\n\n' +
      'Here is your weekly Personal Money Tracker backup as of ' + dateTag + ':\n\n' +
      '  Accounts:     ' + accounts.count + '\n' +
      '  Transactions: ' + transactions.count + '\n' +
      '  Budgets:      ' + budgets.count + '\n' +
      '  Goals:        ' + goals.count + '\n\n' +
      'Each is attached as a separate CSV file. Keep these somewhere safe — ' +
      'they let you restore your data if it is ever lost.\n\n' +
      '— PFMT (automated, no reply needed)';
    var emailSysId = emailGR.insert();

    if (emailSysId) {
      var sa = new GlideSysAttachment();
      if (accounts.count)     sa.write(emailGR, 'pfmt_accounts_'     + dateTag + '.csv', 'text/csv', accounts.csv);
      if (transactions.count) sa.write(emailGR, 'pfmt_transactions_' + dateTag + '.csv', 'text/csv', transactions.csv);
      if (budgets.count)      sa.write(emailGR, 'pfmt_budgets_'      + dateTag + '.csv', 'text/csv', budgets.csv);
      if (goals.count)        sa.write(emailGR, 'pfmt_goals_'        + dateTag + '.csv', 'text/csv', goals.csv);
      emailed++;
    }
  }

  gs.info('PFMT Weekly Backup: emailed ' + emailed + ' user(s), skipped ' + skipped + ' with no data.');

})();
