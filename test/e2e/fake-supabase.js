// A stand-in for supabase-js in the browser tests. Nothing touches the network:
// every query is recorded in window.__sb.calls, selects come back empty, and
// window.__sb.failWrites = true makes inserts, updates and deletes fail the way
// a dropped connection does — so the tests can prove nothing is lost.
(function () {
  const sb = window.__sb = { calls: [], failWrites: false };
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
        const fail = sb.failWrites && q.op !== 'select';
        const res = fail ? { data: null, error: { message: 'Failed to fetch' } }
                         : { data: q.op === 'select' ? [] : null, error: null };
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
