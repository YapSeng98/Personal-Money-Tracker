// ============================================================
// PFMT Scripted REST API — /accounts
// Location : ServiceNow → Scripted REST APIs
// API Name : PFMT API  (base path /pfmt/v1)
// Resource : /accounts
// Methods  : GET, POST, PUT, DELETE
// Full URL : https://<instance>.service-now.com/api/x_pfmt/pfmt/v1/accounts
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

  // ── GET /accounts ─────────────────────────────────────────
  if (method === 'GET') {
    var gr = new GlideRecord('x_887486_0_account');
    gr.addQuery('user_profile', profileSysId);
    gr.orderBy('account_name');
    gr.query();

    var results = [];
    while (gr.next()) {
      results.push({
        sys_id           : gr.getValue('sys_id')           || '',
        account_name     : gr.getValue('account_name')     || '',
        account_type     : gr.getValue('account_type')     || gr.getValue('type') || 'checking',
        institution_name : gr.getValue('institution_name') || gr.getValue('bank_name') || '',
        current_balance  : parseFloat(gr.getValue('current_balance') || gr.getValue('balance') || '0') || 0,
        currency         : gr.getValue('currency')         || 'SGD'
      });
    }

    response.setStatus(200);
    response.setBody({ result: results, count: results.length });
    return;
  }

  // ── POST /accounts ────────────────────────────────────────
  // Body: { account_name, account_type, institution_name, current_balance, currency }
  if (method === 'POST') {
    var body = request.body ? request.body.data : {};

    if (!body.account_name) {
      helper.errorResponse(response, 400, 'account_name is required');
      return;
    }

    // Check for duplicate account name for this user
    var dupGR = new GlideRecord('x_887486_0_account');
    dupGR.addQuery('user_profile', profileSysId);
    dupGR.addQuery('account_name', body.account_name);
    dupGR.setLimit(1);
    dupGR.query();
    if (dupGR.next()) {
      helper.errorResponse(response, 409, 'Account with this name already exists');
      return;
    }

    var newGR = new GlideRecord('x_887486_0_account');
    newGR.initialize();
    newGR.user_profile     = profileSysId;
    newGR.account_name     = body.account_name;
    newGR.account_type     = body.account_type     || 'checking';
    newGR.institution_name = body.institution_name || '';
    newGR.current_balance  = parseFloat(body.current_balance) || 0;
    newGR.currency         = body.currency         || 'SGD';

    var newSysId = newGR.insert();
    response.setStatus(201);
    response.setBody({ result: { sys_id: newSysId, status: 'created' } });
    return;
  }

  // ── PUT /accounts ─────────────────────────────────────────
  // Body: { sys_id, account_name, account_type, institution_name, current_balance, currency }
  if (method === 'PUT') {
    var putBody = request.body ? request.body.data : {};
    if (!putBody.sys_id) {
      helper.errorResponse(response, 400, 'sys_id is required');
      return;
    }

    var editGR = new GlideRecord('x_887486_0_account');
    if (!editGR.get(putBody.sys_id) || editGR.getValue('user_profile') !== profileSysId) {
      helper.errorResponse(response, 404, 'Account not found');
      return;
    }

    if (putBody.account_name     !== undefined) editGR.account_name     = putBody.account_name;
    if (putBody.account_type     !== undefined) editGR.account_type     = putBody.account_type;
    if (putBody.institution_name !== undefined) editGR.institution_name = putBody.institution_name;
    if (putBody.current_balance  !== undefined) editGR.current_balance  = parseFloat(putBody.current_balance);
    if (putBody.currency         !== undefined) editGR.currency         = putBody.currency;

    editGR.update();
    response.setStatus(200);
    response.setBody({ result: { sys_id: putBody.sys_id, status: 'updated' } });
    return;
  }

  // ── DELETE /accounts ──────────────────────────────────────
  // Tunneled as HTTP POST + X-HTTP-Method: DELETE so body is accessible
  if (method === 'DELETE') {
    var delBody = request.body ? request.body.data : {};
    var delId = delBody.sys_id || '';
    if (!delId) {
      helper.errorResponse(response, 400, 'sys_id is required');
      return;
    }

    var delGR = new GlideRecord('x_887486_0_account');
    if (!delGR.get(delId) || delGR.getValue('user_profile') !== profileSysId) {
      helper.errorResponse(response, 404, 'Account not found');
      return;
    }

    delGR.deleteRecord();
    response.setStatus(200);
    response.setBody({ result: { sys_id: delId, status: 'deleted' } });
    return;
  }

  helper.errorResponse(response, 405, 'Method not allowed');

})(request, response);
