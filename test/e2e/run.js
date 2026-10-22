#!/usr/bin/env node
/*
 * Browser end-to-end tests: the real index.html, in headless Chrome.
 *
 * Run:  node test/e2e/run.js            (desktop, laptop and phone sizes)
 *       node test/e2e/run.js --shots DIR (also save screenshots of key screens)
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

function buildPage(dir) {
  let page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const cdn = page.match(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js[^"]*"[^>]*><\/script>/);
  if (!cdn) throw new Error('could not find the supabase-js <script> tag in index.html');
  page = replaceOnce(page, cdn[0], `<script>${read('fake-supabase.js')}</script>`, 'supabase-js tag');
  page = replaceOnce(page, '  startApp();\n})();', `${read('seed.js')}\n${read('checks.js')}\n})();`, 'startApp() call in init');
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
  on(handler) { this.handlers.push(handler); }
  close() { try { this.ws.close(); } catch (_) {} }
}

async function launch(chrome) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pfmt-chrome-'));
  const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0',
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
    if (msg.sessionId !== sessionId || msg.method !== 'Runtime.exceptionThrown') return;
    const d = msg.params.exceptionDetails;
    errors.push('uncaught: ' + ((d.exception && d.exception.description) || d.text).split('\n')[0]);
  });
  await dt.send('Runtime.enable', {}, sessionId);
  await dt.send('Page.enable', {}, sessionId);
  await dt.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, sessionId);
  await dt.send('Page.navigate', { url }, sessionId);
  const evaluate = async expression =>
    (await dt.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId)).result.value;
  return { sessionId, targetId, errors, evaluate };
}

async function runChecks(dt, url, size) {
  const page = await openPage(dt, url, size);
  const deadline = Date.now() + 180000;
  let text = null;
  while (Date.now() < deadline) {
    text = await page.evaluate("(document.getElementById('e2e') || {}).textContent || null").catch(() => null);
    if (text) break;
    await sleep(250);
  }
  await dt.send('Target.closeTarget', { targetId: page.targetId });
  if (!text) return { results: [{ ok: false, name: 'the page finished its checks', detail: 'no results within 3 minutes' }], errors: page.errors };
  const out = JSON.parse(text);
  out.errors = [...page.errors, ...out.errors];
  return out;
}

async function screenshot(dt, url, size, file) {
  const page = await openPage(dt, url, size);
  await sleep(1500);
  const { data } = await dt.send('Page.captureScreenshot', { format: 'png' }, page.sessionId);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  await dt.send('Target.closeTarget', { targetId: page.targetId });
}

async function main() {
  if (typeof WebSocket === 'undefined') { console.error('Node 22 or newer is needed (built-in WebSocket).'); process.exit(1); }
  const chrome = findChrome();
  if (!chrome) { console.error('Chrome or Chromium not found. Set CHROME_PATH.'); process.exit(1); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfmt-e2e-'));
  const url = buildPage(dir);
  const browser = await launch(chrome);

  const runs = [
    { name: 'desktop (1440px, dark)', query: '?theme=dark', size: { width: 1440, height: 1200, mobile: false } },
    { name: 'laptop (1280px, light)', query: '?theme=light', size: { width: 1280, height: 900, mobile: false } },
    { name: 'phone (390px, dark)', query: '?theme=dark', size: { width: 390, height: 844, mobile: true } },
  ];
  let failed = 0;
  try {
    for (const run of runs) {
      const { results, errors } = await runChecks(browser.dt, url + run.query, run.size);
      const bad = results.filter(r => !r.ok);
      failed += bad.length + errors.length;
      console.log(`${bad.length || errors.length ? 'FAIL' : 'PASS'} ${run.name}: ${results.length - bad.length} checks passed, ${bad.length} failed, ${errors.length} page errors`);
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
        ['phone-in-out', '?view=msum-open&theme=dark', { width: 390, height: 1200, mobile: true }]]) {
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
