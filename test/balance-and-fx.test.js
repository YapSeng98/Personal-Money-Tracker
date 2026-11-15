#!/usr/bin/env node
/*
 * Updating an account to its real balance, and net worth in one currency.
 *
 * Run:  node test/balance-and-fx.test.js
 *       SEED=n node test/balance-and-fx.test.js   (another set of random books)
 *
 * Loads the REAL balanceOn(), balanceUpdateRow(), fxRate() and
 * netWorthInHome() out of index.html and checks them on random books (several
 * currencies, cards in debt, rows dated after the update, rows in another
 * account or currency) against figures worked out here:
 *
 *   • the row recorded brings that day's balance to exactly what was typed,
 *     leaves every earlier day alone and moves every later day by the same
 *     difference, and touches no other account;
 *   • an investment or crypto account records a gain or loss, any other a
 *     correction, and nothing at all when the balance already agrees;
 *   • the total converts each currency once at its rate (USDT at the US
 *     dollar's, a rate you set over the day's), and leaves out, by name,
 *     any currency it has no rate for.
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
const NAMES = ['txnBalanceEffect', 'effectiveBal', 'GAIN_LOSS_CATEGORY', 'isMarketAccount', 'balanceOn', 'balanceUpdateRow',
  'CUR_SYM', 'fmtWithCur', 'fmtSigned', 'FX_KNOWN', 'fxCode', 'fxRate', 'fxCurrencies', 'netWorthInHome'];
const state = { currency: 'SGD', transactions: [], accounts: [] };
const API = new Function('state', NAMES.map(extract).join('\n') + `; return {${NAMES.join(',')}};`)(state);

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
const r2 = v => Math.round(v * 100) / 100;

let seed = +(process.env.SEED || 20261115);
const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const money = () => r2(rnd() < 0.1 ? 10000 + rnd() * 900000 : 0.01 + rnd() * 2000);
const day = () => `2026-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`;
const TYPES = ['Checking', 'Savings', 'Credit Card', 'Cash', 'Investment', 'Crypto'];
const CURS = ['SGD', 'MYR', 'USD', 'USDT', 'AUD'];

// The balance at the end of a day, worked out here.
const mine = (acc, date, rows) => r2(rows.filter(t => t.account === acc.name && t.currency === acc.currency && t.date <= date)
  .reduce((s, t) => s + (t.type === 'expense' ? -t.amount : ['income', 'asset', 'payback'].includes(t.type) ? t.amount : 0), acc.balance));

group('Update balance: one row brings the day to what was typed');
for (let b = 0; b < 400; b++) {
  state.currency = 'SGD';
  state.accounts = Array.from({ length: int(1, 5) }, (_, i) => ({ id: i, name: 'Acct ' + i, type: pick(TYPES), currency: pick(CURS), balance: r2((rnd() - 0.4) * 5000) }));
  state.transactions = Array.from({ length: int(0, 60) }, (_, i) => {
    const a = pick(state.accounts);
    return { id: 't' + i, type: pick(['expense', 'expense', 'income', 'payback', 'asset', 'transfer']), amount: money(), account: rnd() < 0.9 ? a.name : 'Cash',
             currency: rnd() < 0.9 ? a.currency : pick(CURS), date: day() };
  });
  for (let k = 0; k < 6; k++) {
    const acc = pick(state.accounts), date = day();
    ok(API.balanceOn(acc, date) === mine(acc, date, state.transactions), 'the balance on a day is its starting balance plus every row up to it', `${API.balanceOn(acc, date)} vs ${mine(acc, date, state.transactions)}`);
    const had = API.balanceOn(acc, date);
    const actual = rnd() < 0.15 ? had : r2(had + (rnd() - 0.5) * (rnd() < 0.2 ? 200000 : 400));
    const row = API.balanceUpdateRow(acc, actual, date);
    if (actual === had) { ok(row === null, 'the same balance records nothing'); continue; }
    ok(row && row.amount > 0 && row.account === acc.name && row.currency === acc.currency && row.date === date, 'the row is on that account, in its currency, on that day', JSON.stringify(row));
    ok(row.type === (actual > had ? 'income' : 'expense'), 'more than the app had is money in; less is money out');
    const market = acc.type === 'Investment' || acc.type === 'Crypto';
    ok(market ? row.category === 'Gain/Loss' && row.description === (actual > had ? 'Market gain' : 'Market loss')
              : row.category === 'Other' && row.description === 'Balance correction', 'an investment or crypto account records a gain or loss; any other, a correction', `${acc.type}: ${row.category} / ${row.description}`);
    const before = state.accounts.map(a => [a, ['2025-12-31', date, '2026-12-31', day()].map(d => API.balanceOn(a, d))]);
    state.transactions.push({ id: 'upd' + k, ...row });
    ok(API.balanceOn(acc, date) === actual, 'afterwards that day ends at exactly the balance typed', `${API.balanceOn(acc, date)} vs ${actual}`);
    before.forEach(([a, bals]) => ['2025-12-31', date, '2026-12-31'].forEach((d, i) => {
      const now = API.balanceOn(a, d);
      const expect = a !== acc || d < date ? bals[i] : r2(bals[i] + (actual - had));
      ok(now === expect, 'earlier days and other accounts are untouched; later days move by the difference', `${a.name} on ${d}: ${now} vs ${expect}`);
    }));
    ok(new RegExp(`^Balance updated to -?${acc.currency === 'USD' ? '\\$' : ''}`).test(row.notes) || row.notes.startsWith('Balance updated to'), 'the note says what it was set to', row.notes);
    ok(API.balanceUpdateRow(acc, actual, date) === null, 'updating again to the same balance records nothing more');
  }
}

group('Total in one currency');
{
  state.currency = 'SGD';
  state.accounts = [
    { name: 'DBS', currency: 'SGD', balance: 1000 }, { name: 'Card', currency: 'SGD', balance: -250 },
    { name: 'Maybank', currency: 'MYR', balance: 3173.3 }, { name: 'Wise', currency: 'USD', balance: 80 },
    { name: 'Binance', currency: 'USDT', balance: 160 }];
  state.transactions = [];
  state.fx = { base: 'SGD', date: '2026-11-13', rates: { MYR: 3.1733, USD: 0.8 } };
  let t = API.netWorthInHome();
  ok(t.assets === 1000 + 1000 + 100 + 200 && t.debt === 250 && t.net === 2050 && !t.missing.length, 'each currency once, at its rate; USDT at the US dollar rate; debt kept apart', JSON.stringify(t));
  ok(API.fxRate('SGD') === 1 && API.fxRate('USDT') === 0.8 && API.fxCurrencies().join() === 'MYR,USD,USDT', 'the home currency is 1; USDT reads the dollar rate; currencies in use, home left out');
  state.fx.manual = { MYR: 3 };
  t = API.netWorthInHome();
  ok(r2(t.assets) === r2(1000 + 3173.3 / 3 + 100 + 200), 'a rate you set wins over the day\'s', JSON.stringify(t));
  state.fx = { base: 'MYR', rates: { USD: 0.24 } };
  t = API.netWorthInHome();
  ok(t.missing.join() === 'MYR,USD,USDT' && t.net === 750, 'rates for another home currency are not used: those currencies are left out, by name', JSON.stringify(t));
  state.fx = undefined;
  t = API.netWorthInHome();
  ok(t.missing.join() === 'MYR,USD,USDT' && t.net === 750, 'no rates at all: only the home currency counts, and the rest are named');
  state.currency = 'USDT';
  state.fx = { base: 'USD', rates: { SGD: 1.2881, MYR: 4.0875 } };
  ok(API.fxRate('USD') === 1 && API.fxRate('SGD') === 1.2881, 'a USDT home currency uses the dollar\'s rates');
  state.currency = 'SGD';
  // Random books against a total worked out here.
  for (let b = 0; b < 2000; b++) {
    state.accounts = Array.from({ length: int(1, 8) }, (_, i) => ({ name: 'A' + i, currency: pick(CURS), balance: r2((rnd() - 0.3) * 100000) }));
    const rates = { MYR: r2(2 + rnd() * 2), USD: r2(0.5 + rnd()), AUD: r2(0.8 + rnd()) };
    state.fx = { base: 'SGD', rates: rnd() < 0.2 ? { MYR: rates.MYR } : rates, manual: rnd() < 0.3 ? { AUD: 1.5 } : {} };
    const rate = c => c === 'SGD' ? 1 : (state.fx.manual[c] || state.fx.rates[c === 'USDT' ? 'USD' : c] || null);
    let assets = 0, debt = 0; const missing = new Set();
    const per = {};
    state.accounts.forEach(a => { per[a.currency] = per[a.currency] || [0, 0]; if (a.balance > 0) per[a.currency][0] += a.balance; else per[a.currency][1] -= a.balance; });
    Object.entries(per).forEach(([c, [as, db]]) => { const r = rate(c); if (!r) { missing.add(c); return; } assets += as / r; debt += db / r; });
    const got = API.netWorthInHome();
    ok(got.assets === r2(assets) && got.debt === r2(debt) && got.net === r2(r2(assets) - r2(debt)) && got.missing.join() === [...missing].sort().join(),
       'random books: the total matches one worked out here', `${JSON.stringify(got)} vs ${r2(assets)}/${r2(debt)} missing ${[...missing]}`);
  }
}

console.log(`\n${failed ? 'FAIL' : 'PASS'} — ${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
