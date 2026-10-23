#!/usr/bin/env node
/*
 * The outbox: every write stays on the device until the server has it.
 *
 * Run:  node test/outbox.test.js
 *
 * Before it, a write that failed (offline, a weak signal, an expired login)
 * showed a toast and was then overwritten by the server's copy on the next
 * reload, and a delete made inside the undo window came back after a refresh.
 * These tests hold the rules that replaced that:
 *   1. Writes queue, fold together per row, and go out in order, once.
 *   2. A dropped connection keeps the queue and its order; a refusal the
 *      server means (a constraint, a missing column) moves aside for the user.
 *   3. A reload keeps every row with a change still on its way, and keeps
 *      deleted rows gone.
 *   4. A flush asked for while one is running is honoured, and a flush with
 *      nothing to do never blocks the next one (both were real bugs).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extract(name) {
  const m = HTML.match(new RegExp(`\\nfunction ${name}\\s*\\(`));
  if (!m) throw new Error(`could not find ${name}() in index.html`);
  const start = m.index + 1;
  let depth = 0;
  for (let i = HTML.indexOf('{', start); i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}' && --depth === 0) return HTML.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}()`);
}

// A scriptable server: each write takes the next planned answer ('ok' when
// the plan runs out), and every call is recorded.
const server = { calls: [], plan: [] };
function fakeClient() {
  return {
    from(table) {
      const call = { table };
      const answer = () => {
        server.calls.push(call);
        const next = server.plan.shift() || 'ok';
        if (next === 'ok') return { data: null, error: null };
        if (next === 'offline') return { data: null, error: { message: 'Failed to fetch', code: '' } };
        return { data: null, error: next };   // a refusal object
      };
      const done = () => ({ then: (res, rej) => Promise.resolve(answer()).then(res, rej) });
      return {
        upsert(row) { call.kind = 'upsert'; call.row = row; call.rows = Array.isArray(row) ? row : [row]; return done(); },
        update(patch) { call.kind = 'update'; call.patch = patch; return { eq(_, id) { call.id = id; return done(); } }; },
        delete() { call.kind = 'delete'; return { eq(_, id) { call.id = id; return done(); } }; }
      };
    }
  };
}

const NAMES = ['outbox', 'rejectedWrites', 'isPermanentDbError', 'enqueueWrite', 'flushOutbox', 'mergeWithOutbox', 'pendingRowIds'];
const state = { userId: 'me', outbox: [], outboxRejected: [] };
let n = 0;
const API = new Function('state', 'sb', `
  let _flushing = null, _flushAgain = false;
  const saveState = () => {};
  const renderSyncBadge = () => {};
  let __n = 0;
  const newId = () => 'op-' + (++__n);
  ${NAMES.map(extract).join('\n')}
  return { ${NAMES.join(', ')}, flushing: () => _flushing };`)(state, fakeClient());

let failed = 0, passed = 0;
function ok(cond, label, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`);
}
function group(name) { console.log('\n' + name); }
const reset = () => { state.outbox = []; state.outboxRejected = []; state.userId = 'me'; server.calls.length = 0; server.plan.length = 0; };
const kinds = () => state.outbox.map(o => o.kind + ':' + o.rowId).join(' ');

(async () => {
  group('Which refusals are permanent');
  ok(API.isPermanentDbError({ code: '23514' }), 'a check constraint is permanent');
  ok(API.isPermanentDbError({ code: '42703' }) && API.isPermanentDbError({ code: 'PGRST204' }), 'a missing column is permanent');
  ok(API.isPermanentDbError({ code: '42501' }), 'a row-level-security refusal is permanent');
  ok(!API.isPermanentDbError({ code: 'PGRST301' }), 'an expired login is retried');
  ok(!API.isPermanentDbError({ message: 'Failed to fetch', code: '' }), 'a dropped connection is retried');
  ok(!API.isPermanentDbError(new TypeError('Load failed')), 'a thrown network error is retried');

  group('Queueing folds writes together per row');
  reset();
  API.enqueueWrite('transactions', 'upsert', 'r1', { id: 'r1', amount: 1, description: 'Lunch' });
  API.enqueueWrite('transactions', 'update', 'r1', { amount: 2 });
  ok(state.outbox.length === 1 && state.outbox[0].kind === 'upsert' && state.outbox[0].payload.amount === 2 && state.outbox[0].payload.description === 'Lunch',
     'an edit to a row not yet sent folds into its insert', JSON.stringify(state.outbox));
  API.enqueueWrite('transactions', 'update', 'r2', { amount: 5 });
  API.enqueueWrite('transactions', 'update', 'r2', { notes: 'x' });
  ok(state.outbox.length === 2 && state.outbox[1].payload.amount === 5 && state.outbox[1].payload.notes === 'x', 'two edits to one row become one');
  API.enqueueWrite('transactions', 'delete', 'r1');
  ok(kinds() === 'update:r2 delete:r1', 'a delete replaces what was queued for its row', kinds());
  API.enqueueWrite('transactions', 'update', 'r3', { amount: 1 });
  API.enqueueWrite('transactions', 'delete', 'r3', null, Date.now() + 6000);
  ok(kinds() === 'update:r2 delete:r1 update:r3 delete:r3', 'a delete still inside its undo window leaves earlier writes alone', kinds());
  API.enqueueWrite('budgets', 'update', 'r2', { amount: 9 });
  ok(state.outbox.length === 5, 'the same id in another table is a different row');

  group('Flushing: in order, once, and only what is due');
  reset();
  API.enqueueWrite('transactions', 'upsert', 'a', { id: 'a' });
  API.enqueueWrite('transactions', 'update', 'b', { amount: 1 });
  API.enqueueWrite('transactions', 'delete', 'c', null, Date.now() + 60000);
  await API.flushOutbox();
  ok(server.calls.map(c => c.kind + ':' + (c.id || c.row.id)).join() === 'upsert:a,update:b', 'due writes go out in order', JSON.stringify(server.calls));
  ok(kinds() === 'delete:c', 'a delete inside its undo window waits', kinds());
  state.outbox[0].notBefore = 0;
  await API.flushOutbox();
  ok(server.calls.length === 3 && state.outbox.length === 0, 'and goes once the window has passed');

  group('A dropped connection keeps the queue and its order');
  reset();
  API.enqueueWrite('transactions', 'upsert', 'a', { id: 'a' });
  API.enqueueWrite('transactions', 'upsert', 'b', { id: 'b' });
  server.plan.push('offline');
  await API.flushOutbox();
  ok(server.calls.length === 1 && kinds() === 'upsert:a upsert:b' && state.outbox[0].tries === 1, 'it stops at the first failure and keeps everything', kinds());
  await API.flushOutbox();
  ok(server.calls.length === 2 && server.calls[1].rows.map(r => r.id).join() === 'a,b' && state.outbox.length === 0, 'the next attempt sends both, in order');

  group('A refusal moves aside; the rest carries on');
  reset();
  API.enqueueWrite('transactions', 'upsert', 'bad', { id: 'bad', currency: 'XYZ' });
  API.enqueueWrite('transactions', 'upsert', 'good', { id: 'good' });
  server.plan.push({ code: '23514', message: 'violates check constraint' }, { code: '23514', message: 'violates check constraint' });
  await API.flushOutbox();
  ok(state.outboxRejected.length === 1 && state.outboxRejected[0].rowId === 'bad' && /check constraint/.test(state.outboxRejected[0].lastError),
     'the refused write is kept, with the reason', JSON.stringify(state.outboxRejected));
  ok(state.outbox.length === 0 && server.calls.length === 3, 'a batch refused for one row is resent row by row, so the good row still goes', server.calls.length);

  group('Batching: runs of inserts go in one request');
  reset();
  for (let i = 0; i < 250; i++) API.enqueueWrite('transactions', 'upsert', 'imp' + i, { id: 'imp' + i });
  await API.flushOutbox();
  ok(server.calls.length === 3 && server.calls.map(c => c.rows.length).join() === '100,100,50' && state.outbox.length === 0,
     '250 new rows go in three requests of at most 100', server.calls.map(c => c.rows.length).join());
  ok(server.calls.flatMap(c => c.rows.map(r => r.id)).join() === Array.from({ length: 250 }, (_, i) => 'imp' + i).join(), 'in their original order, each once');
  reset();
  API.enqueueWrite('transactions', 'upsert', 'p', { id: 'p' });
  API.enqueueWrite('transactions', 'update', 'q', { amount: 1 });
  API.enqueueWrite('transactions', 'upsert', 'r', { id: 'r' });
  API.enqueueWrite('budgets', 'upsert', 's', { id: 's' });
  await API.flushOutbox();
  ok(server.calls.map(c => c.kind + ':' + c.table).join() === 'upsert:transactions,update:transactions,upsert:transactions,upsert:budgets',
     'a batch never jumps another write or mixes tables', server.calls.map(c => c.kind + ':' + c.table).join());

  group('Another account\'s writes stay put');
  reset();
  API.enqueueWrite('transactions', 'upsert', 'mine', { id: 'mine' });
  state.userId = 'someone-else';
  API.enqueueWrite('transactions', 'upsert', 'theirs', { id: 'theirs' });
  state.userId = 'me';
  await API.flushOutbox();
  ok(server.calls.length === 1 && state.outbox.length === 1 && state.outbox[0].rowId === 'theirs', 'only the signed-in account\'s writes are sent');
  state.userId = null;
  await API.flushOutbox();
  ok(server.calls.length === 1, 'nothing is sent while signed out');

  group('Concurrency');
  reset();
  API.enqueueWrite('transactions', 'upsert', 'x', { id: 'x' });
  const p1 = API.flushOutbox(), p2 = API.flushOutbox();
  await Promise.all([p1, p2]);
  ok(server.calls.length === 1, 'two flushes at once send a write once');
  reset();
  await API.flushOutbox();                       // nothing to do
  API.enqueueWrite('transactions', 'upsert', 'y', { id: 'y' });
  await API.flushOutbox();
  ok(server.calls.length === 1 && state.outbox.length === 0, 'a flush with nothing to do never blocks the next one (regression)');
  reset();
  API.enqueueWrite('transactions', 'upsert', 'z', { id: 'z' });
  server.plan.push('offline');
  const running = API.flushOutbox();             // will fail
  const again = API.flushOutbox();               // asked while it runs: back online
  await running; await again;
  ok(server.calls.length === 2 && state.outbox.length === 0, 'a flush asked for mid-run runs again once that run ends (regression)', `${server.calls.length} calls`);
  const lastAmount = id => { const c = server.calls.filter(x => (x.id || (x.row && x.row.id)) === id).pop(); return c && (c.patch || c.row).amount; };
  reset();
  API.enqueueWrite('transactions', 'upsert', 'w', { id: 'w', amount: 1 });
  const early = API.flushOutbox();
  API.enqueueWrite('transactions', 'update', 'w', { amount: 2 });   // edited before the insert went out
  await early; await API.flushOutbox();
  ok(lastAmount('w') === 2 && state.outbox.length === 0, 'an edit made before its insert goes out is folded in, not lost', JSON.stringify(server.calls));
  reset();
  API.enqueueWrite('transactions', 'upsert', 'v', { id: 'v', amount: 1 });
  const flying = API.flushOutbox();
  for (let spin = 0; spin < 1000 && !(state.outbox[0] && state.outbox[0].sending); spin++) await Promise.resolve();
  API.enqueueWrite('transactions', 'update', 'v', { amount: 3 });   // edited while the insert is in flight
  await flying; await API.flushOutbox();
  ok(server.calls.length === 2 && lastAmount('v') === 3 && state.outbox.length === 0, 'an edit made while its insert is in flight goes after it, not lost',
     JSON.stringify(server.calls));

  group('A reload keeps what hasn\'t landed');
  reset();
  const serverRows = [{ id: 's1', amount: 1 }, { id: 's2', amount: 2 }, { id: 's3', amount: 3 }];
  ok(API.mergeWithOutbox('transactions', serverRows, []) === serverRows, 'with nothing queued, the server copy is used as is');
  API.enqueueWrite('transactions', 'upsert', 'new', { id: 'new' });
  API.enqueueWrite('transactions', 'update', 's2', { amount: 20 });
  API.enqueueWrite('transactions', 'delete', 's3', null, Date.now() + 6000);
  state.outboxRejected.push({ table: 'transactions', kind: 'update', rowId: 's1', userId: 'me' });
  const local = [{ id: 'new', amount: 7 }, { id: 's1', amount: 10 }, { id: 's2', amount: 20 }, { id: 's3', amount: 3 }];
  const merged = API.mergeWithOutbox('transactions', serverRows, local);
  const byId = Object.fromEntries(merged.map(r => [r.id, r.amount]));
  ok(byId.new === 7, 'a row the server has never seen is kept');
  ok(byId.s2 === 20, 'an edit still on its way wins over the server copy');
  ok(!('s3' in byId), 'a row queued for deletion stays gone, even inside the undo window');
  ok(byId.s1 === 10, 'a refused edit stays on screen until the user decides');
  state.userId = 'someone-else';
  ok(API.mergeWithOutbox('transactions', serverRows, local) === serverRows, 'another account\'s queue changes nothing');
  state.userId = 'me';
  ok(API.pendingRowIds('transactions').has('s2') && !API.pendingRowIds('transactions').has('s1'), 'pendingRowIds lists rows still on their way');

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} checks passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
