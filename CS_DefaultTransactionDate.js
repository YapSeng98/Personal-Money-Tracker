// ============================================================
// PFMT Client Script 1 — Default Transaction Date
// Table    : x_pfmt_transaction
// Type     : onLoad
// ============================================================

function onLoad() {
  // Only default if this is a new record
  if (g_form.isNewRecord()) {
    var today = new GlideDateTime();
    g_form.setValue('transaction_date', today.getDate().getByFormat('yyyy-MM-dd'));

    // Default state to 'Confirmed' (2) for new records
    g_form.setValue('state', '2');

    // Hide recurring fields until toggled
    g_form.setDisplay('recurring_frequency', false);
    g_form.setDisplay('next_run_date',        false);
  }
}
