// A stand-in for supabase-js in the browser tests. Nothing touches the network.
//   window.__sb.calls       every query, in order
//   window.__sb.tables      rows the "server" holds, returned by selects
//                           (range() pages through them, maybeSingle() gives one)
//   window.__sb.failWrites  true: writes fail the way a dropped connection does
//   window.__sb.failWith    an error object: writes are refused with it, the way
//                           a database constraint refuses a row
(function () {
  const sb = window.__sb = { calls: [], failWrites: false, failWith: null, tables: {} };
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
        if (q.op === 'select') {
          let rows = (sb.tables[table] || []).slice();
          const range = q.filters.find(f => f[0] === 'range');
          if (range) rows = rows.slice(range[1][0], range[1][1] + 1);
          const one = q.filters.some(f => f[0] === 'maybeSingle' || f[0] === 'single');
          res = { data: one ? (rows[0] || null) : rows, error: null };
        } else if (sb.failWith) {
          res = { data: null, error: sb.failWith };
        } else if (sb.failWrites) {
          res = { data: null, error: { message: 'Failed to fetch', code: '' } };
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
  window.supabase = {
    createClient: () => ({
      from: query,
      auth,
      functions: { invoke: async () => ({ data: null, error: null }) },
      rpc: async () => ({ data: null, error: null })
    })
  };
})();
