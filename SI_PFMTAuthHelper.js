// ============================================================
// PFMT Script Include — PFMTAuthHelper
// Location : ServiceNow → Studio → Create File → Script Include
// Name     : PFMTAuthHelper
// Client callable: NO
// ============================================================

var PFMTAuthHelper = Class.create();
PFMTAuthHelper.prototype = {

  initialize: function() {},

  // ── Validate token from request header X-PFMT-Token ──────
  // Returns user_profile sys_id string, or null if invalid/expired
  validateToken: function(token) {
    if (!token) return null;

    var gr = new GlideRecord('x_1472763_person_0_session');
    gr.addQuery('token', token);
    gr.addQuery('expires_at', '>', new GlideDateTime());
    gr.setLimit(1);
    gr.query();

    if (!gr.next()) return null;

    // Bump last-seen on the user profile
    var profileSysId = gr.user_profile.toString();
    var profileGR = new GlideRecord('x_1472763_person_0_user_profile');
    if (profileGR.get(profileSysId)) {
      profileGR.last_login = new GlideDateTime();
      profileGR.update();
    }

    return profileSysId;
  },

  // ── Hash a plaintext password with SHA-256 ───────────────
  hashPassword: function(plaintext) {
    var digest = new GlideDigest();
    return digest.getSHA256Hex(plaintext);
  },

  // ── Generate a random 64-char hex session token ──────────
  generateToken: function() {
    var raw = gs.generateGUID() + gs.generateGUID();
    return raw.replace(/-/g, '').substring(0, 64);
  },

  // ── Create a session record (7-day expiry) ───────────────
  createSession: function(userProfileSysId, deviceHint) {
    var token   = this.generateToken();
    var expires = new GlideDateTime();
    expires.addDaysUTC(7);

    var gr = new GlideRecord('x_1472763_person_0_session');
    gr.initialize();
    gr.user_profile = userProfileSysId;
    gr.token        = token;
    gr.expires_at   = expires;
    gr.device_hint  = deviceHint || '';
    gr.insert();

    return token;
  },

  // ── Delete a session by token (logout) ───────────────────
  deleteSession: function(token) {
    var gr = new GlideRecord('x_1472763_person_0_session');
    gr.addQuery('token', token);
    gr.query();
    while (gr.next()) gr.deleteRecord();
  },

  // ── Clean up expired sessions (run periodically) ─────────
  pruneExpiredSessions: function() {
    var gr = new GlideRecord('x_1472763_person_0_session');
    gr.addQuery('expires_at', '<', new GlideDateTime());
    gr.query();
    var count = 0;
    while (gr.next()) { gr.deleteRecord(); count++; }
    gs.info('PFMTAuthHelper: pruned ' + count + ' expired sessions.');
  },

  // ── Build a standardised error response ──────────────────
  errorResponse: function(response, status, message) {
    response.setStatus(status);
    response.setBody({ error: message });
  },

  type: 'PFMTAuthHelper'
};
