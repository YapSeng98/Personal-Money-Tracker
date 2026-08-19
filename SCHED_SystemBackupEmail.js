// ============================================================
// PFMT Scheduled Job — System Backup, emailed to the owner
//
// The whole system in one file, every user included, with no credentials
// stored anywhere. This runs inside ServiceNow as a background script, so it
// already has system rights — unlike a script on a laptop, which needs a login
// to get in, and unlike the PFMT REST API, whose every endpoint filters to the
// caller's own profile and so can never see another user's records.
//
// Trigger    : Scheduled Job, weekly
// Paste into : System Definition → Scheduled Jobs → New →
//              "Automatically run a script of your choosing"
//              Name: PFMT System Backup Email
//              Run : Weekly, pick a day/time
//
// Needs no new table. Set OWNER_EMAIL below and nothing else.
// ============================================================

(function () {

  // ── settings ──────────────────────────────────────────────
  var OWNER_EMAIL     = '';     // leave blank to use the first admin profile's email
  var INCLUDE_SECRETS = false;  // password hashes and API keys — see the note below

  var now     = new GlideDateTime();
  var dateTag = now.getYearUTC() + '-' + gs.zeroPad(now.getMonthUTC(), 2) + '-' + gs.zeroPad(now.getDayOfMonthUTC(), 2);

  function csvEscape(v) {
    return '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
  }
  function csvRow(cells) { return cells.map(csvEscape).join(',') + '\n'; }

  // ── read a whole table, no user filter ────────────────────
  // The per-user job queries with addQuery('user_profile', id). Dropping that
  // is the entire difference between "one person's backup" and "the system's".
  function readAll(table, fields) {
    var rows = [];
    var gr = new GlideRecord(table);
    if (!gr.isValid()) { gs.warn('PFMT System Backup: table ' + table + ' not found, skipping'); return null; }
    gr.query();
    while (gr.next()) {
      var r = { sys_id: gr.getUniqueValue() };
      fields.forEach(function (f) { r[f] = gr.getValue(f); });
      rows.push(r);
    }
    return rows;
  }

  var profiles = readAll('x_887486_0_user_profile',
    ['username', 'display_name', 'email', 'currency', 'language', 'password_hash', 'ai_api_key']) || [];

  // A backup of password hashes is a liability, and it is rarely what a restore
  // needs — the owner can reset a login far more cheaply than they can contain
  // a leaked hash file. Kept out unless deliberately switched on above.
  if (!INCLUDE_SECRETS) {
    profiles.forEach(function (p) {
      if (p.password_hash) p.password_hash = '__REDACTED__';
      if (p.ai_api_key)    p.ai_api_key    = '__REDACTED__';
    });
  }

  var accounts = readAll('x_887486_0_account',
    ['account_name', 'account_type', 'institution_name', 'current_balance', 'currency', 'user_profile']) || [];

  var transactions = [];
  var txnGR = new GlideRecord('x_887486_0_transaction');
  txnGR.orderByDesc('transaction_date');
  txnGR.query();
  while (txnGR.next()) {
    transactions.push({
      sys_id       : txnGR.getUniqueValue(),
      user_profile : txnGR.getValue('user_profile'),
      date         : txnGR.getValue('transaction_date'),
      type         : txnGR.transaction_type.toString(),
      description  : txnGR.getValue('description'),
      // Reference fields are stored as sys_ids; the readable name is what a
      // restore actually matches on, so carry both.
      category     : txnGR.category.category_name ? txnGR.category.category_name.toString() : '',
      account      : txnGR.account.account_name ? txnGR.account.account_name.toString() : '',
      account_id   : txnGR.getValue('account'),
      currency     : txnGR.getValue('currency') || 'SGD',
      amount       : parseFloat(txnGR.getValue('amount')) || 0,
      // Without this the two legs of a transfer or a funded asset restore as
      // unrelated rows and the balances stop reconciling.
      transfer_group: txnGR.getValue('transfer_group') || '',
      notes        : txnGR.getValue('notes')
    });
  }

  var budgets = readAll('x_887486_0_budget',
    ['budget_amount', 'spent_amount', 'currency', 'alert_threshold', 'user_profile']) || [];
  var goals = readAll('x_887486_0_savings_goal',
    ['goal_name', 'target_amount', 'current_amount', 'currency', 'monthly_contribution',
     'target_date', 'user_profile', 'icon_emoji']) || [];
  var categories = readAll('x_887486_0_category', ['category_name', 'category_type']) || [];

  var total = profiles.length + accounts.length + transactions.length +
              budgets.length + goals.length + categories.length;

  if (total === 0) {
    gs.warn('PFMT System Backup: nothing to back up — no email sent.');
    return;
  }

  // ── per-user tally, so the owner can see whose data is in the file ──
  var nameById = {}, tally = {};
  profiles.forEach(function (p) {
    nameById[p.sys_id] = p.username || '(unnamed)';
    tally[p.sys_id] = { username: nameById[p.sys_id], accounts: 0, transactions: 0, budgets: 0, goals: 0 };
  });
  function count(rows, key) {
    rows.forEach(function (r) { if (tally[r.user_profile]) tally[r.user_profile][key]++; });
  }
  count(accounts, 'accounts'); count(transactions, 'transactions');
  count(budgets, 'budgets');   count(goals, 'goals');

  var perUser = [];
  for (var id in tally) { if (tally.hasOwnProperty(id)) perUser.push(tally[id]); }

  var full = {
    exportedOn     : now.getValue(),
    scope          : 'system — every user',
    secretsIncluded: INCLUDE_SECRETS,
    totals         : {
      users: profiles.length, accounts: accounts.length, transactions: transactions.length,
      budgets: budgets.length, goals: goals.length, categories: categories.length, allRows: total
    },
    perUser        : perUser,
    schemaNote     : 'transfer_group pairs the two legs of a transfer or funded asset; ag_ prefix = asset purchase, tg_ = transfer',
    user_profile   : profiles,
    account        : accounts,
    transaction    : transactions,
    budget         : budgets,
    savings_goal   : goals,
    category       : categories
  };

  // One readable CSV of every transaction across all users — the file an owner
  // is most likely to open first.
  var txnCSV = csvRow(['User', 'Date', 'Type', 'Description', 'Category', 'Account',
                       'Currency', 'Amount', 'TransferGroup', 'Notes']);
  transactions.forEach(function (t) {
    txnCSV += csvRow([nameById[t.user_profile] || t.user_profile, t.date, t.type, t.description,
                      t.category, t.account, t.currency, t.amount, t.transfer_group, t.notes]);
  });

  // ── who gets it ───────────────────────────────────────────
  var recipient = OWNER_EMAIL;
  if (!recipient) {
    for (var i = 0; i < profiles.length; i++) {
      if (profiles[i].email) { recipient = profiles[i].email; break; }
    }
  }
  if (!recipient) {
    gs.error('PFMT System Backup: no recipient — set OWNER_EMAIL at the top of this script.');
    return;
  }

  var summary = '';
  perUser.forEach(function (u) {
    summary += '  ' + u.username + ': ' + u.accounts + ' accounts, ' + u.transactions +
               ' transactions, ' + u.budgets + ' budgets, ' + u.goals + ' goals\n';
  });

  var emailGR = new GlideRecord('sys_email');
  emailGR.initialize();
  emailGR.type        = 'send-ready';
  emailGR.recipients  = recipient;
  emailGR.subject     = 'PFMT System Backup — ' + dateTag + ' (' + total + ' rows, ' + profiles.length + ' users)';
  emailGR.content_type = 'text/plain';
  emailGR.body =
    'Full system backup as of ' + dateTag + '.\n\n' +
    'Every user is included — this is the whole application, not one account.\n\n' +
    summary + '\n' +
    'Totals: ' + profiles.length + ' users, ' + accounts.length + ' accounts, ' +
    transactions.length + ' transactions, ' + budgets.length + ' budgets, ' +
    goals.length + ' goals.\n\n' +
    'Attached:\n' +
    '  pfmt_system_' + dateTag + '.json  — the restore file, every table\n' +
    '  pfmt_system_transactions_' + dateTag + '.csv  — all transactions, readable in a spreadsheet\n\n' +
    (INCLUDE_SECRETS
      ? 'WARNING: this copy contains password hashes and API keys. Store it accordingly.\n\n'
      : 'Password hashes and API keys are redacted. Set INCLUDE_SECRETS at the top of the job if a\nfull disaster-recovery copy is needed.\n\n') +
    '— PFMT (automated, no reply needed)';

  var emailSysId = emailGR.insert();
  if (!emailSysId) {
    gs.error('PFMT System Backup: could not queue the email.');
    return;
  }

  var sa = new GlideSysAttachment();
  sa.write(emailGR, 'pfmt_system_' + dateTag + '.json', 'application/json', JSON.stringify(full));
  sa.write(emailGR, 'pfmt_system_transactions_' + dateTag + '.csv', 'text/csv', txnCSV);

  gs.info('PFMT System Backup ' + dateTag + ': ' + total + ' rows across ' +
          profiles.length + ' user(s) sent to ' + recipient +
          (INCLUDE_SECRETS ? ' [secrets included]' : ' [secrets redacted]'));

})();
