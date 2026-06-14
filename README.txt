================================================================
PFMT — Personal Finance Money Tracker
ServiceNow PDI Implementation Code Files
================================================================

OPEN ORDER FOR PDI IMPLEMENTATION
──────────────────────────────────
Step 1  →  GR_Utilities.js              Run seedCategories() in Scripts - Background
Step 2  →  BR_ValidateTransaction.js    Create BR in Studio, table x_pfmt_transaction, BEFORE insert+update
Step 3  →  BR_UpdateAccountBalance.js   Create BR, table x_pfmt_transaction, AFTER insert+update
Step 4  →  BR_UpdateBudgetSpent.js      Create BR, table x_pfmt_transaction, AFTER insert (expense only)
Step 5  →  BR_BudgetCalculatedFields.js Create BR, table x_pfmt_budget, BEFORE insert+update
Step 6  →  SI_PFMTBudgetHelper.js       Create Script Include, tick "Client callable"
Step 7  →  CS_DefaultTransactionDate.js Create Client Script, onLoad
Step 8  →  CS_FilterCategoriesByType.js Create Client Script, onChange → transaction_type
Step 9  →  CS_RecurringToggleAndBudgetHint.js  Create Client Script, onChange → is_recurring + category
Step 10 →  FLOW_MonthlyBudgetReset.js   Flow Designer Script step, Scheduled trigger 1st of month
Step 11 →  FLOW_RecurringTransactions.js Flow Designer Script step, Scheduled trigger daily 08:00
Step 12 →  REST_TransactionsAPI.js      Scripted REST API, base path /pfmt/v1, resource /transactions
Step 13 →  PORTAL_Widget_ServerScript.js    Service Portal Widget → Server Script tab
Step 14 →  PORTAL_Widget_ClientController.js Service Portal Widget → Client Controller tab
Step 15 →  PORTAL_Widget_HTML.html          Service Portal Widget → HTML Template tab
Step 16 →  PORTAL_Widget_CSS.scss           Service Portal Widget → CSS tab

WEB APP FILES (open in browser, no install needed)
──────────────────────────────────────────────────
daily-money-tracker-app.html    → Working interactive app with AI insights
daily-money-tracker-design.html → Full design blueprint & diagrams
pfmt-servicenow-code.html       → All code in syntax-highlighted reference viewer

================================================================
All .js files use ServiceNow APIs (GlideRecord, GlideDateTime etc.)
They will NOT run in a browser — paste into your PDI Studio only.
================================================================
