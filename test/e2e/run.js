#!/usr/bin/env node
/*
 * Browser end-to-end tests: the real index.html, in headless Chrome.
 *
 * Run:  node test/e2e/run.js            (desktop, laptop and phone sizes, phone fit, then offline)
 *       node test/e2e/run.js --no-offline (skip the offline run, which needs network)
 *       node test/e2e/run.js --no-fit    (skip the phone-fit audit)
 *       node test/e2e/run.js --no-fuzz   (skip the short random-use pass)
 *       node test/e2e/run.js --no-a11y   (skip the accessibility and typed-markup passes)
 *       node test/e2e/run.js --a11y [--all] (only the accessibility audit, at 390px and
 *                                          360px in Chinese, light and dark, with a report)
 *       node test/e2e/run.js --xss       (only the typed-markup pass: markup in every
 *                                          text field, every screen checked for it)
 *       node test/e2e/run.js --fuzz [--seeds=N --steps=M --first=K] [--backup DIR --user ID]
 *                                          random everyday use through the real app
 *                                          (fuzz.js) against a fake server that
 *                                          checks writes as Postgres would; every
 *                                          result checked after every action
 *       node test/e2e/run.js --health --backup ~/PFMT_Backups/<date> --user <id prefix>
 *                                          loads a real book the way the app does and
 *                                          checks all of it, and that loading twice
 *                                          changes nothing
 *       node test/e2e/run.js --shots DIR (also save screenshots of key screens)
 *       node test/e2e/run.js --fit       (only the phone-fit audit, at every size, with a full report)
 *       node test/e2e/run.js --fit-shots DIR [--widths=320,390] [--themes=dark,light]
 *       node test/e2e/run.js --page-shots DIR [--themes=command,dark] [--pages=dashboard,accounts] [--sizes=1100x800,390x844] [--lang=zh]
 *                                         (screenshots of every screen, scrolled top to bottom)
 *       node test/e2e/run.js --pdf DIR [--backup ~/PFMT_Backups/<date> --user <id prefix>]
 *                                         (the monthly statement saved as PDF, as Print → Save as PDF
 *                                          makes it; with --backup, every month of a real book,
 *                                          read from a local backup and kept on this machine)
 *
 * Needs Node 22+ (for its built-in WebSocket) and Google Chrome or Chromium;
 * set CHROME_PATH if Chrome isn't found. No other dependencies, matching the
 * rest of the repo.
 *
 * Each run builds a copy of the page with supabase-js swapped for
 * fake-supabase.js (no network, no login), seed.js's test data loaded in place
 * of the sign-in flow, and checks.js clicking through the app. Chrome is driven
 * over the DevTools protocol: the runner waits, in real time, until the page
 * reports its results, and records any error thrown while it runs. The phone
 * size is true mobile emulation at 390px.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function findChrome() {
  return [process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].find(p => p && fs.existsSync(p));
}

function replaceOnce(text, pattern, replacement, what) {
  const hits = text.split(pattern).length - 1;
  if (hits !== 1) throw new Error(`expected one ${what} in index.html, found ${hits}`);
  return text.replace(pattern, () => replacement);
}

// The test data, or one person's book read from a local backup (--backup).
function seedSource(backup, user) {
  if (!backup) return read('seed.js');
  const dir = backup.replace(/^~/, os.homedir());
  const load = t => JSON.parse(fs.readFileSync(path.join(dir, t + '.json'), 'utf8'));
  const txns = load('transactions');
  const uid = [...new Set(txns.map(t => t.user_id))].find(u => u.startsWith(user || ''));
  if (!uid) throw new Error(`no book in ${dir} whose user id starts with "${user}"`);
  const mine = rows => rows.filter(r => r.user_id === uid);
  const pref = mine(load('preferences'))[0] || {};
  const book = {
    currency: pref.currency || 'SGD', displayName: pref.display_name || '',
    accounts: mine(load('accounts')).map(a => ({ id: a.id, name: a.name, type: a.type, institution: a.institution || '', currency: a.currency || 'SGD', balance: +a.starting_balance, icon: a.icon || '' })),
    transactions: mine(txns).map(t => ({ id: t.id, type: t.type, amount: +t.amount, description: t.description, category: t.category, account: t.account,
      date: t.date, notes: t.notes || '', currency: t.currency || 'SGD', transferGroup: t.transfer_group || '',
      created: t.created_at ? new Date(t.created_at).toISOString().slice(0, 19).replace('T', ' ') : '' })),
  };
  // The same book as the server holds it, for views that load it through
  // snLoadAll() (fuzz.js's health check and random use on a real book).
  const server = { uid, tables: {} };
  ['transactions', 'accounts', 'budgets', 'goals', 'bills', 'preferences'].forEach(t => {
    try { server.tables[t] = mine(load(t)); } catch (e) { server.tables[t] = []; }
  });
  return `  const P = new URLSearchParams(location.search);
  const M0 = localYM(), M1 = prevMonthKey(M0), M2 = prevMonthKey(M1);
  window.__serverSeed = ${JSON.stringify(server)};
  const BOOK = ${JSON.stringify(book)};
  Object.assign(state, BOOK, { theme: P.get('theme') || 'light', language: 'en', reviewMonth: M1, filterMonth: M1 });
  applyTheme(); renderAll();
  document.getElementById('login-overlay').style.display = 'none';
  window.__bookMonths = [...new Set(BOOK.transactions.map(t => t.date.slice(0, 7)))].sort();`;
}

function buildPage(dir, backup, user) {
  let page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const cdn = page.match(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js[^"]*"[^>]*><\/script>/);
  if (!cdn) throw new Error('could not find the supabase-js <script> tag in index.html');
  page = replaceOnce(page, cdn[0], `<script>${read('fake-supabase.js')}</script>`, 'supabase-js tag');
  page = replaceOnce(page, '  startApp();\n})();', `${seedSource(backup, user)}\n${read('checks.js')}\n${read('fit.js')}\n${read('fuzz.js')}\n})();`, 'startApp() call in init');
  // Screenshots should show the finished state, not a modal's fade-in.
  page = page.replace('</style>', '.modal{animation:none!important}</style>');
  const file = path.join(dir, 'app.html');
  fs.writeFileSync(file, page);
  return 'file://' + file;
}

// A minimal DevTools-protocol client over Node's built-in WebSocket.
class DevTools {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.seq = 0;
    this.pending = new Map();
    this.handlers = [];
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error('could not connect to Chrome'));
      this.ws.onmessage = ev => {
        const msg = JSON.parse(ev.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: ok, reject: fail } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) fail(new Error(msg.error.message)); else ok(msg.result);
        } else {
          this.handlers.forEach(h => h(msg));
        }
      };
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  // The same, but giving up after ms: a page whose browser has frozen never
  // answers, and the whole run would wait on it for ever.
  sendWithin(ms, method, params = {}, sessionId) {
    let timer;
    return Promise.race([this.send(method, params, sessionId),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${method}: no answer in ${ms / 1000}s`)), ms); })])
      .finally(() => clearTimeout(timer));
  }
  on(handler) { this.handlers.push(handler); }
  close() { try { this.ws.close(); } catch (_) {} }
}

async function launch(chrome) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pfmt-chrome-'));
  // The three --disable-…background… flags stop Chrome slowing the timers of
  // a page that isn't the front tab, which the audit's waits depend on.
  const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    ...(process.env.CI ? ['--no-sandbox'] : []), 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not start within 30s')), 30000);
    proc.stderr.on('data', d => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.on('exit', code => reject(new Error(`Chrome exited (${code}) before it started`)));
  });
  const dt = new DevTools(url);
  await dt.open();
  return {
    dt,
    stop() {
      dt.close();
      proc.kill('SIGKILL');
      setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500);
    }
  };
}

async function openPage(dt, url, { width, height, mobile }) {
  const { targetId } = await dt.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await dt.send('Target.attachToTarget', { targetId, flatten: true });
  const errors = [];
  dt.on(msg => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push('uncaught: ' + ((d.exception && d.exception.description) || d.text).split('\n')[0]);
    }
    // A native dialog (print, alert, confirm) freezes the page and every call
    // into it, so the run would hang. Say which, and dismiss it.
    if (msg.method === 'Page.javascriptDialogOpening') {
      errors.push(`a ${msg.params.type} dialog opened: "${String(msg.params.message).slice(0, 120)}"`);
      dt.send('Page.handleJavaScriptDialog', { accept: false }, sessionId).catch(() => {});
    }
  });
  await dt.sendWithin(30000, 'Runtime.enable', {}, sessionId);
  await dt.sendWithin(30000, 'Page.enable', {}, sessionId);
  await dt.sendWithin(30000, 'Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, sessionId);
  await dt.sendWithin(30000, 'Page.navigate', { url }, sessionId);
  const evaluate = async (expression, ms = 30000) =>
    (await dt.sendWithin(ms, 'Runtime.evaluate', { expression, returnByValue: true }, sessionId)).result.value;
  return { sessionId, targetId, errors, evaluate };
}

async function runChecks(dt, url, size, ms = 180000) {
  let page;
  try { page = await openPage(dt, url, size); }
  catch (e) { return { stalled: true, results: [{ ok: false, name: 'the page opened', detail: e.message }], errors: [] }; }
  const deadline = Date.now() + ms;
  let text = null, stalled = false;
  while (Date.now() < deadline) {
    try { text = await page.evaluate("(document.getElementById('e2e') || {}).textContent || null"); }
    catch (e) { if (/no answer/.test(e.message)) { stalled = true; break; } text = null; }
    if (text) break;
    await sleep(250);
  }
  await dt.sendWithin(10000, 'Target.closeTarget', { targetId: page.targetId }).catch(() => {});
  if (stalled) return { stalled: true, results: [{ ok: false, name: 'the page finished its checks', detail: 'the browser stopped answering' }], errors: page.errors };
  if (!text) return { results: [{ ok: false, name: 'the page finished its checks', detail: `no results within ${Math.round(ms / 60000)} minutes` }], errors: page.errors };
  const out = JSON.parse(text);
  out.errors = [...page.errors, ...out.errors];
  return out;
}

// Headless Chrome very occasionally freezes in its graphics process: the page
// goes quiet and never answers. Checks run in a fresh browser once more when
// that happens, and the report says so, so a frozen browser is never mistaken
// for (or hides) a failing check.
let browser = null, chromePath = null;
async function checked(url, size, ms) {
  const out = await runChecks(browser.dt, url, size, ms);
  if (!out.stalled) return out;
  browser.stop();
  browser = await launch(chromePath);
  const again = await runChecks(browser.dt, url, size, ms);
  again.retried = true;
  return again;
}

async function screenshot(dt, url, size, file) {
  const page = await openPage(dt, url, size);
  await sleep(1500);
  const { data } = await dt.send('Page.captureScreenshot', { format: 'png' }, page.sessionId);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  await dt.send('Target.closeTarget', { targetId: page.targetId });
}

// The offline shell: serve the real app from localhost (service workers need a
// secure origin), let sw.js cache it, stop the server, and reload. The page has
// to come back from the cache with its library. Needs network for the first,
// online load of supabase-js from the CDN.
async function runOffline(dt) {
  const http = require('http');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.json': 'application/json' };
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise(r => server.listen(0, 'localhost', r));
  const url = `http://localhost:${server.address().port}/index.html`;
  const results = [];
  const ok = (cond, name, detail) => results.push({ ok: !!cond, name, detail: cond ? '' : String(detail === undefined ? '' : detail) });
  const page = await openPage(dt, url, { width: 1280, height: 900, mobile: false });
  const until = async (expr, ms = 30000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await page.evaluate(expr).catch(() => false)) return true; await sleep(200); }
    return false;
  };
  const evalAsync = async expression =>
    (await dt.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, page.sessionId)).result.value;
  try {
    ok(await until("!!navigator.serviceWorker && !!navigator.serviceWorker.controller"), 'offline: the service worker installs and takes over the page');
    const manifest = await evalAsync("fetch('manifest.webmanifest').then(r => r.json()).then(m => m.name + '|' + m.icons.length + '|' + m.display)").catch(e => String(e));
    ok(/PFMT.*\|3\|standalone/.test(manifest), 'install: the manifest names the app, with 3 icons, standalone', manifest);
    const shortcuts = await evalAsync("fetch('manifest.webmanifest').then(r => r.json()).then(m => Promise.all(m.shortcuts.map(s => fetch(s.icons[0].src).then(r => s.url + (r.ok ? ':icon' : ':no-icon'))))).then(a => a.join(' '))").catch(e => String(e));
    ok(shortcuts === './?add=expense:icon ./?add=income:icon ./?add=transfer:icon ./?add=balance:icon', 'install: long-press shortcuts for expense, income, transfer and balance, each with its icon', shortcuts);
    const fresh = await evalAsync("checkForUpdate(true).then(v => v + '|' + document.getElementById('update-bar').hidden)").catch(e => String(e));
    ok(fresh === 'false|true', 'update: the page just served is not taken for a new version', fresh);
    const icons = await evalAsync("Promise.all(['icons/icon-192.png','icons/icon-512.png','icons/maskable-512.png','icons/apple-touch-icon.png'].map(u => fetch(u).then(r => r.ok))).then(a => a.every(Boolean))");
    ok(icons, 'install: every icon it lists exists');
    await dt.send('Page.reload', {}, page.sessionId);
    await until("document.readyState === 'complete' && typeof window.supabase === 'object'");
    await sleep(1500);
    const cached = await evalAsync("caches.open('pfmt-shell-v1').then(c => c.keys()).then(k => k.map(r => r.url).join(' '))");
    ok(/index\.html/.test(cached) && /supabase-js@2\.118\.0/.test(cached), 'offline: the page and its pinned library are cached', cached);
    server.close(); sockets.forEach(s => s.destroy());
    await dt.send('Page.reload', {}, page.sessionId);
    const back = await until("document.readyState === 'complete' && !!document.getElementById('view-dashboard') && typeof window.supabase === 'object'", 20000);
    ok(back, 'offline: with the site unreachable, the app still opens, library and all');
    const apiCached = await evalAsync("caches.open('pfmt-shell-v1').then(c => c.keys()).then(k => k.map(r => new URL(r.url).hostname).filter(h => h.endsWith('supabase.co')).length)");
    ok(apiCached === 0, 'offline: no Supabase data request is ever cached', apiCached);
  } finally {
    server.close(); sockets.forEach(s => s.destroy());
    await dt.send('Target.closeTarget', { targetId: page.targetId }).catch(() => {});
  }
  return { results, errors: page.errors.filter(e => !/Failed to fetch|ERR_|NetworkError|Load failed/.test(e)) };
}

// Phone fit: fit.js's audit at the common phone sizes, a phone on its side, a
// tablet, and once in Chinese. Returns each problem with the sizes it shows at.
// The everyday run covers the extremes: the smallest phone, a common one in
// Chinese, and a phone on its side. --fit covers them all.
const FIT_QUICK = ['320', '360 zh', '390', '390 command', '844×390'];
const FIT_SIZES = [
  { name: '320', query: '', size: { width: 320, height: 568, mobile: true } },
  { name: '360', query: '', size: { width: 360, height: 740, mobile: true } },
  { name: '360 zh', query: '&lang=zh', size: { width: 360, height: 740, mobile: true } },
  { name: '375', query: '', size: { width: 375, height: 667, mobile: true } },
  { name: '390', query: '', size: { width: 390, height: 844, mobile: true } },
  { name: '390 command', query: '', theme: 'command', size: { width: 390, height: 844, mobile: true } },
  { name: '430', query: '', size: { width: 430, height: 932, mobile: true } },
  { name: '844×390', query: '', size: { width: 844, height: 390, mobile: true } },
  { name: '768', query: '', size: { width: 768, height: 1024, mobile: true } },
];
async function runFit(dt, url, quick, mode = '', sizes = null) {
  const merged = new Map(), errors = [];
  const pick = sizes || (quick ? FIT_QUICK : (process.argv.find(a => a.startsWith('--sizes=')) || '').slice(8).split(',').filter(Boolean));
  for (const fit of FIT_SIZES.filter(f => !pick.length || pick.includes(f.name))) {
    for (const theme of mode === 'a11y' ? ['light', 'dark', 'command'] : [fit.theme || 'dark']) {
    const out = await checked(url + `?view=fit&theme=${theme}` + fit.query + (mode === 'a11y' ? '&a11y=1' : mode === 'xss' ? '&poison=1' : ''), fit.size);
    if (out.retried) console.log(`  (fit ${fit.name}: the browser froze; ran again in a fresh one)`);
    errors.push(...(out.errors || []).map(e => `${fit.name}: ${e}`));
    if (!out.findings) { errors.push(`${fit.name}: the audit did not finish`); continue; }
    out.findings.forEach(f => {
      const k = [f.kind, f.screen, f.at, f.text].join('|');
      if (!merged.has(k)) merged.set(k, Object.assign({}, f, { sizes: [], details: [] }));
      const m = merged.get(k); m.sizes.push(mode === 'a11y' ? `${fit.name} ${theme}` : fit.name); m.details.push(f.detail);
    });
    }
  }
  return { findings: [...merged.values()], errors };
}

async function fitShots(dt, url, out, widths, themes) {
  const page0 = await runChecks(dt, url + '?view=fit&theme=dark', { width: 390, height: 844, mobile: true });
  for (const width of widths) for (const theme of themes) for (const screen of page0.screens) {
    const size = { width, height: width > 600 ? 390 : Math.round(width * 2.16), mobile: true };
    const page = await openPage(dt, `${url}?view=fit&screen=${screen}&theme=${theme}`, size);
    await sleep(1200);
    const [sh, ch] = await page.evaluate('(() => { const s = window.__fitScroller ? __fitScroller() : document.scrollingElement; return [s.scrollHeight, s.clientHeight]; })()') || [0, 0];
    const stops = [0];
    for (let y = Math.round(ch * 0.8); y < sh - ch * 0.2 && stops.length < 8; y += Math.round(ch * 0.8)) stops.push(Math.min(y, sh - ch));
    for (let i = 0; i < stops.length; i++) {
      if (i) { await page.evaluate(`__fitScroller().scrollTop = ${stops[i]}`); await sleep(150); }
      const { data } = await dt.send('Page.captureScreenshot', { format: 'png' }, page.sessionId);
      fs.writeFileSync(path.join(out, `${width}-${theme}-${screen}-${i + 1}.png`), Buffer.from(data, 'base64'));
    }
    await dt.send('Target.closeTarget', { targetId: page.targetId });
  }
}

// Random use (fuzz.js): each seed is a different run of everyday actions
// through the real app against a fake server that behaves like Postgres.
async function runFuzz(url, first, seeds, steps, verbose) {
  let failed = 0;
  const kinds = new Map();
  for (let seed = first; seed < first + seeds; seed++) {
    const { results, errors, retried } = await checked(`${url}?view=fuzz&seed=${seed}&steps=${steps}`, { width: 1280, height: 900, mobile: false }, 600000);
    if (retried) console.log(`  (seed ${seed}: the browser froze; ran again in a fresh one)`);
    const bad = results.filter(r => !r.ok);
    failed += bad.length + errors.length;
    if (verbose) console.log(`  seed ${seed}: ${bad.length ? bad.length + ' problem' + (bad.length > 1 ? 's' : '') : 'all good'}${errors.length ? ', ' + errors.length + ' page errors' : ''} — ${(results.find(r => /ran \d/.test(r.name)) || {}).name || ''}`);
    bad.forEach(r => { if (!kinds.has(r.name)) kinds.set(r.name, r.detail); });
    errors.forEach(e => { if (!kinds.has('page error')) kinds.set('page error', e); });
  }
  console.log(`${failed ? 'FAIL' : 'PASS'} random use (${seeds} runs of ${steps} actions, every result checked after each): ${kinds.size} kind${kinds.size === 1 ? '' : 's'} of problem`);
  kinds.forEach((d, name) => console.log(`  ✗ ${name}${d ? '\n      ' + d.slice(0, 900) : ''}`));
  return failed;
}

async function main() {
  if (typeof WebSocket === 'undefined') { console.error('Node 22 or newer is needed (built-in WebSocket).'); process.exit(1); }
  const chrome = findChrome();
  if (!chrome) { console.error('Chrome or Chromium not found. Set CHROME_PATH.'); process.exit(1); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfmt-e2e-'));
  const argOf = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
  const url = buildPage(dir, argOf('--backup'), argOf('--user'));
  chromePath = chrome;
  browser = await launch(chrome);

  const runs = [
    { name: 'desktop (1440px, dark)', query: '?theme=dark', size: { width: 1440, height: 1200, mobile: false } },
    { name: 'laptop (1280px, light)', query: '?theme=light', size: { width: 1280, height: 900, mobile: false } },
    { name: 'phone (390px, dark)', query: '?theme=dark', size: { width: 390, height: 844, mobile: true } },
    { name: 'desktop (1440px, Command Center)', query: '?theme=command', size: { width: 1440, height: 1200, mobile: false } },
  ];
  let failed = 0;
  if (process.argv.includes('--pdf')) {
    try {
      const out = path.resolve(argOf('--pdf') || 'statement-pdfs');
      fs.mkdirSync(out, { recursive: true });
      // Which months: every month of a real book, or the test data's last two.
      const probe = await openPage(browser.dt, url + '?view=none', { width: 1280, height: 900, mobile: false });
      await sleep(1500);
      const months = await probe.evaluate("window.__bookMonths || [prevMonthKey(localYM()), localYM()]");
      await browser.dt.send('Target.closeTarget', { targetId: probe.targetId });
      for (const mk of months) {
        const page = await openPage(browser.dt, `${url}?view=print&month=${mk}&theme=dark`, { width: 1280, height: 900, mobile: false });
        await sleep(1200);
        const { data } = await browser.dt.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true }, page.sessionId);
        fs.writeFileSync(path.join(out, `statement-${mk}.pdf`), Buffer.from(data, 'base64'));
        await browser.dt.send('Target.closeTarget', { targetId: page.targetId });
      }
      console.log(`${months.length} statement PDF${months.length === 1 ? '' : 's'} saved to ${out}`);
    } finally { browser.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
    return;
  }
  if (process.argv.includes('--health')) {
    try {
      const { results, errors } = await checked(`${url}?view=health`, { width: 1280, height: 900, mobile: false }, 600000);
      const bad = results.filter(r => !r.ok);
      results.filter(r => r.note).forEach(r => console.log(`  · ${r.name.replace(/^health: /, '')}`));
      results.filter(r => !r.note).forEach(r => console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.replace(/^health: /, '')}${r.times > 1 ? ` (${r.times} checks)` : ''}${r.ok ? '' : '\n      ' + r.detail.slice(0, 900)}`));
      errors.forEach(e => console.log(`  ✗ page error: ${e.slice(0, 300)}`));
      console.log(`${bad.length || errors.length ? 'FAIL' : 'PASS'} health of the book: ${results.filter(r => !r.note).length - bad.length} checks passed, ${bad.length} failed`);
      failed = bad.length + errors.length;
    } finally { browser.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
    process.exit(failed ? 1 : 0);
  }
  if (process.argv.includes('--a11y') || process.argv.includes('--xss')) {
    try {
      const mode = process.argv.includes('--a11y') ? 'a11y' : 'xss';
      const { findings, errors } = await runFit(browser.dt, url, false, mode, mode === 'a11y' ? ['390', '360 zh'] : ['390']);
      const kinds = [...new Set(findings.map(f => f.kind))];
      kinds.forEach(kind => {
        const list = findings.filter(f => f.kind === kind);
        console.log(`\n${kind} (${list.length})`);
        list.slice(0, process.argv.includes('--all') ? 1e9 : 25).forEach(f => console.log(`  [${f.screen}] ${f.at}${f.text ? ' “' + f.text + '”' : ''} — ${f.details[0]} @ ${f.sizes.join(', ')}`));
      });
      errors.forEach(e => console.log(`  ✗ page error: ${e.slice(0, 300)}`));
      console.log(`\n${findings.length} findings, ${errors.length} errors`);
      failed = findings.length + errors.length;
    } finally { browser.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
    process.exit(failed ? 1 : 0);
  }
  if (process.argv.includes('--fuzz')) {
    try {
      const seeds = +(process.argv.find(a => a.startsWith('--seeds=')) || '--seeds=5').slice(8);
      const steps = +(process.argv.find(a => a.startsWith('--steps=')) || '--steps=150').slice(8);
      const first = +(process.argv.find(a => a.startsWith('--first=')) || '--first=1').slice(8);
      failed = await runFuzz(url, first, seeds, steps, true);
    } finally { browser.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
    process.exit(failed ? 1 : 0);
  }
  if (process.argv.includes('--page-shots')) {
    // Every main page in the themes asked for, desktop and phone, to look at.
    try {
      const out = path.resolve(process.argv[process.argv.indexOf('--page-shots') + 1] || 'page-shots');
      fs.mkdirSync(out, { recursive: true });
      const themes = (process.argv.find(a => a.startsWith('--themes=')) || '--themes=command').slice(9).split(',');
      const pages = (process.argv.find(a => a.startsWith('--pages=')) || '--pages=dashboard,transactions,budgets,bills,goals,analytics,accounts,settings').slice(8).split(',');
      // --sizes=1100x800,390x844 (a width under 900 is shot as a phone); --lang=zh
      const sizes = (process.argv.find(a => a.startsWith('--sizes=')) || '--sizes=1440x900,390x844').slice(8).split(',').map(x => x.split('x').map(Number));
      const lang = (process.argv.find(a => a.startsWith('--lang=')) || '').slice(7);
      const open = (process.argv.find(a => a.startsWith('--open=')) || '').slice(7);
      for (const theme of themes) for (const page of pages) for (const [width, height] of sizes) {
        await screenshot(browser.dt, url + `?view=page&page=${page}&theme=${theme}` + (lang ? `&lang=${lang}` : '') + (open ? `&open=${open}` : ''), { width, height, mobile: width < 900 },
                         path.join(out, `${theme}-${page}${open ? '-' + open : ''}-${width}${lang ? '-' + lang : ''}.png`));
      }
      console.log(`screenshots saved to ${out}`);
    } finally { browser.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
    return;
  }
  if (process.argv.includes('--fit') || process.argv.includes('--fit-shots')) {
    try {
      const at = process.argv.indexOf('--fit-shots');
      if (at > 0) {
        const out = path.resolve(process.argv[at + 1] || 'fit-shots');
        fs.mkdirSync(out, { recursive: true });
        const widths = (process.argv.find(a => a.startsWith('--widths=')) || '--widths=390').slice(9).split(',').map(Number);
        const themes = (process.argv.find(a => a.startsWith('--themes=')) || '--themes=dark').slice(9).split(',');
        await fitShots(browser.dt, url, out, widths, themes);
        console.log(`screenshots saved to ${out}`);
      } else {
        const { findings, errors } = await runFit(browser.dt, url);
        const kinds = [...new Set(findings.map(f => f.kind))];
        kinds.forEach(kind => {
          const list = findings.filter(f => f.kind === kind);
          console.log(`\n${kind} (${list.length})`);
          list.forEach(f => console.log(`  [${f.screen}] ${f.at}${f.text ? ' “' + f.text + '”' : ''} — ${f.details[0]} @ ${f.sizes.join(', ')}`));
        });
        errors.forEach(e => console.log(`  ✗ page error: ${e.slice(0, 300)}`));
        console.log(`\n${findings.length} findings, ${errors.length} errors`);
      }
    } finally { browser.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
    return;
  }
  try {
    for (const run of runs) {
      const { results, errors, retried } = await checked(url + run.query, run.size);
      if (retried) console.log(`  (${run.name}: the browser froze; ran again in a fresh one)`);
      const bad = results.filter(r => !r.ok);
      failed += bad.length + errors.length;
      console.log(`${bad.length || errors.length ? 'FAIL' : 'PASS'} ${run.name}: ${results.length - bad.length} checks passed, ${bad.length} failed, ${errors.length} page errors`);
      bad.forEach(r => console.log(`  ✗ ${r.name}${r.detail ? ' — ' + r.detail.slice(0, 300) : ''}`));
      errors.forEach(e => console.log(`  ✗ page error: ${e.slice(0, 300)}`));
    }
    if (!process.argv.includes('--no-fit')) {
      const { findings, errors } = await runFit(browser.dt, url, true);
      failed += findings.length + errors.length;
      console.log(`${findings.length || errors.length ? 'FAIL' : 'PASS'} phone fit (${FIT_QUICK.join(', ')}; every page, window and menu): ${findings.length} problem${findings.length === 1 ? '' : 's'}, ${errors.length} page errors`);
      findings.forEach(f => console.log(`  ✗ ${f.kind} [${f.screen}] ${f.at}${f.text ? ' “' + f.text + '”' : ''} — ${f.details[0]} @ ${f.sizes.join(', ')}`));
      errors.forEach(e => console.log(`  ✗ page error: ${e.slice(0, 300)}`));
    }
    if (!process.argv.includes('--no-a11y')) {
      // Accessibility (every screen at 390px, light and dark) and typed text
      // never running as markup (every screen, with markup in every field).
      for (const [mode, label] of [['a11y', 'accessibility (390px light, dark and Command Center; names, labels, contrast, focus, dialogs, language)'],
                                   ['xss', 'typed text never runs as code (markup in every field, every screen)']]) {
        const { findings, errors } = await runFit(browser.dt, url, false, mode, ['390']);
        failed += findings.length + errors.length;
        console.log(`${findings.length || errors.length ? 'FAIL' : 'PASS'} ${label}: ${findings.length} problem${findings.length === 1 ? '' : 's'}, ${errors.length} page errors`);
        findings.slice(0, 30).forEach(f => console.log(`  ✗ ${f.kind} [${f.screen}] ${f.at}${f.text ? ' “' + f.text + '”' : ''} — ${f.details[0]} @ ${f.sizes.join(', ')}`));
        errors.forEach(e => console.log(`  ✗ page error: ${e.slice(0, 300)}`));
      }
    }
    if (!process.argv.includes('--no-fuzz')) {
      // A short pass of random use on every run; --fuzz runs as many as asked.
      failed += await runFuzz(url, 1, 6, 200, false);
    }
    if (!process.argv.includes('--no-offline')) {
      const { results, errors } = await runOffline(browser.dt);
      const bad = results.filter(r => !r.ok);
      failed += bad.length + errors.length;
      console.log(`${bad.length || errors.length ? 'FAIL' : 'PASS'} offline shell and install: ${results.length - bad.length} checks passed, ${bad.length} failed, ${errors.length} page errors`);
      bad.forEach(r => console.log(`  ✗ ${r.name}${r.detail ? ' — ' + r.detail.slice(0, 300) : ''}`));
      errors.forEach(e => console.log(`  ✗ page error: ${e.slice(0, 300)}`));
    }
    const shotsAt = process.argv.indexOf('--shots');
    if (shotsAt > 0) {
      const out = path.resolve(process.argv[shotsAt + 1] || 'e2e-shots');
      fs.mkdirSync(out, { recursive: true });
      for (const [name, query, size] of [
        ['review-dark', '?view=review&theme=dark', { width: 1440, height: 1100, mobile: false }],
        ['review-light', '?view=review&theme=light', { width: 1280, height: 1100, mobile: false }],
        ['in-out-open', '?view=msum-open&theme=light', { width: 1280, height: 1300, mobile: false }],
        ['statement', '?view=stmt&theme=dark', { width: 1440, height: 1400, mobile: false }],
        ['phone-in-out', '?view=msum-open&theme=dark', { width: 390, height: 1200, mobile: true }],
        ['net-worth-dark', '?view=accounts&theme=dark', { width: 1440, height: 900, mobile: false }],
        ['net-worth-light', '?view=accounts&theme=light', { width: 1280, height: 900, mobile: false }],
        ['net-worth-phone', '?view=accounts&theme=dark', { width: 390, height: 1100, mobile: true }],
        ['import-desktop', '?view=import&theme=light', { width: 1440, height: 900, mobile: false }],
        ['import-phone', '?view=import&theme=dark', { width: 390, height: 900, mobile: true }]]) {
        await screenshot(browser.dt, url + query, size, path.join(out, name + '.png'));
      }
      console.log(`screenshots saved to ${out}`);
    }
  } finally {
    browser.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\n${failed ? 'FAIL' : 'PASS'} — browser tests${failed ? `: ${failed} problem${failed > 1 ? 's' : ''}` : ''}`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
