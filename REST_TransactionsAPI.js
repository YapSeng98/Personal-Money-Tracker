// ============================================================
// PFMT Scripted REST API — /transactions
// Location : ServiceNow → Scripted REST APIs → New
// API Name : PFMT API
// Base Path: /pfmt/v1
// Resource : /transactions
// Methods  : GET, POST
// Full URL : https://<instance>.service-now.com/api/x_pfmt/pfmt/v1/transactions
// ============================================================

(function process(request, response) {

  var method = request.getMethod();

  // ── GET ─────────────────────────────────────────────────
  // Query params:
  //   limit  (int,  default 50)
  //   type   (string: expense | income | transfer)
  //   month  (string: YYYY-MM)
  // Example: GET /api/x_pfmt/pfmt/v1/transactions?type=expense&month=2026-06
  if (method === 'GET') {
    var limit  = parseInt(request.queryParams.limit)   || 50;
    var type   = request.queryParams.type    || '';
    var month  = request.queryParams.month   || '';

    var gr = new GlideRecord('x_pfmt_transaction');
    gr.addQuery('sys_created_by', gs.getUserName()); // RBAC: own records only
    if (type)  gr.addQuery('transaction_type', type);
    if (month) gr.addQuery('transaction_date', 'STARTSWITH', month);
    gr.orderByDesc('transaction_date');
    gr.setLimit(limit);
    gr.query();

    var results = [];
    while (gr.next()) {
      results.push({
        sys_id       : gr.sys_id.toString(),
        type         : gr.transaction_type.toString(),
        amount       : parseFloat(gr.amount.toString()),
        description  : gr.description.toString(),
        category     : gr.category.category_name.toString(),
        account      : gr.account.account_name.toString(),
        date         : gr.transaction_date.toString(),
        state        : gr.state.getDisplayValue(),
        notes        : gr.notes.toString()
      });
    }

    response.setStatus(200);
    response.setBody({ result: results, count: results.length });
    return;
  }

  // ── POST ─────────────────────────────────────────────────
  // Body (JSON):
  // {
  //   "type"          : "expense",         // required
  //   "amount"        : 84.30,             // required
  //   "description"   : "NTUC FairPrice",  // required
  //   "date"          : "2026-06-10",      // optional, defaults to today
  //   "account_name"  : "DBS Checking",    // optional
  //   "category_name" : "Groceries",       // optional
  //   "notes"         : "Weekly shop"      // optional
  // }
  if (method === 'POST') {
    var body = request.body.data;

    if (!body.amount || parseFloat(body.amount) <= 0) {
      response.setStatus(400);
      response.setBody({ error: 'amount must be > 0' });
      return;
    }
    if (!body.description) {
      response.setStatus(400);
      response.setBody({ error: 'description is required' });
      return;
    }

    var newGR = new GlideRecord('x_pfmt_transaction');
    newGR.initialize();
    newGR.transaction_type  = body.type        || 'expense';
    newGR.amount            = parseFloat(body.amount);
    newGR.description       = body.description;
    newGR.transaction_date  = body.date ||
                              new GlideDateTime().getDate().getValue();
    newGR.notes             = body.notes || '';
    newGR.state             = '2'; // Confirmed

    // Resolve account by name
    if (body.account_name) {
      var acctGR = new GlideRecord('x_pfmt_account');
      acctGR.addQuery('account_name', body.account_name);
      acctGR.query();
      if (acctGR.next()) newGR.account = acctGR.sys_id;
    }

    // Resolve category by name
    if (body.category_name) {
      var catGR = new GlideRecord('x_pfmt_category');
      catGR.addQuery('category_name', body.category_name);
      catGR.query();
      if (catGR.next()) newGR.category = catGR.sys_id;
    }

    var sysID = newGR.insert();
    response.setStatus(201);
    response.setBody({ result: { sys_id: sysID, status: 'created' } });
    return;
  }

  // ── Method not allowed ───────────────────────────────────
  response.setStatus(405);
  response.setBody({ error: 'Method not allowed' });

})(request, response);
