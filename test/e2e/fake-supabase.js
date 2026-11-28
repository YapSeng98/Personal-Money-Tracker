// A stand-in for supabase-js in the browser tests. Nothing touches the network.
//   window.__sb.calls       every query, in order
//   window.__sb.tables      rows the "server" holds, returned by selects
//                           (range() pages through them, maybeSingle() gives one)
//   window.__sb.failWrites  true: writes fail the way a dropped connection does
//   window.__sb.failWith    an error object: writes are refused with it, the way
//                           a database constraint refuses a row
//   window.__sb.without     { table: [column] }: columns a migration hasn't
//                           added yet (selects leave them out, writes naming
//                           them are refused as Postgres would)
//   window.__sb.apply       true: writes change the tables, checked the way
//                           Postgres checks them (the schema below, from
//                           supabase/migrations): an unknown column, a blank
//                           or malformed date, a non-uuid id, a missing
//                           required value or a duplicate id is refused with
//                           Postgres's own error code
(function () {
  const sb = window.__sb = { calls: [], failWrites: false, failWith: null, tables: {}, apply: false, without: {}, noTables: [] };
  // column: [type, required, default]
  const S = (o) => o;
  const SCHEMA = {
    transactions: S({ id: ['uuid', 1], user_id: ['uuid', 1], type: ['text', 1], amount: ['numeric', 1], description: ['text', 1, ''],
      category: ['text'], account: ['text'], date: ['date', 1], notes: ['text', 1, ''], currency: ['text', 1, 'SGD'],
      transfer_group: ['text'], transfer_peer: ['text'], is_recurring: ['bool', 1, false], recurring_frequency: ['text'],
      next_run_date: ['date'], created_at: ['ts', 1], recurring_source: ['uuid'],
      owed_by: ['text'], settles: ['uuid'], receipt_path: ['text'] }),   // migration 008
    accounts: S({ id: ['uuid', 1], user_id: ['uuid', 1], name: ['text', 1], type: ['text', 1, 'Checking'], institution: ['text', 1, ''],
      currency: ['text', 1, 'SGD'], starting_balance: ['numeric', 1, 0], is_active: ['bool', 1, true], icon: ['text', 1, ''], created_at: ['ts', 1],
      sort_order: ['int'] }),   // migration 007
    budgets: S({ id: ['uuid', 1], user_id: ['uuid', 1], category: ['text', 1], amount: ['numeric', 1], spent: ['numeric', 1, 0],
      alert_amount: ['numeric', 1, 0], currency: ['text', 1, 'SGD'], rollover: ['bool', 1, false], period_start: ['date'], period_end: ['date'], created_at: ['ts', 1] }),
    goals: S({ id: ['uuid', 1], user_id: ['uuid', 1], name: ['text', 1], icon: ['text', 1, '🎯'], target: ['numeric', 1], current: ['numeric', 1, 0],
      monthly: ['numeric', 1, 0], target_date: ['date'], remarks: ['text', 1, ''], currency: ['text', 1, 'SGD'], linked_account: ['text'], created_at: ['ts', 1] }),
    bills: S({ id: ['uuid', 1], user_id: ['uuid', 1], name: ['text', 1], amount: ['numeric', 1, 0], currency: ['text', 1, 'SGD'], category: ['text', 1, 'Bills'],
      account: ['text'], due_day: ['int', 1, 1], amount_varies: ['bool', 1, false], is_active: ['bool', 1, true], notes: ['text', 1, ''], created_at: ['ts', 1] }),
    backups: S({ id: ['uuid', 1], user_id: ['uuid', 1], taken_at: ['ts', 1], file_name: ['text', 1, ''], counts: ['json', 1, {}], device: ['text', 1, ''] }),
    preferences: S({ user_id: ['uuid', 1], currency: ['text', 1, 'SGD'], language: ['text', 1, 'en'], theme: ['text', 1, 'auto'], budget_alerts: ['bool', 1, true],
      now_assist: ['bool', 1, true], balances_masked: ['bool', 1, true], trend_months: ['int', 1, 6], trend_metric: ['text', 1, 'expense'], updated_at: ['ts', 1],
      display_name: ['text'], avatar_color: ['text'], monthly_income_target: ['numeric'], ai_api_key: ['text'], telegram_chat_id: ['text', 1, ''],
      notify_budget: ['bool', 1, false], notify_bills: ['bool', 1, false], bill_lead_days: ['int', 1, 3],
      saved_searches: ['json', 1, []] }),   // migration 008
    notes: S({ id: ['uuid', 1], user_id: ['uuid', 1], body: ['text', 1, ''], amount: ['numeric'], currency: ['text'], due_date: ['date'],
      kind: ['text'], account: ['text'], pinned: ['bool', 1, false], done_at: ['ts'], txn_id: ['uuid'], created_at: ['ts', 1] })   // migration 008
  };
  // The primary key, where it isn't "id".
  const KEY = { preferences: 'user_id' };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const err = (code, message) => ({ code, message });
  // The value as Postgres would store it, or an error.
  const hasCol = (table, col) => !!SCHEMA[table][col] && !((sb.without[table] || []).includes(col));
  function cell(table, col, v) {
    const def = hasCol(table, col) && SCHEMA[table][col];
    if (!def) return { e: err('PGRST204', `Could not find the '${col}' column of '${table}' in the schema cache`) };
    const [type, required] = def;
    if (v === null || v === undefined) return required ? { e: err('23502', `null value in column "${col}" of relation "${table}" violates not-null constraint`) } : { v: null };
    if (type === 'date') {
      const ok = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
      return ok ? { v } : { e: err('22007', `invalid input syntax for type date: "${v}"`) };
    }
    if (type === 'uuid') return UUID.test(String(v)) ? { v: String(v) } : { e: err('22P02', `invalid input syntax for type uuid: "${v}"`) };
    if (type === 'numeric' || type === 'int') {
      const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
      if (!Number.isFinite(n) || (type === 'int' && !Number.isInteger(n))) return { e: err('22P02', `invalid input syntax for type ${type === 'int' ? 'integer' : 'numeric'}: "${v}"`) };
      return { v: n };
    }
    if (type === 'bool') return typeof v === 'boolean' ? { v } : { e: err('22P02', `invalid input syntax for type boolean: "${v}"`) };
    if (type === 'text') return { v: String(v) };
    return { v };
  }
  function checked(table, patch, base) {
    const out = Object.assign({}, base || {});
    for (const [k, v] of Object.entries(patch)) {
      const c = cell(table, k, v);
      if (c.e) return { e: c.e };
      out[k] = c.v;
    }
    return { row: out };
  }
  function withDefaults(table, row) {
    const out = {};
    for (const [col, [, required, def]] of Object.entries(SCHEMA[table])) {
      if (!hasCol(table, col)) continue;
      if (col in row) out[col] = row[col];
      else if (SCHEMA[table][col][0] === 'ts') out[col] = new Date().toISOString();
      else if (def !== undefined) out[col] = def;
      else if (required) return { e: err('23502', `null value in column "${col}" of relation "${table}" violates not-null constraint`) };
      else out[col] = null;
    }
    return { row: out };
  }
  const matches = (row, filters) => filters.every(([k, a]) => k !== 'eq' || String(row[a[0]]) === String(a[1]));
  function write(q) {
    const table = q.table, rows = sb.tables[table] = sb.tables[table] || [];
    if (!SCHEMA[table]) return null;   // preferences and the like: accepted, not modelled
    if (q.op === 'insert' || q.op === 'upsert') {
      const list = Array.isArray(q.row) ? q.row : [q.row];
      const staged = [];
      for (const r of list) {
        const c = checked(table, r);
        if (c.e) return c.e;
        const key = KEY[table] || 'id';
        const i = rows.findIndex(x => String(x[key]) === String(c.row[key]));
        if (i >= 0 && q.op === 'insert') return err('23505', `duplicate key value violates unique constraint "${table}_pkey"`);
        if (i >= 0) { staged.push([i, Object.assign({}, rows[i], c.row)]); continue; }
        const d = withDefaults(table, c.row);
        if (d.e) return d.e;
        staged.push([-1, d.row]);
      }
      staged.forEach(([i, r]) => { if (i >= 0) rows[i] = r; else rows.push(r); });
      return null;
    }
    if (q.op === 'update') {
      const hit = rows.filter(r => matches(r, q.filters));
      for (const r of hit) {
        const c = checked(table, q.patch, r);
        if (c.e) return c.e;
        Object.assign(r, c.row);
      }
      return null;
    }
    if (q.op === 'delete') { sb.tables[table] = rows.filter(r => !matches(r, q.filters)); return null; }
    return null;
  }
  function query(table) {
    const q = { table, op: 'select', filters: [] };
    const target = {
      insert(row) { q.op = 'insert'; q.row = row; return api; },
      upsert(row) { q.op = 'upsert'; q.row = row; return api; },
      update(patch) { q.op = 'update'; q.patch = patch; return api; },
      delete() { q.op = 'delete'; return api; },
      select() { return api; },
      then(resolve, reject) {
        sb.calls.push(q);
        let res;
        if (sb.noTables.includes(table)) {
          // A table a migration hasn't made yet, as PostgREST says it.
          res = { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` } };
        } else if (q.op === 'select') {
          // As Postgres returns them: every column the table has, null where unset.
          let rows = (sb.tables[table] || []).map(r => {
            if (!sb.apply) return r;
            const out = Object.assign({}, r);
            if (SCHEMA[table]) Object.keys(SCHEMA[table]).forEach(c => { if (!hasCol(table, c)) delete out[c]; else if (!(c in out)) out[c] = null; });
            return out;
          });
          const range = q.filters.find(f => f[0] === 'range');
          if (range) rows = rows.slice(range[1][0], range[1][1] + 1);
          const one = q.filters.some(f => f[0] === 'maybeSingle' || f[0] === 'single');
          res = { data: one ? (rows[0] || null) : rows, error: null };
        } else if (sb.failWith) {
          res = { data: null, error: sb.failWith };
        } else if (sb.failWrites) {
          res = { data: null, error: { message: 'Failed to fetch', code: '' } };
        } else if (sb.apply) {
          res = { data: null, error: write(q) };
        } else {
          res = { data: null, error: null };
        }
        return Promise.resolve(res).then(resolve, reject);
      }
    };
    // Any filter (eq, order, range, in, …) is recorded and chains on.
    const api = new Proxy(target, {
      get: (t, k) => (k in t ? t[k] : (...args) => { q.filters.push([k, args]); return api; })
    });
    return api;
  }
  const auth = {
    getSession: async () => ({ data: { session: null } }),
    getUser: async () => ({ data: { user: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({ error: null }),
    signInWithPassword: async () => ({ data: {}, error: { message: 'No network in tests' } }),
    signUp: async () => ({ data: {}, error: { message: 'No network in tests' } }),
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    updateUser: async () => ({ data: {}, error: null })
  };
  // Storage: files kept in memory, per bucket. failWrites makes uploads fail too.
  sb.files = {};
  const storage = {
    from: bucket => ({
      upload: async (path, blob, opts) => {
        sb.calls.push({ table: 'storage:' + bucket, op: 'upload', path, opts });
        if (sb.failWrites) return { data: null, error: { message: 'Failed to fetch' } };
        if (sb.files[bucket + '/' + path] && !(opts && opts.upsert)) return { data: null, error: { message: 'The resource already exists' } };
        sb.files[bucket + '/' + path] = blob; return { data: { path }, error: null };
      },
      createSignedUrl: async (path, secs) => {
        sb.calls.push({ table: 'storage:' + bucket, op: 'sign', path, secs });
        return sb.files[bucket + '/' + path] ? { data: { signedUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }, error: null } : { data: null, error: { message: 'Object not found' } };
      },
      remove: async paths => { sb.calls.push({ table: 'storage:' + bucket, op: 'remove', paths }); paths.forEach(x => delete sb.files[bucket + '/' + x]); return { data: [], error: null }; }
    })
  };
  window.supabase = {
    createClient: () => ({
      from: query,
      storage,
      auth,
      functions: { invoke: async () => ({ data: null, error: null }) },
      rpc: async () => ({ data: null, error: null })
    })
  };
})();
