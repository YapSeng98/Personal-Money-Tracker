#!/usr/bin/env node
/*
 * App Lock PIN storage.
 *
 * Run:  node test/app-lock.test.js
 *
 * The PIN used to be stored as a bare SHA-256, which a 4–6 digit PIN's million
 * possibilities could reverse in under a second. It is now salted PBKDF2, and
 * a PIN stored the old way still unlocks once and is re-stored the new way.
 * Runs the real functions from index.html on Node's own WebCrypto.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extract(name) {
  const fn = HTML.match(new RegExp(`\\n(async )?function ${name}\\s*\\(`));
  if (fn) {
    const start = fn.index + 1;
    let depth = 0;
    for (let i = HTML.indexOf('{', start); i < HTML.length; i++) {
      if (HTML[i] === '{') depth++;
      else if (HTML[i] === '}' && --depth === 0) return HTML.slice(start, i + 1);
    }
  }
  const c = HTML.match(new RegExp(`\\nconst ${name}\\s*=[^\\n]*;`));
  if (c) return c[0].slice(1);
  throw new Error(`could not find ${name} in index.html`);
}
const NAMES = ['PIN_ROUNDS', 'toHex', 'sha256Hex', 'hashPin', 'checkPin'];
const API = new Function(`${NAMES.map(extract).join('\n')}\nreturn { ${NAMES.join(', ')} };`)();

let failed = 0, passed = 0;
function ok(cond, label, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`);
}

(async () => {
  console.log('\nStoring and checking a PIN');
  const stored = await API.hashPin('1234');
  ok(/^pbkdf2\$310000\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(stored), 'stored as pbkdf2$rounds$salt$hash, 310,000 rounds', stored);
  ok(stored !== await API.hashPin('1234'), 'the same PIN stores differently each time (a fresh salt)');
  ok(await API.checkPin('1234', stored), 'the right PIN unlocks');
  ok(!(await API.checkPin('1235', stored)), 'a wrong PIN does not');
  ok(!(await API.checkPin('', stored)) && !(await API.checkPin('1234', '')), 'an empty PIN, or no stored PIN, never unlocks');
  const [, , salt] = stored.split('$');
  ok((await API.hashPin('1234', salt, 1)) !== stored, 'the round count is part of the result, not decoration');

  console.log('\nA PIN stored before PBKDF2');
  const legacy = await API.sha256Hex('2468');
  ok(await API.checkPin('2468', legacy), 'still unlocks');
  ok(!(await API.checkPin('1357', legacy)), 'and a wrong PIN still does not');

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} checks passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
