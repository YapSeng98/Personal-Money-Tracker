// ============================================================
// PFMT Script Include — PFMTBudgetHelper
// Client callable: YES (tick the checkbox in Studio)
// Called by      : CS_RecurringToggleAndBudgetHint via GlideAjax
// ============================================================

var PFMTBudgetHelper = Class.create();
PFMTBudgetHelper.prototype = Object.extendsObject(AbstractAjaxProcessor, {

  getBudgetStatus: function() {
    var categoryID = this.getParameter('sysparm_category');
    var today      = new GlideDateTime();

    var budgetGR = new GlideRecord('x_pfmt_budget');
    budgetGR.addQuery('category',    categoryID);
    budgetGR.addQuery('period_start', '<=', today);
    budgetGR.addQuery('period_end',   '>=', today);
    budgetGR.query();

    if (budgetGR.next()) {
      return JSON.stringify({
        found     : true,
        spent     : parseFloat(budgetGR.spent_amount.toString())    || 0,
        limit     : parseFloat(budgetGR.budget_amount.toString())   || 0,
        remaining : parseFloat(budgetGR.remaining_amount.toString()) || 0
      });
    }
    return JSON.stringify({ found: false });
  },

  type: 'PFMTBudgetHelper'
});
