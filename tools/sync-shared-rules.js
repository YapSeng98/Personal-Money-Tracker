#!/usr/bin/env node
/*
 * Copies the PFMT SHARED MONEY RULES block out of index.html and into the
 * pfmt-notify Edge Function, so the two never drift by hand.
 *
 *   node tools/sync-shared-rules.js          # write
 *   node tools/sync-shared-rules.js --check  # exit 1 if out of date
 *
 * index.html is the source of truth: it is the file people actually edit when
 * they change how money is counted. The Edge Function needs the same answers
 * while nobody has the page open, and a second hand-maintained copy is exactly
 * how the Analytics trend came to disagree with the dashboard.
 *
 * test/bills-and-alerts.test.js runs the --check form, so a forgotten sync
 * fails the tests rather than shipping quietly.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT  = path.join(__dirname, '..');
const HTML  = path.join(ROOT, 'index.html');
const FN    = path.join(ROOT, 'supabase', 'functions', 'pfmt-notify', 'shared-money-rules.js');
const BEGIN = 'PFMT SHARED MONEY RULES — v1 — BEGIN';
const END   = 'PFMT SHARED MONEY RULES — v1 — END';

// Everything strictly between the end of the BEGIN line and the start of the
// line carrying END.
function sliceBlock(src, file) {
  const b = src.indexOf(BEGIN);
  const e = src.indexOf(END);
  if (b === -1 || e === -1) throw new Error(`markers not found in ${file}`);
  const from = src.indexOf('\n', b) + 1;
  const to   = src.lastIndexOf('\n', e) + 1;
  if (to <= from) throw new Error(`empty block in ${file}`);
  return { text: src.slice(from, to), from, to };
}

const html = fs.readFileSync(HTML, 'utf8');
const fn   = fs.readFileSync(FN, 'utf8');
const want = sliceBlock(html, 'index.html').text;
const have = sliceBlock(fn, 'pfmt-notify/shared-money-rules.js');

if (want === have.text) {
  console.log('shared money rules: in sync');
  process.exit(0);
}
if (process.argv.includes('--check')) {
  console.error('shared money rules: OUT OF SYNC — run `node tools/sync-shared-rules.js`');
  process.exit(1);
}
fs.writeFileSync(FN, fn.slice(0, have.from) + want + fn.slice(have.to));
console.log(`shared money rules: copied ${want.split('\n').length - 1} lines into pfmt-notify/shared-money-rules.js`);
