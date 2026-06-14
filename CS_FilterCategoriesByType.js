// ============================================================
// PFMT Client Script 2 — Filter Categories by Transaction Type
// Table    : x_pfmt_transaction
// Type     : onChange
// Field    : transaction_type
// ============================================================

function onChange(control, oldValue, newValue, isLoading) {
  if (isLoading || newValue === '') return;

  var filterQuery = '';

  if (newValue === 'expense' || newValue === 'transfer') {
    filterQuery = 'category_type=expense';
  } else if (newValue === 'income') {
    filterQuery = 'category_type=income';
  }

  // Clear and re-filter the category field
  g_form.clearValue('category');
  g_form.setLookupFilter(
    'category',
    filterQuery,
    'x_pfmt_category'
  );
}
