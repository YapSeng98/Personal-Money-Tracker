// ============================================================
// PFMT Scripted REST API — /profile
// Location : ServiceNow → Scripted REST APIs
// API Name : PFMT API  (base path /pfmt/v1)
// Resource : /profile
// Methods  : GET, PUT
// Full URL : https://<instance>.service-now.com/api/x_pfmt/pfmt/v1/profile
//
// All requests require header: X-PFMT-Token: <token>
// NOTE: Set "Requires authentication" = false on this resource
// ============================================================

(function process(request, response) {

  var helper = new PFMTAuthHelper();
  var method = request.getMethod();
  var token  = request.getHeader('X-PFMT-Token') || '';

  // ── CORS headers ─────────────────────────────────────────
  response.setHeader('Access-Control-Allow-Origin',  '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-PFMT-Token');

  if (method === 'OPTIONS') { response.setStatus(200); return; }

  // ── Validate token ────────────────────────────────────────
  var profileSysId = helper.validateToken(token);
  if (!profileSysId) {
    helper.errorResponse(response, 401, 'Invalid or expired session. Please log in again.');
    return;
  }

  var profileGR = new GlideRecord('x_pfmt_user_profile');
  if (!profileGR.get(profileSysId)) {
    helper.errorResponse(response, 404, 'User profile not found');
    return;
  }

  // ── GET /profile ─────────────────────────────────────────
  if (method === 'GET') {
    // Gather summary counts for profile display
    var txnCount = 0;
    var txnGR = new GlideRecord('x_pfmt_transaction');
    txnGR.addQuery('account.user_profile', profileSysId);
    txnGR.query();
    while (txnGR.next()) txnCount++;

    var accCount = 0;
    var accGR = new GlideRecord('x_pfmt_account');
    accGR.addQuery('user_profile', profileSysId);
    accGR.query();
    while (accGR.next()) accCount++;

    var goalCount = 0;
    var goalGR = new GlideRecord('x_pfmt_savings_goal');
    goalGR.addQuery('user_profile', profileSysId);
    goalGR.addQuery('goal_status', '!=', 'achieved');
    goalGR.query();
    while (goalGR.next()) goalCount++;

    response.setStatus(200);
    response.setBody({
      result: {
        sys_id                : profileSysId,
        username              : profileGR.username.toString(),
        display_name          : profileGR.display_name.toString(),
        email                 : profileGR.email.toString(),
        currency              : profileGR.currency_preference.toString() || 'SGD',
        language              : profileGR.language_preference.toString() || 'en',
        avatar_color          : profileGR.avatar_color.toString()        || '#8B5CF6',
        monthly_income_target : parseFloat(profileGR.monthly_income_target.toString()) || 0,
        last_login            : profileGR.last_login.toString(),
        sys_created_on        : profileGR.sys_created_on.toString(),
        stats: {
          transaction_count : txnCount,
          account_count     : accCount,
          active_goal_count : goalCount
        }
      }
    });
    return;
  }

  // ── PUT /profile ─────────────────────────────────────────
  if (method === 'PUT') {
    var body = request.body ? request.body.data : {};

    if (body.display_name !== undefined)
      profileGR.display_name = body.display_name;

    if (body.email !== undefined)
      profileGR.email = body.email;

    if (body.currency !== undefined)
      profileGR.currency_preference = body.currency;

    if (body.language !== undefined)
      profileGR.language_preference = body.language;

    if (body.avatar_color !== undefined)
      profileGR.avatar_color = body.avatar_color;

    if (body.monthly_income_target !== undefined)
      profileGR.monthly_income_target = parseFloat(body.monthly_income_target) || 0;

    // Password change — requires current_password verification
    if (body.new_password) {
      if (!body.current_password) {
        helper.errorResponse(response, 400, 'current_password is required to change password');
        return;
      }
      var currentHash = helper.hashPassword(body.current_password);
      if (currentHash !== profileGR.password_hash.toString()) {
        helper.errorResponse(response, 403, 'Current password is incorrect');
        return;
      }
      if (body.new_password.length < 6) {
        helper.errorResponse(response, 400, 'New password must be at least 6 characters');
        return;
      }
      profileGR.password_hash = helper.hashPassword(body.new_password);
    }

    profileGR.update();

    response.setStatus(200);
    response.setBody({
      result: {
        status       : 'updated',
        display_name : profileGR.display_name.toString(),
        email        : profileGR.email.toString(),
        currency     : profileGR.currency_preference.toString(),
        language     : profileGR.language_preference.toString(),
        avatar_color : profileGR.avatar_color.toString(),
        monthly_income_target: parseFloat(profileGR.monthly_income_target.toString()) || 0
      }
    });
    return;
  }

  helper.errorResponse(response, 405, 'Method not allowed');

})(request, response);
