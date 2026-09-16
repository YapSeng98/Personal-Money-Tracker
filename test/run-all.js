#!/usr/bin/env node
/*
 * Runs every PFMT test suite.
 *
 *   node test/run-all.js
 *
 * Each suite loads the real functions out of index.html rather than copies, so
 * a suite failing means the shipped page is wrong — not that a test is stale.
 */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
  'budget-invariants.test.js',   // the money maths every page depends on
  'bills-and-alerts.test.js',    // the bills checklist and the alert rules
  'pfmt-notify.test.mjs'         // the Edge Function itself, under a stubbed Deno
];

let bad = 0;
for (const s of SUITES) {
  console.log(`\n${'═'.repeat(66)}\n  ${s}\n${'═'.repeat(66)}`);
  const r = spawnSync(process.execPath, [path.join(__dirname, s)], { stdio: 'inherit' });
  if (r.status !== 0) bad++;
}
console.log(`\n${'═'.repeat(66)}`);
console.log(bad === 0 ? `ALL SUITES PASS (${SUITES.length})` : `${bad} of ${SUITES.length} SUITES FAILED`);
process.exit(bad === 0 ? 0 : 1);
