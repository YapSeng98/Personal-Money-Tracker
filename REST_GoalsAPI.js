// ============================================================
// PFMT Scripted REST API — /goals
// Location : ServiceNow → Scripted REST APIs
// API Name : PFMT API  (base path /pfmt/v1)
// Resource : /goals
// Methods  : GET, POST, PUT, DELETE
// Full URL : https://<instance>.service-now.com/api/x_pfmt/pfmt/v1/goals
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

  // ── GET /goals ────────────────────────────────────────────
  if (method === 'GET') {
    var gr = new GlideRecord('x_pfmt_savings_goal');
    gr.addQuery('user_profile', profileSysId);
    gr.orderBy('goal_name');
    gr.query();

    var results = [];
    while (gr.next()) {
      var target  = parseFloat(gr.target_amount.toString())  || 0;
      var current = parseFloat(gr.current_amount.toString()) || 0;
      results.push({
        sys_id              : gr.sys_id.toString(),
        goal_name           : gr.goal_name.toString(),
        goal_icon           : gr.goal_icon.toString(),
        target_amount       : target,
        current_amount      : current,
        monthly_contribution: parseFloat(gr.monthly_contribution.toString()) || 0,
        target_date         : gr.target_date.toString(),
        goal_status         : gr.goal_status.toString(),
        progress_pct        : target > 0 ? Math.min((current / target) * 100, 100) : 0,
        account_sys_id      : gr.account.toString(),
        account_name        : gr.account.account_name.toString()
      });
    }

    response.setStatus(200);
    response.setBody({ result: results, count: results.length });
    return;
  }

  // ── POST /goals ───────────────────────────────────────────
  // Body: { goal_name, goal_icon, target_amount, current_amount, monthly_contribution, target_date }
  if (method === 'POST') {
    var body = request.body ? request.body.data : {};

    if (!body.goal_name || !body.target_amount) {
      helper.errorResponse(response, 400, 'goal_name and target_amount are required');
      return;
    }

    var newGR = new GlideRecord('x_pfmt_savings_goal');
    newGR.initialize();
    newGR.user_profile          = profileSysId;
    newGR.goal_name             = body.goal_name;
    newGR.goal_icon             = body.goal_icon             || '🎯';
    newGR.target_amount         = parseFloat(body.target_amount);
    newGR.current_amount        = parseFloat(body.current_amount)        || 0;
    newGR.monthly_contribution  = parseFloat(body.monthly_contribution)  || 0;
    newGR.target_date           = body.target_date           || '';
    newGR.goal_status           = parseFloat(body.current_amount) >= parseFloat(body.target_amount)
                                    ? 'achieved' : 'in_progress';

    // Link to an account if provided
    if (body.account_name) {
      var accGR = new GlideRecord('x_pfmt_account');
      accGR.addQuery('user_profile', profileSysId);
      accGR.addQuery('account_name', body.account_name);
      accGR.setLimit(1);
      accGR.query();
      if (accGR.next()) newGR.account = accGR.sys_id;
    }

    var newSysId = newGR.insert();
    response.setStatus(201);
    response.setBody({ result: { sys_id: newSysId, status: 'created' } });
    return;
  }

  // ── PUT /goals ────────────────────────────────────────────
  // Body: { sys_id, goal_name, goal_icon, target_amount, current_amount, monthly_contribution, target_date }
  if (method === 'PUT') {
    var putBody = request.body ? request.body.data : {};
    if (!putBody.sys_id) {
      helper.errorResponse(response, 400, 'sys_id is required');
      return;
    }

    var editGR = new GlideRecord('x_pfmt_savings_goal');
    if (!editGR.get(putBody.sys_id) || editGR.user_profile.toString() !== profileSysId) {
      helper.errorResponse(response, 404, 'Goal not found');
      return;
    }

    if (putBody.goal_name            !== undefined) editGR.goal_name            = putBody.goal_name;
    if (putBody.goal_icon            !== undefined) editGR.goal_icon            = putBody.goal_icon;
    if (putBody.target_amount        !== undefined) editGR.target_amount        = parseFloat(putBody.target_amount);
    if (putBody.current_amount       !== undefined) editGR.current_amount       = parseFloat(putBody.current_amount);
    if (putBody.monthly_contribution !== undefined) editGR.monthly_contribution = parseFloat(putBody.monthly_contribution);
    if (putBody.target_date          !== undefined) editGR.target_date          = putBody.target_date;

    // Auto-update status
    var updatedCurrent = parseFloat(editGR.current_amount.toString()) || 0;
    var updatedTarget  = parseFloat(editGR.target_amount.toString())  || 0;
    editGR.goal_status = (updatedCurrent >= updatedTarget && updatedTarget > 0) ? 'achieved' : 'in_progress';

    editGR.update();
    response.setStatus(200);
    response.setBody({ result: { sys_id: putBody.sys_id, status: 'updated' } });
    return;
  }

  // ── DELETE /goals ─────────────────────────────────────────
  if (method === 'DELETE') {
    var delBody = request.body ? request.body.data : {};
    var delId   = delBody.sys_id || request.queryParams.sys_id;
    if (!delId) {
      helper.errorResponse(response, 400, 'sys_id is required');
      return;
    }

    var delGR = new GlideRecord('x_pfmt_savings_goal');
    if (!delGR.get(delId) || delGR.user_profile.toString() !== profileSysId) {
      helper.errorResponse(response, 404, 'Goal not found');
      return;
    }

    delGR.deleteRecord();
    response.setStatus(200);
    response.setBody({ result: { sys_id: delId, status: 'deleted' } });
    return;
  }

  helper.errorResponse(response, 405, 'Method not allowed');

})(request, response);
