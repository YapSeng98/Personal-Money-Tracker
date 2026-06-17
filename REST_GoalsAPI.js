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

  // SN's goal_icon field is 10 chars wide, so encoding must fit.
  // Supplementary emoji (4 UTF-8 bytes) → 'b' + base64 = 9 chars (fits ✓).
  // BMP emoji (e.g. ✈️, no surrogates) are stored directly.
  // Pure-JS base64 encode/decode avoids any Java package dependency.

  function base64Encode(bytes) {
    var t = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var s = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i], b1 = i+1 < bytes.length ? bytes[i+1] : 0, b2 = i+2 < bytes.length ? bytes[i+2] : 0;
      s += t[b0 >> 2] + t[((b0 & 3) << 4) | (b1 >> 4)]
        + (i+1 < bytes.length ? t[((b1 & 15) << 2) | (b2 >> 6)] : '=')
        + (i+2 < bytes.length ? t[b2 & 63] : '=');
    }
    return s;
  }
  function base64DecodeUTF8(b64) {
    var t = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    b64 = b64.replace(/=+$/, '');
    var bytes = [];
    for (var i = 0; i < b64.length; i += 4) {
      var b0 = t.indexOf(b64[i]), b1 = t.indexOf(b64[i+1] || 'A'),
          b2 = t.indexOf(b64[i+2] || 'A'), b3 = t.indexOf(b64[i+3] || 'A');
      bytes.push((b0 << 2) | (b1 >> 4));
      if (b64[i+2]) bytes.push(((b1 & 15) << 4) | (b2 >> 2));
      if (b64[i+3]) bytes.push(((b2 & 3) << 6) | b3);
    }
    // Decode UTF-8 bytes → JS string (4-byte sequences become surrogate pairs)
    var s = '';
    for (var i = 0; i < bytes.length; ) {
      var b = bytes[i++];
      if (b < 0x80) { s += String.fromCharCode(b); }
      else if (b < 0xE0) { var b2 = bytes[i++]; s += String.fromCharCode(((b & 0x1F) << 6) | (b2 & 0x3F)); }
      else if (b < 0xF0) { var b2 = bytes[i++], b3 = bytes[i++]; s += String.fromCharCode(((b & 0x0F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F)); }
      else {
        var b2 = bytes[i++], b3 = bytes[i++], b4 = bytes[i++];
        var cp = ((b & 0x07) << 18) | ((b2 & 0x3F) << 12) | ((b3 & 0x3F) << 6) | (b4 & 0x3F);
        cp -= 0x10000;
        s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
      }
    }
    return s;
  }

  function safeIconWrite(icon) {
    if (!icon) return 'b8J+Orw=='; // 🎯 encoded, 9 chars
    // Detect surrogate pairs (supplementary-plane emoji)
    var hasSurrogate = false;
    for (var i = 0; i < icon.length; i++) {
      var cc = icon.charCodeAt(i);
      if (cc >= 0xD800 && cc <= 0xDFFF) { hasSurrogate = true; break; }
    }
    if (!hasSurrogate) return icon; // BMP emoji: store directly (e.g. ✈️ = 2 chars)
    // Supplementary: encode as UTF-8 bytes → base64 with 'b' prefix (≤ 9 chars for 1 emoji)
    var bytes = [];
    for (var i = 0; i < icon.length; i++) {
      var cc = icon.charCodeAt(i);
      if (cc >= 0xD800 && cc <= 0xDBFF && i + 1 < icon.length) {
        var cc2 = icon.charCodeAt(i + 1);
        if (cc2 >= 0xDC00 && cc2 <= 0xDFFF) {
          var cp = 0x10000 + (cc - 0xD800) * 0x400 + (cc2 - 0xDC00);
          bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
          i++;
          continue;
        }
      }
      if (cc < 0x80) bytes.push(cc);
      else if (cc < 0x800) { bytes.push(0xC0 | (cc >> 6), 0x80 | (cc & 0x3F)); }
      else { bytes.push(0xE0 | (cc >> 12), 0x80 | ((cc >> 6) & 0x3F), 0x80 | (cc & 0x3F)); }
    }
    return 'b' + base64Encode(bytes);
  }
  function safeIconRead(raw) {
    if (!raw) return '🎯';
    // New format: 'b' + base64 of UTF-8 bytes (e.g. 'b8J+PoA==' → 🏠)
    if (raw.charAt(0) === 'b' && raw.length >= 5) {
      try { var d = base64DecodeUTF8(raw.slice(1)); if (d) return d; } catch(e) {}
    }
    // Old garbled format: U+FDD0-U+FDEF nonchar prefix + base64
    var firstCp = raw.charCodeAt(0);
    if (firstCp >= 0xFDD0 && firstCp <= 0xFDEF) {
      try {
        var b64 = raw.replace(/[^A-Za-z0-9+\/=]/g, '');
        if (b64.length >= 4) { var d = base64DecodeUTF8(b64); if (d) return d; }
      } catch(e) {}
      return '🎯';
    }
    // Old percent-encoded format (may be truncated — try anyway)
    if (raw.charAt(0) === '%') {
      try { return decodeURIComponent(raw); } catch(e) {}
    }
    // BMP emoji stored directly (charCode >= 0x0100)
    if (firstCp >= 0x0100) return raw;
    return raw || '🎯';
  }

  // ── GET /goals ────────────────────────────────────────────
  if (method === 'GET') {
    var gr = new GlideRecord('x_887486_0_savings_goal');
    gr.addQuery('user_profile', profileSysId);
    gr.orderBy('goal_name');
    gr.query();

    var results = [];
    while (gr.next()) {
      var target  = parseFloat(gr.getValue('target_amount'))  || 0;
      var current = parseFloat(gr.getValue('current_amount')) || 0;
      var accSysId = gr.getValue('account') || '';
      results.push({
        sys_id              : gr.getValue('sys_id')               || '',
        goal_name           : gr.getValue('goal_name')            || '',
        goal_icon           : safeIconRead(gr.getValue('goal_icon')),
        target_amount       : target,
        current_amount      : current,
        monthly_contribution: parseFloat(gr.getValue('monthly_contribution')) || 0,
        target_date         : gr.getValue('target_date')          || '',
        goal_status         : gr.getValue('goal_status')          || 'in_progress',
        remarks             : gr.getValue('remarks')              || '',
        progress_pct        : target > 0 ? Math.min((current / target) * 100, 100) : 0,
        account_sys_id      : accSysId,
        account_name        : accSysId ? gr.getDisplayValue('account') || '' : ''
      });
    }

    response.setStatus(200);
    response.setBody({ result: results, count: results.length });
    return;
  }

  // ── POST /goals ───────────────────────────────────────────
  // Body: { goal_name, goal_icon, target_amount, current_amount, monthly_contribution, target_date, remarks }
  if (method === 'POST') {
    var body = request.body ? request.body.data : {};

    if (!body.goal_name || !body.target_amount) {
      helper.errorResponse(response, 400, 'goal_name and target_amount are required');
      return;
    }

    var newGR = new GlideRecord('x_887486_0_savings_goal');
    newGR.initialize();
    newGR.user_profile          = profileSysId;
    newGR.goal_name             = body.goal_name;
    newGR.goal_icon             = safeIconWrite(body.goal_icon || '🎯');
    newGR.target_amount         = parseFloat(body.target_amount);
    newGR.current_amount        = parseFloat(body.current_amount)        || 0;
    newGR.monthly_contribution  = parseFloat(body.monthly_contribution)  || 0;
    newGR.target_date           = body.target_date           || '';
    newGR.remarks               = body.remarks               || '';
    newGR.goal_status           = parseFloat(body.current_amount) >= parseFloat(body.target_amount)
                                    ? 'achieved' : 'in_progress';

    // Link to an account if provided
    if (body.account_name) {
      var accGR = new GlideRecord('x_887486_0_account');
      accGR.addQuery('user_profile', profileSysId);
      accGR.addQuery('account_name', body.account_name);
      accGR.setLimit(1);
      accGR.query();
      if (accGR.next()) newGR.setValue('account', accGR.getUniqueValue());
    }

    var newSysId = newGR.insert();
    response.setStatus(201);
    response.setBody({ result: { sys_id: newSysId, status: 'created' } });
    return;
  }

  // ── PUT /goals ────────────────────────────────────────────
  // Body: { sys_id, goal_name, goal_icon, target_amount, current_amount, monthly_contribution, target_date, remarks }
  if (method === 'PUT') {
    var putBody = request.body ? request.body.data : {};
    if (!putBody.sys_id) {
      helper.errorResponse(response, 400, 'sys_id is required');
      return;
    }

    var editGR = new GlideRecord('x_887486_0_savings_goal');
    if (!editGR.get(putBody.sys_id) || editGR.getValue('user_profile') !== profileSysId) {
      helper.errorResponse(response, 404, 'Goal not found');
      return;
    }

    if (putBody.goal_name            !== undefined) editGR.goal_name            = putBody.goal_name;
    if (putBody.goal_icon            !== undefined) editGR.goal_icon            = safeIconWrite(putBody.goal_icon);
    if (putBody.target_amount        !== undefined) editGR.target_amount        = parseFloat(putBody.target_amount);
    if (putBody.current_amount       !== undefined) editGR.current_amount       = parseFloat(putBody.current_amount);
    if (putBody.monthly_contribution !== undefined) editGR.monthly_contribution = parseFloat(putBody.monthly_contribution);
    if (putBody.target_date          !== undefined) editGR.target_date          = putBody.target_date;
    if (putBody.remarks              !== undefined) editGR.remarks              = putBody.remarks;

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
  // Tunneled as HTTP POST + X-HTTP-Method: DELETE so body is accessible
  if (method === 'DELETE') {
    var delBody = request.body ? request.body.data : {};
    var delId = delBody.sys_id || '';
    if (!delId) {
      helper.errorResponse(response, 400, 'sys_id is required');
      return;
    }

    var delGR = new GlideRecord('x_887486_0_savings_goal');
    if (!delGR.get(delId) || delGR.getValue('user_profile') !== profileSysId) {
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
