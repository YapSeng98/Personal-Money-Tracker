// ============================================================
// PFMT Flow 4 — Recurring Transaction Processor
// Trigger  : Scheduled · Daily · 08:00 SGT
// Paste into: Flow Designer → New Flow → Script step
// ============================================================

(function() {
  var processedCount = 0;
  var today          = new GlideDate();
  today.setValue(new GlideDateTime().getDate().getValue());

  var gr = new GlideRecord('x_887486_0_transaction');
  gr.addQuery('is_recurring',  true);
  gr.addQuery('next_run_date', '<=', today);
  gr.addQuery('state', '2'); // Confirmed templates only
  gr.query();

  while (gr.next()) {
    // Clone as a new confirmed transaction
    var newTxn = new GlideRecord('x_887486_0_transaction');
    newTxn.initialize();
    newTxn.account           = gr.account;
    newTxn.category          = gr.category;
    newTxn.transaction_type  = gr.transaction_type;
    newTxn.amount            = gr.amount;
    newTxn.description       = gr.description;
    newTxn.transaction_date  = today;
    newTxn.state             = '2'; // Confirmed
    newTxn.is_recurring      = false; // clone is a one-off instance
    newTxn.notes             = 'Auto-generated from recurring template: ' + gr.sys_id;
    newTxn.insert();

    // Advance the template's next_run_date
    var freq    = gr.recurring_frequency.toString();
    var nextRun = new GlideDateTime();
    if      (freq === 'daily')   nextRun.addDaysUTC(1);
    else if (freq === 'weekly')  nextRun.addDaysUTC(7);
    else if (freq === 'monthly') nextRun.addMonthsUTC(1);

    gr.next_run_date = nextRun.getDate();
    gr.update();
    processedCount++;
  }

  outputs.transactions_created = processedCount;
  gs.info('PFMT Flow4: Processed ' + processedCount + ' recurring transactions.');
})();
