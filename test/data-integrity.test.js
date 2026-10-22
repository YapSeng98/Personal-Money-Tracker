#!/usr/bin/env node
/*
 * Data integrity: transfer and asset pairs.
 *
 * Run:  node test/data-integrity.test.js
 *
 * A transfer or funded asset purchase is two rows sharing a transferGroup. The
 * list draws a healthy pair as one row (its outgoing leg). A pair that wasn't
 * healthy — no outgoing leg, after an edit switched one side's type — used to
 * vanish from the month list entirely while search still found one of its
 * rows. These tests hold the rules that stop that:
 *   1. pairProblems() names every way a pair can be broken.
 *   2. collapseTransfers() never drops a row of a broken pair, and draws a
 *      healthy pair exactly once — checked against thousands of random lists.
 *   3. fillTransferPeers() repairs the missing "other side" account and leaves
 *      broken pairs for the Data check.
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

const NAMES = ['pairProblems', 'brokenPairMap', 'collapseTransfers', 'isAssetGroup', 'fillTransferPeers'];
const state = { transactions: [], userId: null };
const updates = [];
const API = new Function('state', 'updates', `
  let _brokenPairs = null;
  const _snId = t => (typeof t.id === 'string' && t.id.length > 20 ? t.id : null);
  const saveState = () => {};
  const dbUpdate = (table, id, patch) => { updates.push({ table, id, patch }); return Promise.resolve(); };
  ${NAMES.map(extract).join('\n')}
  return { ${NAMES.join(', ')} };`)(state, updates);

let failed = 0, passed = 0;
function ok(cond, label, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`);
}
function group(name) { console.log('\n' + name); }

let seq = 0;
const leg = (o) => Object.assign({ id: 'row-' + (++seq), date: '2026-10-22', amount: 100, currency: 'SGD',
  description: 'Move', category: 'Transfer' }, o);
const shown = list => API.collapseTransfers(list);

group('pairProblems names every broken shape');
{
  const healthyT = [leg({ type: 'expense', account: 'DBS', transferGroup: 'tg_a', transferPeer: 'OCBC' }),
                    leg({ type: 'income',  account: 'OCBC', transferGroup: 'tg_a', transferPeer: 'DBS' })];
  const healthyA = [leg({ type: 'expense', account: 'CIMB', transferGroup: 'ag_b' }),
                    leg({ type: 'asset',   account: 'KenTrade', transferGroup: 'ag_b' })];
  const lone     = [leg({ type: 'income',  account: 'KenTrade', transferGroup: 'tg_c' })];
  const noOut    = [leg({ type: 'income',  account: 'KenTrade', transferGroup: 'tg_d' }),
                    leg({ type: 'asset',   account: 'KenTrade', transferGroup: 'tg_d' })];
  const twoOut   = [leg({ type: 'expense', account: 'CIMB', transferGroup: 'ag_e' }),
                    leg({ type: 'expense', account: 'KenTrade', transferGroup: 'ag_e' })];
  const same     = [leg({ type: 'expense', account: 'KenTrade', transferGroup: 'tg_f' }),
                    leg({ type: 'income',  account: 'KenTrade', transferGroup: 'tg_f' })];
  const three    = [leg({ type: 'expense', account: 'DBS', transferGroup: 'tg_g' }),
                    leg({ type: 'income',  account: 'OCBC', transferGroup: 'tg_g' }),
                    leg({ type: 'income',  account: 'UOB', transferGroup: 'tg_g' })];
  const all = [...healthyT, ...healthyA, ...lone, ...noOut, ...twoOut, ...same, ...three];
  const probs = API.pairProblems(all);
  const kind = g => (probs.find(p => p.group === g) || {}).kind;
  ok(!kind('tg_a') && !kind('ag_b'), 'healthy transfer and asset pairs are not flagged');
  ok(kind('tg_c') === 'lone', 'a lone leg is flagged', kind('tg_c'));
  ok(kind('tg_d') === 'types', 'a pair with no outgoing leg is flagged (the ghost from the bug report)', kind('tg_d'));
  ok(kind('ag_e') === 'types', 'a pair with two outgoing legs is flagged', kind('ag_e'));
  ok(kind('tg_f') === 'same', 'a pair on the same account is flagged', kind('tg_f'));
  ok(kind('tg_g') === 'many', 'three rows in one group are flagged', kind('tg_g'));
  ok(probs.every(p => p.why && p.legs.length), 'every problem says why and carries its rows');
}

group('collapseTransfers: healthy pairs once, broken pairs never hidden');
{
  state.transactions = [
    leg({ id: 'h1', type: 'expense', account: 'DBS', transferGroup: 'tg_h' }),
    leg({ id: 'h2', type: 'income', account: 'OCBC', transferGroup: 'tg_h' }),
    leg({ id: 'g1', type: 'income', account: 'KenTrade', transferGroup: 'tg_ghost' }),
    leg({ id: 'g2', type: 'asset', account: 'KenTrade', transferGroup: 'tg_ghost' }),
    leg({ id: 'p1', type: 'expense', account: 'DBS', description: 'Lunch' }),
  ];
  const ids = shown(state.transactions).map(t => t.id);
  ok(ids.includes('h1') && !ids.includes('h2'), 'a healthy pair shows its outgoing leg only', ids.join());
  ok(ids.includes('g1') && ids.includes('g2'), 'both rows of the ghost pair stay visible', ids.join());
  ok(ids.includes('p1'), 'an ordinary row is untouched');
  const searched = shown(state.transactions.filter(t => t.id === 'g1')).map(t => t.id);
  ok(searched.join() === 'g1', 'search, matching one ghost row, shows that row too: list and search agree');
}

group('Randomised: no list ever loses a row it should show (3,000 lists)');
{
  const types = ['expense', 'income', 'asset', 'payback'];
  const accts = ['DBS', 'OCBC', 'KenTrade', 'BingX'];
  let lost = 0, doubled = 0, example = '';
  for (let run = 0; run < 3000; run++) {
    const rows = [];
    const groups = 1 + Math.floor(Math.random() * 5);
    for (let g = 0; g < groups; g++) {
      const n = 1 + Math.floor(Math.random() * 3);
      const healthy = Math.random() < 0.5;
      for (let i = 0; i < (healthy ? 2 : n); i++) {
        const type = healthy ? (i === 0 ? 'expense' : (Math.random() < 0.5 ? 'income' : 'asset')) : types[Math.floor(Math.random() * types.length)];
        rows.push(leg({ type, account: healthy ? accts[i] : accts[Math.floor(Math.random() * accts.length)],
                        transferGroup: (Math.random() < 0.5 ? 'tg_' : 'ag_') + run + '_' + g }));
      }
    }
    for (let i = 0; i < 2; i++) rows.push(leg({ type: 'expense', account: 'DBS' }));
    state.transactions = rows;
    // Any subset of rows can be on screen (a month, a filter, a search).
    const view = rows.filter(() => Math.random() < 0.8);
    const out = shown(view);
    const broken = new Set(API.pairProblems(rows).map(p => p.group));
    const byGroup = {};
    view.forEach(t => { if (t.transferGroup) (byGroup[t.transferGroup] = byGroup[t.transferGroup] || []).push(t); });
    view.forEach(t => { if (!t.transferGroup && !out.includes(t)) lost++; });
    Object.entries(byGroup).forEach(([g, legs]) => {
      const drawn = out.filter(t => t.transferGroup === g).length;
      if (broken.has(g) && drawn !== legs.length) { lost++; example = example || `broken ${g}: ${legs.length} in view, ${drawn} drawn`; }
      if (!broken.has(g) && drawn === 0) { lost++; example = example || `healthy ${g} vanished`; }
      if (!broken.has(g) && legs.length === 2 && drawn !== 1) { doubled++; example = example || `healthy ${g} drawn ${drawn} times`; }
    });
  }
  ok(lost === 0, 'no row of a broken pair, and no healthy pair, is ever dropped', example);
  ok(doubled === 0, 'a healthy pair with both rows in view is always drawn exactly once', example);
}

group('fillTransferPeers repairs the missing "other side"');
{
  updates.length = 0;
  state.userId = 'u1';
  const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
  state.transactions = [
    leg({ id: uuid(1), type: 'expense', account: 'CIMB', transferGroup: 'ag_k', transferPeer: '' }),
    leg({ id: uuid(2), type: 'asset', account: 'KenTrade', transferGroup: 'ag_k' }),
    leg({ id: uuid(3), type: 'income', account: 'KenTrade', transferGroup: 'tg_bad' }),
  ];
  const fixed = API.fillTransferPeers();
  const [a, b, c] = state.transactions;
  ok(fixed === 2 && a.transferPeer === 'KenTrade' && b.transferPeer === 'CIMB', 'both sides of a healthy pair get their partner\'s account', `fixed ${fixed}`);
  ok(c.transferPeer === undefined, 'a broken pair is left for the Data check');
  ok(updates.length === 2 && updates.every(u => u.patch.transfer_peer), 'the server is told, one update per repaired row', JSON.stringify(updates));
  ok(API.fillTransferPeers() === 0, 'running it again changes nothing');
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} checks passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
