#!/usr/bin/env node
/*
 * Description suggestions in the transaction form.
 *
 * Run:  node test/descriptions.test.js
 *       PFMT_BACKUP=~/PFMT_Backups/<date> node test/descriptions.test.js
 *         (also replays every book in a real backup in date order: for each
 *          row, would the description you wrote have been offered after one,
 *          two or three letters, from what came before it?)
 *
 * Loads the REAL buildDescIndex(), suggestDescriptions() and the rest out of
 * index.html and checks what is offered, in what order, and what picking one
 * fills in — on hand-made rows and on random books.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extract(name) {
  for (const p of [new RegExp(`\\nfunction ${name}\\s*\\(`), new RegExp(`\\nconst ${name}\\s*=`)]) {
    const m = HTML.match(p);
    if (!m) continue;
    const start = m.index + 1;
    const line = HTML.slice(start, HTML.indexOf('\n', start));
    if (line.startsWith('const ') && /;\s*$/.test(line)) return line;
    const brace = HTML.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < HTML.length; i++) {
      if (HTML[i] === '{') depth++;
      else if (HTML[i] === '}' && --depth === 0) return HTML.slice(start, i + 1);
    }
  }
  throw new Error(`could not find ${name} in index.html`);
}
const NAMES = ['legsByGroup', 'transferPartner', 'isAssetGroup', 'descKind', 'descWords', 'buildDescIndex', 'oneEditApart',
  'suggestDescriptions', 'descMarked', 'descMeta', 'esc', 'fmtWithCur', 'CUR_SYM', 'catIcon'];
const state = { currency: 'SGD', transactions: [] };
const src = 'let _legIndex = null, _legIndexOf = null, _legIndexLen = -1, _legIndexVer = -1, _txnVersion = 0;\n' + NAMES.map(extract).join('\n');
const API = new Function('state', src + `; return {${NAMES.join(',')}};`)(state);

let failed = 0, passed = 0;
const shown = new Set();
function ok(cond, label, detail) {
  if (cond) { passed++; return; }
  failed++;
  if (shown.has(label)) return;
  shown.add(label);
  console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`);
}
const group = name => console.log('\n' + name);
const TODAY = '2026-11-14';
let id = 0;
const row = (date, type, description, category, extra) =>
  Object.assign({ id: ++id, date, type, description, category, amount: 10, currency: 'SGD', account: 'DBS', created: `${date} 09:00:00` }, extra || {});
// legsByGroup() caches on the list itself, so each new list is read afresh.
const book = rows => { state.transactions = rows; return API.buildDescIndex(rows, TODAY); };
const texts = (index, kind, typed, limit = 5) => API.suggestDescriptions(index, kind, typed, limit).map(e => e.text);

group('One suggestion per description, under its latest spelling');
{
  const ix = book([
    row('2026-09-01', 'expense', 'Tea break', 'Food & Drink'),
    row('2026-10-01', 'expense', 'Tea  Break ', 'Food & Drink'),
    row('2026-11-01', 'expense', 'Tea Break', 'Food & Drink'),
    row('2026-11-02', 'expense', '', 'Other'),
    row('2026-11-02', 'expense', '   ', 'Other'),
    row('2026-11-02', 'expense', '(no description)', 'Other')]);
  ok(ix.length === 1, 'case and spacing do not make a second suggestion; blank and placeholder rows make none', JSON.stringify(ix.map(e => e.text)));
  ok(ix[0].text === 'Tea Break' && ix[0].uses === 3, 'it shows the latest spelling and counts every use', JSON.stringify(ix[0]));
  const same = book([row('2026-11-01', 'expense', 'Lunch', 'Food & Drink', { created: '2026-11-01 12:00:00' }),
                     row('2026-11-01', 'expense', 'LUNCH', 'Food & Drink', { created: '2026-11-01 08:00:00' })]);
  ok(same[0].text === 'Lunch', 'on the same day, the one entered later is the latest', same[0].text);
}

group('Only the same kind of row');
{
  const ix = book([
    row('2026-11-01', 'expense', 'Lunch', 'Food & Drink'),
    row('2026-11-01', 'income', 'Lunch money from mum', 'Other'),
    row('2026-11-01', 'payback', 'Lunch split', 'Food & Drink'),
    row('2026-11-01', 'expense', 'Transfer money from UOB to DBS', 'Transfer', { account: 'UOB', transferGroup: 'tg_1' }),
    row('2026-11-01', 'income', 'Transfer money from UOB to DBS', 'Transfer', { account: 'DBS', transferGroup: 'tg_1' }),
    row('2026-11-02', 'expense', 'Buy gold', 'Investment', { account: 'DBS', transferGroup: 'ag_1' }),
    row('2026-11-02', 'asset', 'Buy gold', 'Gold', { account: 'Gold Vault', transferGroup: 'ag_1' }),
    row('2026-11-03', 'asset', 'Old watch', 'Other', { account: 'Valuables' }),
    row('2026-11-04', 'transfer', 'Old style transfer', 'Transfer')]);
  ok(texts(ix, 'expense', 'l').join() === 'Lunch', 'spending suggests spending only', texts(ix, 'expense', 'l').join());
  ok(texts(ix, 'income', 'l').join() === 'Lunch money from mum', 'income suggests income only');
  ok(texts(ix, 'payback', 'l').join() === 'Lunch split', 'a payback suggests paybacks only');
  ok(texts(ix, 'transfer', '').join() === 'Old style transfer,Transfer money from UOB to DBS', 'a transfer is offered once, plus old-style transfer rows (the later one first)', texts(ix, 'transfer', '').join());
  ok(!texts(ix, 'expense', 'transfer').length && !texts(ix, 'income', 'transfer').length, 'neither side of a transfer is offered as spending or income');
  ok(texts(ix, 'asset', '').sort().join() === 'Buy gold,Old watch', 'a purchase is offered once, by its holding; a holding with no funding too', texts(ix, 'asset', '').join());
  ok(!texts(ix, 'expense', 'buy').length, 'the funding side of a purchase is not offered as spending');
  const tr = ix.find(e => e.kind === 'transfer' && e.text.startsWith('Transfer'));
  ok(tr.account === 'UOB' && tr.other === 'DBS', 'a transfer carries both accounts', JSON.stringify(tr));
  const gold = ix.find(e => e.text === 'Buy gold');
  ok(gold.account === 'Gold Vault' && gold.other === 'DBS' && gold.category === 'Gold', 'a purchase carries the holding, the account it was paid from, and its category', JSON.stringify(gold));
  const watch = ix.find(e => e.text === 'Old watch');
  ok(watch.other === '', 'a holding with no funding has nothing to fill the funding from');
  // An old pair with no prefix on its group is still read as a purchase.
  const old = book([row('2026-11-01', 'expense', 'Shares', 'Investment', { transferGroup: 'g9' }),
                    row('2026-11-01', 'asset', 'Shares', 'Investment', { account: 'Broker', transferGroup: 'g9' })]);
  ok(old.length === 1 && old[0].kind === 'asset' && old[0].account === 'Broker', 'an unprefixed old pair with a holding is a purchase', JSON.stringify(old));
}

group('The category it usually had');
{
  const rows = [];
  for (let i = 0; i < 84; i++) rows.push(row(`2026-${String(1 + (i % 10)).padStart(2, '0')}-0${1 + (i % 9)}`, 'expense', 'Daily transport', 'Transport'));
  rows.push(row('2026-11-10', 'expense', 'Daily transport', 'Food & Drink'), row('2026-11-11', 'expense', 'Daily transport', 'Health'));
  let ix = book(rows);
  ok(ix[0].category === 'Transport', 'the usual one wins over one-off slips, even recent ones', ix[0].category);
  ix = book([row('2024-01-01', 'expense', 'Grab', 'Transport'), row('2024-02-01', 'expense', 'Grab', 'Transport'), row('2024-03-01', 'expense', 'Grab', 'Transport'),
             row('2026-10-01', 'expense', 'Grab', 'Food & Drink'), row('2026-11-01', 'expense', 'Grab', 'Food & Drink')]);
  ok(ix[0].category === 'Food & Drink', 'a change of habit wins: recent uses count for more than old ones', ix[0].category);
  ix = book([row('2026-11-01', 'expense', 'Dinner', 'Food & Drink'), row('2026-11-01', 'expense', 'Dinner', 'Entertainment', { created: '2026-11-01 20:00:00' })]);
  ok(ix[0].category === 'Entertainment', 'a tie goes to the latest', ix[0].category);
  ix = book([row('2026-11-01', 'expense', 'Mystery', '')]);
  ok(ix[0].category === '' && API.descMeta(ix[0]) === 'S$10.00', 'no category: nothing to fill, and none shown', API.descMeta(ix[0]));
  ix = book([row('2026-11-01', 'expense', 'Lunch', 'Food & Drink', { amount: 12.5 })]);
  ok(API.descMeta(ix[0]) === '🍜 Food & Drink · S$12.50', 'the line under it: category and the last amount', API.descMeta(ix[0]));
  ix = book([row('2026-11-01', 'expense', 'Wise top up', 'Transfer', { account: 'DBS', amount: 500, transferGroup: 'tg_w' }),
             row('2026-11-01', 'income', 'Wise top up', 'Transfer', { account: 'Wise USD', currency: 'USD', amount: 370, transferGroup: 'tg_w' })]);
  ok(API.descMeta(ix[0]) === 'DBS → Wise USD · S$500.00', 'a transfer shows where from and to, and what was sent', API.descMeta(ix[0]));
}

group('Matching what was typed');
{
  const ix = book([
    row('2026-11-01', 'expense', 'Lunch', 'Food & Drink'),
    row('2026-11-01', 'expense', 'Dinner with family', 'Food & Drink'),
    row('2026-11-01', 'expense', 'Daily transport', 'Transport'),
    row('2026-11-01', 'expense', 'Bishan to Orchard (Grab)', 'Transport'),
    row('2026-11-01', 'expense', 'Starbucks', 'Food & Drink'),
    row('2026-11-01', 'expense', '大戏院戏票 🎫', 'Entertainment'),
    row('2026-11-01', 'expense', 'Payback money from 同事', 'Other'),
    row('2026-11-01', 'expense', 'lily 姐 birthday', 'Other'),
    row('2026-11-01', 'expense', 'Phone instalment (CC)', 'Shopping')]);
  ok(texts(ix, 'expense', 'lu').join() === 'Lunch', 'the start of a description', texts(ix, 'expense', 'lu').join());
  ok(texts(ix, 'expense', 'LUN').join() === 'Lunch', 'whatever the case');
  ok(texts(ix, 'expense', '  dinner   with ').join() === 'Dinner with family', 'extra spaces typed are ignored');
  ok(texts(ix, 'expense', 'fam').join() === 'Dinner with family', 'the start of a later word');
  ok(texts(ix, 'expense', 'grab').join() === 'Bishan to Orchard (Grab)', 'a word in brackets');
  ok(texts(ix, 'expense', 'orch bish').join() === 'Bishan to Orchard (Grab)', 'words in any order');
  ok(texts(ix, 'expense', 'ransp').join() === 'Daily transport', 'the middle of a word, last');
  ok(texts(ix, 'expense', '戏院').join() === '大戏院戏票 🎫', 'Chinese, from anywhere in it');
  ok(texts(ix, 'expense', '同事').join() === 'Payback money from 同事', 'Chinese after English words');
  ok(texts(ix, 'expense', '姐').join() === 'lily 姐 birthday', 'a single Chinese character');
  ok(texts(ix, 'expense', '(cc)').join() === 'Phone instalment (CC)', 'punctuation typed matches punctuation');
  ok(texts(ix, 'expense', 'satrbucks').join() === 'Starbucks', 'one swapped pair of letters');
  ok(texts(ix, 'expense', 'starbcks').join() === 'Starbucks', 'one missing letter');
  ok(texts(ix, 'expense', 'staarbucks').join() === 'Starbucks', 'one extra letter');
  ok(texts(ix, 'expense', 'stxrb').join() === 'Starbucks', 'one wrong letter, partway through');
  ok(!texts(ix, 'expense', 'sxxrbucks').length, 'two typos are too many');
  ok(!texts(ix, 'expense', 'lxn').length, 'short words get no typo allowance (too many false matches)');
  ok(!texts(ix, 'expense', 'zzz').length, 'nothing like it: nothing offered');
  ok(texts(ix, 'income', 'lu').length === 0, 'and nothing from another kind of row');
}

group('Order: the best match, then the most used lately');
{
  const many = (n, date, desc, cat) => Array.from({ length: n }, () => row(date, 'expense', desc, cat));
  const ix = book([
    ...many(3, '2026-11-01', 'Tea break', 'Food & Drink'),
    ...many(9, '2026-11-01', 'Taxi', 'Transport'),
    ...many(40, '2024-01-01', 'Tuition', 'Education'),
    ...many(1, '2026-11-10', 'Ten dollar shop', 'Shopping'),
    ...many(20, '2026-11-01', 'Monthly tax', 'Bills'),
    ...many(30, '2026-11-01', 'Pasta', 'Food & Drink')]);
  ok(texts(ix, 'expense', 't').join() === 'Taxi,Tea break,Ten dollar shop,Tuition,Monthly tax',
     'starts-with before a later word; within that, recent heavy use first, 40 uses two years ago sink', texts(ix, 'expense', 't').join());
  ok(texts(ix, 'expense', 'ta').join() === 'Taxi,Monthly tax,Pasta', 'then later words, then the middle of a word, however much more it is used', texts(ix, 'expense', 'ta').join());
  ok(texts(ix, 'expense', '', 3).join() === 'Pasta,Monthly tax,Taxi', 'nothing typed: the most used lately', texts(ix, 'expense', '', 3).join());
  ok(texts(ix, 'expense', 't', 2).length === 2, 'never more than asked for');
  // Same weight, same match: latest first, then A–Z, so the order never wobbles.
  const tie = book([row('2026-11-01', 'expense', 'Beta', 'Other'), row('2026-11-01', 'expense', 'Alpha', 'Other'),
                    row('2026-11-01', 'expense', 'Gamma', 'Other', { created: '2026-11-01 10:00:00' })]);
  ok(texts(tie, 'expense', '').join() === 'Gamma,Alpha,Beta', 'ties: latest first, then A to Z', texts(tie, 'expense', '').join());
  const future = book([row('2027-01-01', 'expense', 'Insurance renewal', 'Bills'), row('2026-11-01', 'expense', 'Ice cream', 'Food & Drink')]);
  ok(future.every(e => Number.isFinite(e.weight) && e.weight > 0), 'a row dated in the future counts as now, not as more than now', JSON.stringify(future.map(e => e.weight)));
  const bad = book([row('not a date', 'expense', 'Broken date', 'Other')]);
  ok(bad.length === 1 && bad[0].weight === 0, 'a row with no usable date is still offered, last', JSON.stringify(bad));
}

group('Bold on what was typed');
{
  ok(API.descMarked('Daily transport', 'tra') === 'Daily <b>tra</b>nsport', 'the run it matched', API.descMarked('Daily transport', 'tra'));
  ok(API.descMarked('Bishan to Orchard Road', 'orc bis') === '<b>Bis</b>han to <b>Orc</b>hard Road', 'the start of each word it matched', API.descMarked('Bishan to Orchard Road', 'orc bis'));
  ok(API.descMarked('<b>Tom & Jerry</b>', 'tom') === '&lt;b&gt;<b>Tom</b> &amp; Jerry&lt;/b&gt;', 'what was written is shown as text, never as markup', API.descMarked('<b>Tom & Jerry</b>', 'tom'));
  ok(API.descMarked('Starbucks', 'satrbucks') === 'Starbucks', 'a typo match: nothing marked, nothing broken');
  ok(API.descMarked('大戏院戏票 🎫', '戏院') === '大<b>戏院</b>戏票 🎫', 'Chinese, and the emoji survives', API.descMarked('大戏院戏票 🎫', '戏院'));
  ok(API.descMarked('Lunch', '') === 'Lunch', 'nothing typed, nothing marked');
}

group('One typo, exactly');
{
  const A = API.oneEditApart;
  ok(A('lunch', 'lunch') && A('lunch', 'lunsh') && A('lunch', 'luch') && A('lunch', 'luncch') && A('lunch', 'lucnh') && A('', 'a') && A('a', ''), 'same, wrong, missing, extra, swapped');
  ok(!A('lunch', 'lnuhc') && !A('lunch', 'lu') && !A('ab', 'abcd') && !A('abcd', 'badc') && !A('abc', 'cab'), 'two edits apart are refused');
  // Against a reference edit distance (optimal string alignment) on random pairs.
  let seed = 7;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const word = () => Array.from({ length: Math.floor(rnd() * 6) }, () => 'abc'[Math.floor(rnd() * 3)]).join('');
  const osa = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i || j ? (i ? (j ? 0 : i) : j) : 0));
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[a.length][b.length];
  };
  for (let k = 0; k < 20000; k++) {
    const a = word(), b = rnd() < 0.5 ? word() : a.slice(0, Math.floor(rnd() * (a.length + 1))) + 'abc'[Math.floor(rnd() * 3)] + a.slice(Math.floor(rnd() * (a.length + 1)));
    ok(A(a, b) === (osa(a, b) <= 1), 'matches a full edit-distance calculation', `${a} / ${b}: ${A(a, b)} vs distance ${osa(a, b)}`);
  }
}

group('Random books');
{
  let seed = +(process.env.SEED || 20261114);
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const WORDS = ['lunch', 'dinner', 'grab', 'taxi', 'mrt', 'kopi', 'ntuc', 'fairprice', 'shopee', 'lazada', 'rent', 'salary', 'bonus', 'top', 'up',
    'wise', 'uob', 'dbs', 'cimb', 'transfer', 'money', 'from', 'to', 'gym', 'netflix', '咖啡', '午餐', '戏票', 'lily', '姐', 'birthday', '(cc)', '#2', 'a-1'];
  const CATS = ['Food & Drink', 'Transport', 'Shopping', 'Bills', 'Other', 'Salary', 'Investment', 'Transfer'];
  const caseOf = w => rnd() < 0.2 ? w.toUpperCase() : rnd() < 0.3 ? w[0].toUpperCase() + w.slice(1) : w;
  for (let b = 0; b < 300; b++) {
    const pool = Array.from({ length: 2 + Math.floor(rnd() * 25) }, () => Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => pick(WORDS)).join(' '));
    const rows = [];
    for (let i = 0, n = Math.floor(rnd() * 120); i < n; i++) {
      const d = pick(pool).split(' ').map(caseOf).join(rnd() < 0.1 ? '  ' : ' ');
      const date = `20${pick(['24', '25', '26'])}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`;
      const r = rnd();
      if (r < 0.15) {
        const g = (rnd() < 0.5 ? 'tg_' : 'ag_') + i + '_' + b;
        rows.push(row(date, 'expense', d, g[0] === 't' ? 'Transfer' : 'Investment', { transferGroup: g, account: 'A' + i % 3 }),
                  row(date, g[0] === 't' ? 'income' : 'asset', d, g[0] === 't' ? 'Transfer' : 'Gold', { transferGroup: g, account: 'B' + i % 3 }));
      } else rows.push(row(date, pick(['expense', 'expense', 'expense', 'income', 'payback', 'asset']), d, pick(CATS)));
    }
    const ix = book(rows);
    // Every description is offered under exactly one entry of its kind.
    const kinds = ['expense', 'income', 'payback', 'asset', 'transfer'];
    const expect = new Map();
    rows.forEach(t => {
      const k = API.descKind(t);
      if (!k) return;
      const key = k + '|' + t.description.replace(/\s+/g, ' ').trim().toLowerCase();
      expect.set(key, (expect.get(key) || 0) + 1);
    });
    ok(ix.length === expect.size && ix.every(e => expect.get(e.kind + '|' + e.lower) === e.uses), 'one entry per description and kind, counting every use',
       `${ix.length} entries for ${expect.size} descriptions`);
    ok(ix.every(e => e.text === e.text.trim() && !/\s\s/.test(e.text) && e.text.toLowerCase() === e.lower), 'every suggestion is tidily spaced and keyed on its own words');
    for (let k = 0; k < 30; k++) {
      const kind = pick(kinds), e = pick(ix);
      // What was typed: the start of a description, a later word, or noise.
      const r = rnd();
      const typed = !e ? '' : r < 0.4 ? e.text.slice(0, 1 + Math.floor(rnd() * e.text.length)) : r < 0.7 ? pick(e.words || ['x']).slice(0, 2) : pick(WORDS).slice(0, 3);
      const got = API.suggestDescriptions(ix, kind, typed, 5);
      const all = API.suggestDescriptions(ix, kind, typed, 1e9);
      ok(got.length <= 5 && new Set(got).size === got.length, 'at most five, never the same one twice');
      ok(got.every(g => g.kind === kind), 'only the kind being added');
      ok(got.every((g, i) => g === all[i]), 'the five shown are the top of the full list');
      // Everything that starts with what was typed is in the full list, ahead of everything that doesn't.
      const q = typed.replace(/\s+/g, ' ').trim().toLowerCase();
      const starts = ix.filter(x => x.kind === kind && x.lower.startsWith(q));
      ok(starts.every(x => all.includes(x)) && all.slice(0, starts.length).every(x => x.lower.startsWith(q)),
         'everything starting with what was typed is offered, and first', `${typed}: ${all.slice(0, 6).map(x => x.text).join(' | ')}`);
      ok(all.every(x => !q || x.lower.includes(q) || API.descWords(q).every(w => x.words.some(y => y.startsWith(w) || (w.length >= 4 && [w.length - 1, w.length, w.length + 1].some(n => API.oneEditApart(w, y.slice(0, n))))))),
         'nothing is offered that doesn\'t match');
      if (e && e.kind === kind && kind !== 'asset') {
        const prefix = e.text.slice(0, Math.max(1, Math.ceil(e.text.length / 2)));
        ok(API.suggestDescriptions(ix, kind, e.text, 1e9)[0] === e || API.suggestDescriptions(ix, kind, e.text, 1e9).some(x => x === e),
           'typing a description in full always offers it');
        ok(API.suggestDescriptions(ix, kind, prefix, 1e9).includes(e), 'typing the first half of one always offers it');
      }
    }
  }
}

// ── a real backup, replayed in date order ──────────────────────────────────
if (process.env.PFMT_BACKUP) {
  group('A real backup, replayed: what would have been offered');
  let file = process.env.PFMT_BACKUP.replace(/^~/, require('os').homedir());
  if (fs.statSync(file).isDirectory()) file = path.join(file, 'transactions.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const books = new Map();
  (Array.isArray(raw) ? raw : raw.transactions).forEach(r => {
    const t = { id: r.id, type: r.type, amount: +r.amount, description: r.description, category: r.category, account: r.account, date: r.date,
                currency: r.currency, transferGroup: r.transfer_group || undefined, created: String(r.created_at || '').replace('T', ' ').slice(0, 19) };
    if (!books.has(r.user_id)) books.set(r.user_id, []);
    books.get(r.user_id).push(t);
  });
  books.forEach((rows, user) => {
    rows.sort((a, b) => (a.date + a.created < b.date + b.created ? -1 : 1));
    state.transactions = rows;
    let repeats = 0, firstTimes = 0, catRight = 0, accRight = 0, accN = 0;
    const at = [0, 0, 0, 0];   // offered in the top five after 0, 1, 2, 3 letters
    const seen = [];
    rows.forEach(t => {
      const kind = API.descKind(t);
      const text = String(t.description || '').replace(/\s+/g, ' ').trim();
      if (kind && text) {
        const ix = API.buildDescIndex(seen, t.date);
        const mine = ix.find(e => e.kind === kind && e.lower === text.toLowerCase());
        if (!mine) firstTimes++;
        else {
          repeats++;
          [0, 1, 2, 3].forEach(n => { if (API.suggestDescriptions(ix, kind, text.slice(0, n), 5).includes(mine)) at[n]++; });
          if (mine.category === t.category || kind === 'transfer') catRight++;
          if (kind === 'transfer' || kind === 'asset') {
            const peer = API.transferPartner(t);
            accN++;
            if (mine.account === t.account && mine.other === ((peer && peer.account) || '')) accRight++;
          }
        }
      }
      seen.push(t);
    });
    const pct = n => repeats ? `${Math.round(100 * n / repeats)}%` : '—';
    console.log(`  book ${String(user).slice(0, 8)}: ${rows.length} rows, ${repeats} reused a description, ${firstTimes} were new`);
    console.log(`    the right one offered with nothing typed ${pct(at[0])}, after 1 letter ${pct(at[1])}, 2 letters ${pct(at[2])}, 3 letters ${pct(at[3])}`);
    console.log(`    picking it fills the category you chose ${pct(catRight)}` + (accN ? `; both accounts of a transfer or purchase ${Math.round(100 * accRight / accN)}% (${accRight} of ${accN})` : ''));
    ok(at[3] >= at[2] && at[2] >= at[1] && at[1] >= at[0], `book ${String(user).slice(0, 8)}: each letter typed only helps`, at.join());
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
