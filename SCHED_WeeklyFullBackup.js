// ============================================================
// PFMT Scheduled Job — Weekly Full Backup (stored, not emailed)
//
// Keeps a dated history of complete backups inside ServiceNow, so there is
// always a restore point even if no laptop is switched on. The existing
// "PFMT Weekly Backup Email" job is unaffected — this one stores, that one
// sends. Run this one first if you schedule both on the same day.
//
// Trigger    : Scheduled Job, weekly (recommend Sunday 02:00)
// Paste into : System Definition → Scheduled Jobs → New →
//              "Automatically run a script of your choosing"
//              Name: PFMT Weekly Full Backup
//              Run : Weekly, pick a day/time
//
// ── REQUIRES A NEW TABLE (create this first, it does not exist yet) ──
//   Label : PFMT Backup          Name: x_887486_0_backup
//   Fields:
//     run_on        | Date/Time                                    |
//     user_profile  | Reference → x_887486_0_user_profile          |
//     record_count  | Integer                                      |
//     summary       | String (1000)                                |
//     status        | String (40)                                  |
//   The files themselves are attachments on each record.
//
// Retention: keeps the most recent KEEP_WEEKS backups per user and deletes
// older ones, so the table cannot grow without bound.
// ============================================================

(function () {

  var KEEP_WEEKS   = 12;                       // ~3 months of restore points
  var BACKUP_TABLE = 'x_887486_0_backup';

  var now     = new GlideDateTime();
  var dateTag = now.getYearUTC() + '-' + gs.zeroPad(now.getMonthUTC(), 2) + '-' + gs.zeroPad(now.getDayOfMonthUTC(), 2);

  // Fail loudly rather than silently doing nothing if the table is missing.
  if (!new GlideRecord(BACKUP_TABLE).isValid()) {
    gs.error('PFMT Full Backup: table ' + BACKUP_TABLE + ' does not exist. ' +
             'Create it (see header of this script) before scheduling this job.');
    return;
  }

  function csvEscape(v) {
    return '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
  }
  function csvRow(cells) { return cells.map(csvEscape).join(',') + '\n'; }

  // ── collectors: return both CSV text and the raw rows, so the JSON backup
  //    and the CSV backup can never drift apart ──
  function collectAccounts(profileSysId) {
    var rows = [], csv = csvRow(['Name', 'Type', 'Institution', 'Balance', 'Currency']);
    var gr = new GlideRecord('x_887486_0_account');
    gr.addQuery('user_profile', profileSysId);
    gr.orderBy('account_name');
    gr.query();
    while (gr.next()) {
      var r = {
        name       : gr.getValue('account_name'),
        type       : gr.getValue('account_type'),
        institution: gr.getValue('institution_name'),
        balance    : parseFloat(gr.getValue('current_balance')) || 0,
        currency   : gr.getValue('currency') || 'SGD'
      };
      rows.push(r);
      csv += csvRow([r.name, r.type, r.institution, r.balance, r.currency]);
    }
    return { rows: rows, csv: csv, count: rows.length };
  }

  function collectTransactions(profileSysId) {
    var rows = [], csv = csvRow(['Date', 'Type', 'Description', 'Category', 'Account',
                                 'Currency', 'Amount', 'TransferGroup', 'Notes']);
    var gr = new GlideRecord('x_887486_0_transaction');
    gr.addQuery('user_profile', profileSysId);
    gr.orderByDesc('transaction_date');
    gr.query();
    while (gr.next()) {
      // transfer_group is what pairs the two legs of a transfer or a funded
      // asset. A backup without it restores as two unrelated rows.
      var r = {
        date         : gr.getValue('transaction_date'),
        type         : gr.transaction_type.toString(),
        description  : gr.getValue('description'),
        category     : gr.category.category_name ? gr.category.category_name.toString() : '',
        account      : gr.account.account_name ? gr.account.account_name.toString() : '',
        currency     : gr.getValue('currency') || 'SGD',
        amount       : parseFloat(gr.getValue('amount')) || 0,
        transferGroup: gr.getValue('transfer_group') || '',
        notes        : gr.getValue('notes')
      };
      rows.push(r);
      csv += csvRow([r.date, r.type, r.description, r.category, r.account,
                     r.currency, r.amount, r.transferGroup, r.notes]);
    }
    return { rows: rows, csv: csv, count: rows.length };
  }

  function collectBudgets(profileSysId) {
    var rows = [], csv = csvRow(['Category', 'Amount', 'Spent', 'Currency', 'AlertPct']);
    var gr = new GlideRecord('x_887486_0_budget');
    gr.addQuery('user_profile', profileSysId);
    gr.query();
    while (gr.next()) {
      var r = {
        category : gr.category.category_name ? gr.category.category_name.toString() : '',
        amount   : parseFloat(gr.getValue('budget_amount')) || 0,
        spent    : parseFloat(gr.getValue('spent_amount')) || 0,
        currency : gr.getValue('currency') || 'SGD',
        alertPct : parseInt(gr.getValue('alert_threshold'), 10) || 80
      };
      rows.push(r);
      csv += csvRow([r.category, r.amount, r.spent, r.currency, r.alertPct]);
    }
    return { rows: rows, csv: csv, count: rows.length };
  }

  function collectGoals(profileSysId) {
    var rows = [], csv = csvRow(['Name', 'Target', 'Current', 'Currency',
                                 'MonthlyContribution', 'TargetDate', 'LinkedAccount']);
    var gr = new GlideRecord('x_887486_0_savings_goal');
    gr.addQuery('user_profile', profileSysId);
    gr.query();
    while (gr.next()) {
      var r = {
        name         : gr.getValue('goal_name'),
        target       : parseFloat(gr.getValue('target_amount')) || 0,
        current      : parseFloat(gr.getValue('current_amount')) || 0,
        currency     : gr.getValue('currency') || 'SGD',
        monthly      : parseFloat(gr.getValue('monthly_contribution')) || 0,
        targetDate   : gr.getValue('target_date'),
        linkedAccount: gr.account.account_name ? gr.account.account_name.toString() : ''
      };
      rows.push(r);
      csv += csvRow([r.name, r.target, r.current, r.currency, r.monthly, r.targetDate, r.linkedAccount]);
    }
    return { rows: rows, csv: csv, count: rows.length };
  }

  // Delete everything older than the most recent KEEP_WEEKS for this user.
  function pruneOldBackups(profileSysId) {
    var keepIds = [];
    var recent = new GlideRecord(BACKUP_TABLE);
    recent.addQuery('user_profile', profileSysId);
    recent.orderByDesc('run_on');
    recent.setLimit(KEEP_WEEKS);
    recent.query();
    while (recent.next()) keepIds.push(recent.getUniqueValue());

    if (!keepIds.length) return 0;

    var old = new GlideRecord(BACKUP_TABLE);
    old.addQuery('user_profile', profileSysId);
    old.addQuery('sys_id', 'NOT IN', keepIds.join(','));
    old.query();
    var removed = 0;
    while (old.next()) { old.deleteRecord(); removed++; }   // attachments go with the record
    return removed;
  }

  var profileGR = new GlideRecord('x_887486_0_user_profile');
  profileGR.query();

  var stored = 0, skipped = 0, pruned = 0;

  while (profileGR.next()) {
    var profileSysId = profileGR.getUniqueValue();
    var username     = profileGR.getValue('username') || profileSysId;

    var accounts     = collectAccounts(profileSysId);
    var transactions = collectTransactions(profileSysId);
    var budgets      = collectBudgets(profileSysId);
    var goals        = collectGoals(profileSysId);

    var total = accounts.count + transactions.count + budgets.count + goals.count;
    if (total === 0) { skipped++; continue; }   // nothing to back up yet

    var summary = accounts.count + ' accounts, ' + transactions.count + ' transactions, ' +
                  budgets.count + ' budgets, ' + goals.count + ' goals';

    var backupGR = new GlideRecord(BACKUP_TABLE);
    backupGR.initialize();
    backupGR.setValue('run_on', now.getValue());
    backupGR.setValue('user_profile', profileSysId);
    backupGR.setValue('record_count', total);
    backupGR.setValue('summary', summary);
    backupGR.setValue('status', 'complete');
    var backupSysId = backupGR.insert();

    if (!backupSysId) {
      gs.error('PFMT Full Backup: could not create backup record for ' + username);
      continue;
    }

    // One JSON holding everything — this is the restore file. The CSVs are for
    // reading in a spreadsheet, and are a convenience, not the source of truth.
    var full = {
      exportedOn  : now.getValue(),
      username    : username,
      schemaNote  : 'transferGroup pairs the two legs of a transfer or funded asset',
      accounts    : accounts.rows,
      transactions: transactions.rows,
      budgets     : budgets.rows,
      goals       : goals.rows
    };

    var sa = new GlideSysAttachment();
    sa.write(backupGR, 'pfmt_full_' + dateTag + '.json', 'application/json',
             JSON.stringify(full));
    if (accounts.count)     sa.write(backupGR, 'pfmt_accounts_'     + dateTag + '.csv', 'text/csv', accounts.csv);
    if (transactions.count) sa.write(backupGR, 'pfmt_transactions_' + dateTag + '.csv', 'text/csv', transactions.csv);
    if (budgets.count)      sa.write(backupGR, 'pfmt_budgets_'      + dateTag + '.csv', 'text/csv', budgets.csv);
    if (goals.count)        sa.write(backupGR, 'pfmt_goals_'        + dateTag + '.csv', 'text/csv', goals.csv);

    stored++;
    pruned += pruneOldBackups(profileSysId);
  }

  gs.info('PFMT Full Backup ' + dateTag + ': stored ' + stored + ' backup(s), ' +
          'skipped ' + skipped + ' user(s) with no data, pruned ' + pruned + ' old backup(s).');

})();
