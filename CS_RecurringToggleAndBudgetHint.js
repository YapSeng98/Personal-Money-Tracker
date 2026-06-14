// ============================================================
// PFMT Client Script 3 — Recurring Toggle + Budget Hint
// Table    : x_pfmt_transaction
// Type     : onChange
// Fields   : is_recurring, category
// ============================================================

function onChange(control, oldValue, newValue, isLoading) {
  var fieldName = g_form.getFieldName(control);

  // ── Toggle recurring fields ──────────────────────────────
  if (fieldName === 'is_recurring') {
    var show = (newValue === 'true' || newValue === true);
    g_form.setDisplay('recurring_frequency', show);
    g_form.setDisplay('next_run_date',        show);
    g_form.setMandatory('recurring_frequency', show);
  }

  // ── Show budget hint when category changes ───────────────
  if (fieldName === 'category' && newValue && !isLoading) {
    var ga = new GlideAjax('PFMTBudgetHelper');
    ga.addParam('sysparm_name',     'getBudgetStatus');
    ga.addParam('sysparm_category', newValue);
    ga.getXMLAnswer(function(answer) {
      if (answer) {
        var data = JSON.parse(answer);
        if (data.found) {
          var pct = (data.spent / data.limit * 100).toFixed(1);
          var msg = 'Budget: $' + data.spent + ' spent of $' + data.limit + ' (' + pct + '%)';
          g_form.showFieldMsg('category', msg,
            data.spent > data.limit ? 'error' : 'info');
        }
      }
    });
  }
}
