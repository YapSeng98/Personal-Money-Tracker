// ============================================================
// PFMT Scripted REST API — /auth
// Location : ServiceNow → Scripted REST APIs
// API Name : PFMT API  (same as existing, base path /pfmt/v1)
// Resource : /auth/{action}
// Methods  : POST
// Full URL : https://<instance>.service-now.com/api/x_pfmt/pfmt/v1/auth/{action}
//
// Actions:
//   POST /pfmt/v1/auth/login     — validate username+password, return token
//   POST /pfmt/v1/auth/register  — create new user profile
//   POST /pfmt/v1/auth/logout    — delete session token
//
// NOTE: Set "Requires authentication" = false on this resource
//       so users can log in without SN credentials.
// ============================================================

(function process(request, response) {

  var helper = new PFMTAuthHelper();
  var action = request.pathParams.action; // login | register | logout
  var body   = request.body ? request.body.data : {};

  // ── CORS headers (needed for GitHub Pages → SN calls) ────
  response.setHeader('Access-Control-Allow-Origin',  '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-PFMT-Token');

  if (request.getMethod() === 'OPTIONS') {
    response.setStatus(200);
    return;
  }

  // ── /auth/login ──────────────────────────────────────────
  if (action === 'login') {
    var username = (body.username || '').trim().toLowerCase();
    var password = body.password  || '';

    if (!username || !password) {
      helper.errorResponse(response, 400, 'username and password are required');
      return;
    }

    var profileGR = new GlideRecord('x_pfmt_user_profile');
    profileGR.addQuery('username', username);
    profileGR.setLimit(1);
    profileGR.query();

    if (!profileGR.next()) {
      helper.errorResponse(response, 401, 'Invalid username or password');
      return;
    }

    var storedHash = profileGR.password_hash.toString();
    var inputHash  = helper.hashPassword(password);

    if (storedHash !== inputHash) {
      helper.errorResponse(response, 401, 'Invalid username or password');
      return;
    }

    var deviceHint = request.getHeader('User-Agent') || '';
    var token      = helper.createSession(profileGR.sys_id.toString(), deviceHint.substring(0, 100));

    response.setStatus(200);
    response.setBody({
      result: {
        token             : token,
        user_profile_sys_id: profileGR.sys_id.toString(),
        username          : profileGR.username.toString(),
        display_name      : profileGR.display_name.toString(),
        email             : profileGR.email.toString(),
        currency          : profileGR.currency_preference.toString() || 'SGD',
        language          : profileGR.language_preference.toString() || 'en',
        avatar_color      : profileGR.avatar_color.toString()        || '#8B5CF6',
        monthly_income_target: parseFloat(profileGR.monthly_income_target.toString()) || 0
      }
    });
    return;
  }

  // ── /auth/register ───────────────────────────────────────
  if (action === 'register') {
    var regUsername    = (body.username     || '').trim().toLowerCase();
    var regPassword    = body.password      || '';
    var regDisplayName = (body.display_name || '').trim();
    var regEmail       = (body.email        || '').trim();

    if (!regUsername || !regPassword) {
      helper.errorResponse(response, 400, 'username and password are required');
      return;
    }
    if (regPassword.length < 6) {
      helper.errorResponse(response, 400, 'password must be at least 6 characters');
      return;
    }

    // Check username not already taken
    var checkGR = new GlideRecord('x_pfmt_user_profile');
    checkGR.addQuery('username', regUsername);
    checkGR.setLimit(1);
    checkGR.query();
    if (checkGR.next()) {
      helper.errorResponse(response, 409, 'Username already taken');
      return;
    }

    var newGR = new GlideRecord('x_pfmt_user_profile');
    newGR.initialize();
    newGR.username            = regUsername;
    newGR.password_hash       = helper.hashPassword(regPassword);
    newGR.display_name        = regDisplayName || regUsername;
    newGR.email               = regEmail;
    newGR.currency_preference = body.currency  || 'SGD';
    newGR.language_preference = body.language  || 'en';
    newGR.avatar_color        = body.avatar_color || '#8B5CF6';
    newGR.last_login          = new GlideDateTime();

    var newSysId = newGR.insert();
    if (!newSysId) {
      helper.errorResponse(response, 500, 'Failed to create user profile');
      return;
    }

    var regDeviceHint = (request.getHeader('User-Agent') || '').substring(0, 100);
    var regToken      = helper.createSession(newSysId, regDeviceHint);

    response.setStatus(201);
    response.setBody({
      result: {
        token              : regToken,
        user_profile_sys_id: newSysId,
        username           : regUsername,
        display_name       : newGR.display_name.toString(),
        email              : regEmail,
        currency           : newGR.currency_preference.toString(),
        language           : newGR.language_preference.toString(),
        avatar_color       : newGR.avatar_color.toString()
      }
    });
    return;
  }

  // ── /auth/logout ─────────────────────────────────────────
  if (action === 'logout') {
    var logoutToken = request.getHeader('X-PFMT-Token') || (body.token || '');
    if (logoutToken) helper.deleteSession(logoutToken);
    response.setStatus(200);
    response.setBody({ result: { status: 'logged_out' } });
    return;
  }

  // ── Unknown action ────────────────────────────────────────
  helper.errorResponse(response, 404, 'Unknown auth action: ' + action);

})(request, response);
