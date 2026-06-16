// ============================================================
// PFMT Scripted REST API — /transactions
// Location : ServiceNow → Scripted REST APIs
// API Name : PFMT API  (base path /pfmt/v1)
// Resource : /transactions
// Methods  : GET, POST, PUT, DELETE
// Full URL : https://<instance>.service-now.com/api/x_887486_0/pfmt/v1/transactions
//
// All requests require header: X-PFMT-Token: <token>
// NOTE: Set "Requires authentication" = false on this resource
// ============================================================

(function process(request, response) {

  var helper = new PFMTAuthHelper();
  var method = request.getHeader('X-HTTP-Method');
  var token  = request.getHeader('X-PFMT-Token') || '';

  // ── CORS headers ─────────────────────────────────────────
  response.setHeader('Access-Control-Allow-Origin',  '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-PFMT-Token, X-HTTP-Method');

  if (method === 'OPTIONS') { response.setStatus(200); return; }

  // ── Validate token ────────────────────────────────────────
  var profileSysId = helper.validateToken(token);
  if (!profileSysId) {
    helper.errorResponse(response, 401, 'Invalid or expired session. Please log in again.');
    return;
  }

  // ── GET /transactions ─────────────────────────────────────
  if (method === 'GET') {
    var limit  = parseInt(request.queryParams.limit) || 500;
    var type   = request.queryParams.type  || '';
    var month  = request.queryParams.month || '';

    var gr = new GlideRecord('x_887486_0_transaction');
    gr.addQuery('user_profile', profileSysId);
    if (type)  gr.addQuery('transaction_type', type);
    if (month) gr.addQuery('transaction_date', 'STARTSWITH', month);
    gr.orderByDesc('transaction_date');
    gr.setLimit(limit);
    gr.query();

    var results = [];
    while (gr.next()) {
      results.push({
        sys_id     : gr.sys_id.toString(),
        type       : gr.transaction_type.toString(),
        amount     : parseFloat(gr.amount.toString()),
        description: gr.description.toString(),
        category   : gr.category.category_name.toString(),
        account    : gr.account.account_name.toString(),
        date       : gr.transaction_date.toString(),
        notes      : gr.notes.toString()
      });
    }

    response.setStatus(200);
    response.setBody({ result: results, count: results.length });
    return;
  }

  // ── POST /transactions ────────────────────────────────────
  // Body: { type, amount, description, date, account_name, category_name, notes }
  if (method === 'POST') {
    var body = request.body ? request.body.data : {};

    if (!body.amount || parseFloat(body.amount) <= 0) {
      helper.errorResponse(response, 400, 'amount must be > 0');
      return;
    }
    if (!body.description) {
      helper.errorResponse(response, 400, 'description is required');
      return;
    }

    var newGR = new GlideRecord('x_887486_0_transaction');
    newGR.initialize();
    newGR.user_profile     = profileSysId;
    newGR.transaction_type = body.type        || 'expense';
    newGR.amount           = parseFloat(body.amount);
    newGR.description      = body.description;
    newGR.transaction_date = body.date || new GlideDateTime().getDate().getValue();
    newGR.notes            = body.notes || '';
    newGR.state            = '2'; // Confirmed

    // Resolve account by name (must belong to this user)
    if (body.account_name) {
      var accGR = new GlideRecord('x_887486_0_account');
      accGR.addQuery('user_profile', profileSysId);
      accGR.addQuery('account_name', body.account_name);
      accGR.setLimit(1);
      accGR.query();
      if (accGR.next()) newGR.account = accGR.sys_id;
    }

    // Resolve category by name
    if (body.category_name) {
      var catGR = new GlideRecord('x_887486_0_category');
      catGR.addQuery('category_name', body.category_name);
      catGR.setLimit(1);
      catGR.query();
      if (catGR.next()) newGR.category = catGR.sys_id;
    }

    var newSysId = newGR.insert();
    response.setStatus(201);
    response.setBody({ result: { sys_id: newSysId, status: 'created' } });
    return;
  }

  // ── PUT /transactions ─────────────────────────────────────
  // Body: { sys_id, type, amount, description, date, account_name, category_name, notes }
  if (method === 'PUT') {
    var putBody = request.body ? request.body.data : {};
    if (!putBody.sys_id) {
      helper.errorResponse(response, 400, 'sys_id is required');
      return;
    }

    var editGR = new GlideRecord('x_887486_0_transaction');
    if (!editGR.get(putBody.sys_id)) {
      helper.errorResponse(response, 404, 'Transaction not found');
      return;
    }
    if (editGR.user_profile.toString() !== profileSysId) {
      helper.errorResponse(response, 403, 'Access denied');
      return;
    }

    if (putBody.type        !== undefined) editGR.transaction_type = putBody.type;
    if (putBody.amount      !== undefined) editGR.amount           = parseFloat(putBody.amount);
    if (putBody.description !== undefined) editGR.description      = putBody.description;
    if (putBody.date        !== undefined) editGR.transaction_date = putBody.date;
    if (putBody.notes       !== undefined) editGR.notes            = putBody.notes;

    if (putBody.account_name) {
      var putAccGR = new GlideRecord('x_887486_0_account');
      putAccGR.addQuery('user_profile', profileSysId);
      putAccGR.addQuery('account_name', putBody.account_name);
      putAccGR.setLimit(1);
      putAccGR.query();
      if (putAccGR.next()) editGR.account = putAccGR.sys_id;
    }
    if (putBody.category_name) {
      var putCatGR = new GlideRecord('x_887486_0_category');
      putCatGR.addQuery('category_name', putBody.category_name);
      putCatGR.setLimit(1);
      putCatGR.query();
      if (putCatGR.next()) editGR.category = putCatGR.sys_id;
    }

    editGR.update();
    response.setStatus(200);
    response.setBody({ result: { sys_id: putBody.sys_id, status: 'updated' } });
    return;
  }

  // ── DELETE /transactions ──────────────────────────────────
  // Query param: ?sys_id=  (SN blocks body access on DELETE)
  if (method === 'DELETE') {
    var delId = request.queryParams.sys_id;
    if (!delId) {
      helper.errorResponse(response, 400, 'sys_id is required');
      return;
    }

    var delGR = new GlideRecord('x_887486_0_transaction');
    if (!delGR.get(delId)) {
      helper.errorResponse(response, 404, 'Transaction not found');
      return;
    }
    if (delGR.user_profile.toString() !== profileSysId) {
      helper.errorResponse(response, 403, 'Access denied');
      return;
    }

    delGR.deleteRecord();
    response.setStatus(200);
    response.setBody({ result: { sys_id: delId, status: 'deleted' } });
    return;
  }

  helper.errorResponse(response, 405, 'Method not allowed');

})(request, response);
