#!/usr/bin/env node
/*
 * How long a full redraw takes with a big book: 5,000 transactions (with
 * transfer pairs) in the real index.html, timed in headless Chrome.
 *   node test/perf/bench.js [count]
 * Prints the median of 7 runs of renderAll() and of each page's own render,
 * plus the time to save the book to localStorage. Not a pass/fail test.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const N = +process.argv[2] || 5000;
const ROOT = path.join(__dirname, '..', '..');
let page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const fake = fs.readFileSync(path.join(ROOT, 'test', 'e2e', 'fake-supabase.js'), 'utf8');
page = page.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js[^"]*"[^>]*><\/script>/, () => `<script>${fake}</script>`);
page = page.replace('  startApp();\n})();', () => `
  const cats = ['Food & Drink','Transport','Groceries','Shopping','Bills','Rental','Health','Entertainment','Sport','Education'];
  const T = []; let id = 1;
  for (let i = 0; i < ${N}; i++) {
    const date = new Date(Date.now() - (i * 365 / ${N}) * 864e5).toISOString().slice(0, 10);
    const cur = i % 4 === 0 ? 'MYR' : 'SGD';
    if (i % 25 === 0) { const g = 'tg_' + i;
      T.push({ id: 't' + id++, date, type: 'expense', category: 'Transfer', amount: 300, currency: 'SGD', account: 'DBS', description: 'to MYR', transferGroup: g, transferPeer: 'MBB', created: date + ' 09:00:00' });
      T.push({ id: 't' + id++, date, type: 'income', category: 'Transfer', amount: 950, currency: 'MYR', account: 'MBB', description: 'from SGD', transferGroup: g, transferPeer: 'DBS', created: date + ' 09:00:01' }); continue; }
    T.push({ id: 't' + id++, date, type: i % 15 === 0 ? 'income' : 'expense', category: i % 15 === 0 ? 'Salary' : cats[i % 10], amount: 5 + (i * 37 % 200), currency: cur,
             account: cur === 'MYR' ? 'MBB' : 'DBS', description: 'Item ' + i, created: date + ' 10:00:00' });
  }
  Object.assign(state, { transactions: T, accounts: [{ id: 1, name: 'DBS', balance: 5000, currency: 'SGD' }, { id: 2, name: 'MBB', balance: 2000, currency: 'MYR' }],
    budgets: cats.map((c, i) => ({ id: i + 1, category: c, amount: 300, currency: 'SGD' })), theme: 'dark', trendMonths: 12 });
  applyTheme();
  const ol = document.getElementById('login-overlay'); if (ol) ol.style.display = 'none';
  showView('dashboard');
  setTimeout(() => {
    const med = fn => { const r = []; for (let k = 0; k < 7; k++) { const t0 = performance.now(); fn(); r.push(performance.now() - t0); } r.sort((a, b) => a - b); return Math.round(r[3] * 10) / 10; };
    renderAll();
    const out = { n: state.transactions.length, renderAll_ms: med(renderAll) };
    ['renderDashboard', 'renderTransactions', 'renderAnalytics', 'renderBudgets', 'renderAccounts', 'saveState'].forEach(f => { out[f + '_ms'] = med(window[f]); });
    const p = document.createElement('pre'); p.id = 'bench'; p.textContent = JSON.stringify(out); document.body.appendChild(p);
  }, 300);
})();`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfmt-bench-'));
fs.writeFileSync(path.join(dir, 'bench.html'), page);
const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${dir}/profile`, 'file://' + path.join(dir, 'bench.html')], { stdio: ['ignore', 'ignore', 'pipe'] });
let buf = '';
proc.stderr.on('data', async d => {
  buf += d;
  const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
  if (!m || proc.done) return;
  proc.done = true;
  const list = await (await fetch(m[1].replace('ws://', 'http://').replace(/\/devtools\/browser\/.*/, '/json/list'))).json();
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  ws.onopen = () => {
    const poll = setInterval(() => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: "(document.getElementById('bench')||{}).textContent||''", returnByValue: true } })), 500);
    ws.onmessage = e => { const v = JSON.parse(e.data).result?.result?.value; if (v) { clearInterval(poll); console.log(v); ws.close(); proc.kill('SIGKILL'); setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }, 1000); } };
  };
});
