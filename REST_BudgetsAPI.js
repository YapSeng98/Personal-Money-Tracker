// ============================================================
// PFMT Scripted REST API — /budgets
// Location : ServiceNow → Scripted REST APIs
// API Name : PFMT API  (base path /pfmt/v1)
// Resource : /budgets
// Methods  : GET, POST, PUT, DELETE
// Full URL : https://<instance>.service-now.com/api/x_pfmt/pfmt/v1/budgets
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

  // ── GET /budgets ─────────────────────────────────────────
  // Returns all budgets for the user with current spend
  if (method === 'GET') {
    var gr = new GlideRecord('x_887486_0_budget');
    gr.addQuery('user_profile', profileSysId);
    gr.orderBy('category.category_name');
    gr.query();

    var results = [];
    while (gr.next()) {
      results.push({
        sys_id          : gr.sys_id.toString(),
        category_sys_id : gr.category.toString(),
        category        : gr.category.category_name.toString(),
        category_icon   : gr.category.icon_emoji.toString(),
        category_color  : gr.category.color_hex.toString(),
        budget_amount   : parseFloat(gr.budget_amount.toString())   || 0,
        spent_amount    : parseFloat(gr.spent_amount.toString())    || 0,
        remaining_amount: parseFloat(gr.remaining_amount.toString())|| 0,
        alert_threshold : parseInt(gr.alert_threshold.toString())   || 80,
        period_start    : gr.period_start.toString(),
        period_end      : gr.period_end.toString()
      });
    }

    response.setStatus(200);
    response.setBody({ result: results, count: results.length });
    return;
  }

  // ── POST /budgets ─────────────────────────────────────────
  // Create a new budget. Body: { category_name, budget_amount, alert_threshold }
  if (method === 'POST') {
    var body = request.body ? request.body.data : {};

    if (!body.category_name || !body.budget_amount) {
      helper.errorResponse(response, 400, 'category_name and budget_amount are required');
      return;
    }

    // Resolve category — auto-create if missing
    var catGR = new GlideRecord('x_887486_0_category');
    catGR.addQuery('category_name', body.category_name);
    catGR.setLimit(1);
    catGR.query();
    if (!catGR.next()) {
      catGR = new GlideRecord('x_887486_0_category');
      catGR.initialize();
      catGR.category_name = body.category_name;
      catGR.icon_emoji    = body.category_icon  || '📦';
      catGR.color_hex     = body.category_color || '#6B7280';
      catGR.insert();
    }

    // Check no duplicate budget for same category this period
    var dupGR = new GlideRecord('x_887486_0_budget');
    dupGR.addQuery('user_profile', profileSysId);
    dupGR.addQuery('category', catGR.sys_id);
    dupGR.query();
    if (dupGR.next()) {
      helper.errorResponse(response, 409, 'Budget for this category already exists');
      return;
    }

    // Default period = current calendar month
    var now         = new GlideDateTime();
    var year        = now.getYearUTC();
    var rawMonth    = now.getMonthUTC();
    var month       = (rawMonth < 10 ? '0' : '') + rawMonth;
    var periodStart = year + '-' + month + '-01';
    // Move to first of next month then subtract 1 day
    var nextMonth = new GlideDateTime(periodStart + ' 00:00:00');
    nextMonth.addMonthsUTC(1);
    nextMonth.addDaysUTC(-1);
    var periodEnd = nextMonth.getDate().getValue();

    var newGR = new GlideRecord('x_887486_0_budget');
    newGR.initialize();
    newGR.user_profile     = profileSysId;
    newGR.category         = catGR.sys_id;
    newGR.budget_amount    = parseFloat(body.budget_amount);
    newGR.spent_amount     = 0;
    newGR.remaining_amount = parseFloat(body.budget_amount);
    newGR.alert_threshold  = parseInt(body.alert_threshold) || 80;
    newGR.period_start     = body.period_start || periodStart;
    newGR.period_end       = body.period_end   || periodEnd;

    var newSysId = newGR.insert();
    response.setStatus(201);
    response.setBody({ result: { sys_id: newSysId, status: 'created' } });
    return;
  }

  // ── PUT /budgets ─────────────────────────────────────────
  // Update a budget. Body: { sys_id, budget_amount, alert_threshold }
  if (method === 'PUT') {
    var putBody = request.body ? request.body.data : {};
    if (!putBody.sys_id) {
      helper.errorResponse(response, 400, 'sys_id is required');
      return;
    }

    var editGR = new GlideRecord('x_887486_0_budget');
    if (!editGR.get(putBody.sys_id) || editGR.getValue('user_profile') !== profileSysId) {
      helper.errorResponse(response, 404, 'Budget not found');
      return;
    }

    if (putBody.budget_amount !== undefined) {
      editGR.budget_amount    = parseFloat(putBody.budget_amount);
      var spent = parseFloat(editGR.spent_amount.toString()) || 0;
      editGR.remaining_amount = parseFloat(putBody.budget_amount) - spent;
    }
    if (putBody.alert_threshold !== undefined)
      editGR.alert_threshold = parseInt(putBody.alert_threshold);

    editGR.update();
    response.setStatus(200);
    response.setBody({ result: { sys_id: putBody.sys_id, status: 'updated' } });
    return;
  }

  // ── DELETE /budgets ───────────────────────────────────────
  // Tunneled as HTTP POST + X-HTTP-Method: DELETE so body is accessible
  if (method === 'DELETE') {
    var delBody = request.body ? request.body.data : {};
    var delId = delBody.sys_id || '';
    if (!delId) {
      helper.errorResponse(response, 400, 'sys_id is required');
      return;
    }

    var delGR = new GlideRecord('x_887486_0_budget');
    if (!delGR.get(delId) || delGR.getValue('user_profile') !== profileSysId) {
      helper.errorResponse(response, 404, 'Budget not found');
      return;
    }

    delGR.deleteRecord();
    response.setStatus(200);
    response.setBody({ result: { sys_id: delId, status: 'deleted' } });
    return;
  }

  helper.errorResponse(response, 405, 'Method not allowed');

})(request, response);
