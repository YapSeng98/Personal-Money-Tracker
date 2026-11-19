  // ── Checks ───────────────────────────────────────────────────────────────
  // Runs inside the page after seed.js. ?view= instead opens one screen and
  // stops, for screenshots. Results go into a pre#e2e element as JSON.
  const VIEW = P.get('view') || 'checks';
  setTimeout(async () => {
    if (VIEW === 'fit' || VIEW === 'fuzz' || VIEW === 'health' || VIEW === 'none') return;
    if (VIEW === 'review') { document.getElementById('analytics-chart').closest('.panel').scrollIntoView({ block: 'start' }); return; }
    if (VIEW === 'msum') { document.getElementById('monthly-summary').closest('.panel').scrollIntoView({ block: 'start' }); return; }
    if (VIEW === 'msum-open') { toggleMonthDetail('SGD|' + M1); document.getElementById('monthly-summary').closest('.panel').scrollIntoView({ block: 'start' }); return; }
    if (VIEW === 'accounts') { state.balancesMasked = false; showView('accounts'); return; }
    if (VIEW === 'import') {
      const mo = new Date(+M1.slice(0, 4), +M1.slice(5, 7) - 1, 1).toLocaleDateString('en-GB', { month: 'short' }), y = M1.slice(0, 4);
      showView('transactions'); openImport();
      await loadImportFile({ name: 'DBS statement.csv', text: async () => `Transaction Date,Reference,Debit Amount,Credit Amount,Transaction Ref1,Transaction Ref2\n07 ${mo} ${y},POS,432.00,,DENTAL,CLINIC\n24 ${mo} ${y},POS,23.45,,NETS,FAIRPRICE XTRA\n25 ${mo} ${y},UMC,18.20,,GRAB* A-9X2,SINGAPORE\n26 ${mo} ${y},ICT,,1200.00,SALARY,ACME PTE LTD\n27 ${mo} ${y},POS,9.80,,KOPITIAM,TOA PAYOH` });
      return;
    }
    if (VIEW === 'stmt') { openStatement(M1); return; }
    if (VIEW === 'print') { openStatement(P.get('month') || M1); stmtPrintMode(true); return; }

    const R = [], errors = [];
    window.addEventListener('error', e => errors.push('error: ' + e.message));
    window.addEventListener('unhandledrejection', e => errors.push('rejection: ' + ((e.reason && e.reason.message) || e.reason)));
    const origErr = console.error;
    console.error = (...a) => { errors.push('console.error: ' + a.map(String).join(' ')); origErr.apply(console, a); };
    const ok = (cond, name, detail) => R.push({ ok: !!cond, name, detail: cond ? '' : String(detail === undefined ? '' : detail) });
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const near = (a, b) => Math.abs(a - b) < 0.006;
    const r2 = v => Math.round(v * 100) / 100;
    const parseNum = s => {
      s = String(s).trim();
      if (s === '–' || s === '—' || s === '') return 0;
      const neg = /^\(|^−|^-/.test(s);
      const v = parseFloat(s.replace(/[^0-9.]/g, ''));
      return neg ? -v : v;
    };
    const nav = name => showView(name, document.querySelector(`.nav-item[onclick*="'${name}'"]`));
    const modal = $('#stmt-modal');

    try {
      ok(!/maximum-scale/.test($('meta[name="viewport"]').content), 'layout: pinch-zoom is allowed');
      ok(getComputedStyle($('#sync-badge')).display === 'none', 'layout: no empty sync badge in the top bar when nothing is waiting');
      ok($$('[hidden]').every(el => getComputedStyle(el).display === 'none'), 'layout: everything marked hidden is actually hidden',
         $$('[hidden]').filter(el => getComputedStyle(el).display !== 'none').map(el => el.id || el.className).join());

      // ── Monthly Review: a donut and every category ──────────────────────
      nav('analytics'); await wait(20);
      const mk = state.reviewMonth;
      const box = $('#analytics-chart');
      const secs = $$('.review-cur', box);
      const monthTxns = state.transactions.filter(t => t.date.startsWith(mk));
      const spentCurs = [...new Set(monthTxns.filter(t => t.type === 'expense' && isFlow(t)).map(t => t.currency || state.currency))];
      ok(secs.length === spentCurs.length, 'review: one donut per currency with spending', `${secs.length} vs ${spentCurs.length}`);
      ok(secs[0] && secs[0].dataset.cur === state.currency, 'review: home currency comes first', secs[0] && secs[0].dataset.cur);
      secs.forEach(sec => {
        const cur = sec.dataset.cur;
        const cats = new Set(monthTxns.filter(t => t.type === 'expense' && isFlow(t) && (t.currency || state.currency) === cur).map(t => t.category));
        const rows = $$('.review-row[role="button"]', sec);
        ok(rows.length === cats.size, `review ${cur}: every category spent this month has a row`, `${rows.length} rows vs ${cats.size} categories`);
        ok(rows.every(r => cats.has(r.dataset.cat)), `review ${cur}: the rows are exactly those categories`);
        const tile = curStats(cur, monthTxns, mk).exp;
        ok($('.review-centre b', sec).textContent === fmtWithCur(tile, cur), `review ${cur}: donut total equals the Expenses tile`,
           `${$('.review-centre b', sec).textContent} vs ${fmtWithCur(tile, cur)}`);
        const shareSum = rows.reduce((t, r) => t + (parseInt($('.review-sh', r).textContent, 10) || 0), 0);
        ok(shareSum === 100, `review ${cur}: shares add up to 100%`, shareSum);
        const amts = rows.map(r => parseNum($('.review-amt', r).textContent));
        ok(amts.every((v, i) => i === 0 || v <= amts[i - 1] + 0.001), `review ${cur}: rows run largest first`);
        ok(near(amts.reduce((t, v) => t + v, 0), tile), `review ${cur}: the rows add up to the total`);
        ok($$('.review-seg', sec).length === amts.filter(v => v > 0).length, `review ${cur}: one slice per category with money in it`);
      });
      const sgd = secs.find(s => s.dataset.cur === 'SGD');
      const zero = $$('.review-row.zero', sgd);
      ok(zero.length === 1 && zero[0].dataset.cat === 'Shopping' && /paid back/.test(zero[0].textContent), 'review: a fully paid-back category stays listed as paid back');
      ok(!$$('.review-seg', sgd).some(s => s.dataset.cat === 'Shopping'), 'review: ...and draws no slice');
      const ent = $$('.review-row', sgd).find(r => r.dataset.cat === 'Entertainment');
      ok(ent && $('.review-amt', ent).textContent === fmtWithCur(20, 'SGD'), 'review: a payback bigger than the spend leaves the category at what was spent');
      ok($$('.review-row', sgd).some(r => r.dataset.cat === 'Groceries'), 'review: spending booked to no account (Cash) is still included');
      const sport = $$('.review-row', sgd).find(r => r.dataset.cat === 'Sport');
      ok(sport && $('.review-sh', sport).textContent === '<1%', 'review: a tiny share reads <1%, not 0%', sport && $('.review-sh', sport).textContent);
      const edu = $$('.review-row', sgd).find(r => r.dataset.cat === 'Education');
      ok(edu && $('.review-mini i.over', edu) && /111%/.test(edu.textContent), 'review: an over-budget category shows a red bar at 111%');
      const rental = $$('.review-row', sgd).find(r => r.dataset.cat === 'Rental');
      ok(rental && /No budget/.test(rental.textContent), 'review: a category without a budget says so');

      const healthRow = $$('.review-row', sgd).find(r => r.dataset.cat === 'Health');
      healthRow.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      ok(sgd.classList.contains('is-hl'), 'hover: the other slices dim');
      ok($$('.review-seg.hl', sgd).length === 1 && $('.review-seg.hl', sgd).dataset.cat === 'Health', 'hover: the matching slice lights up');
      ok(/Health/.test($('.review-centre', sgd).textContent) && /17%/.test($('.review-centre', sgd).textContent), 'hover: the centre names the category and its share');
      box.dispatchEvent(new PointerEvent('pointerleave'));
      ok(!sgd.classList.contains('is-hl') && $('.review-centre b', sgd).textContent === fmtWithCur(curStats('SGD', monthTxns, mk).exp, 'SGD'), 'hover: leaving puts the total back');
      $$('.review-seg', sgd).find(s => s.dataset.cat === 'Rental').dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      ok($$('.review-row.hl', sgd).length === 1 && $('.review-row.hl', sgd).dataset.cat === 'Rental', 'hover: pointing at a slice lights its row');
      box.dispatchEvent(new PointerEvent('pointerleave'));

      healthRow.click(); await wait(20);
      ok($('#view-transactions').classList.contains('active') && $('#filter-cat').value === 'Health' && state.filterMonth === mk,
         'click: a row opens that category\'s transactions for the month', `${$('#filter-cat').value} ${state.filterMonth}`);
      nav('analytics'); await wait(20);
      $$('#analytics-chart .review-seg').find(s => s.dataset.cat === 'Food & Drink' && s.dataset.cur === 'MYR')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await wait(20);
      ok($('#view-transactions').classList.contains('active') && $('#filter-cat').value === 'Food & Drink', 'click: a slice opens its transactions too');
      nav('analytics'); await wait(20);
      const row2 = $$('#analytics-chart .review-row').find(r => r.dataset.cat === 'Rental' && r.dataset.cur === 'SGD');
      row2.focus();
      row2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(20);
      ok($('#filter-cat').value === 'Rental', 'keyboard: Enter on a row opens its transactions');
      nav('analytics'); await wait(20);
      reviewMonthShift(-1); await wait(10);
      ok($('#review-month-label').textContent === getMonthLabel(M2) && $$('#analytics-chart .review-cur').length === 2, 'review: the previous month redraws');
      reviewMonthShift(1); await wait(10);

      // ── Statement ───────────────────────────────────────────────────────
      const btn = $$('#view-analytics .review-month-nav button').find(b => /Statement/.test(b.textContent));
      ok(btn, 'statement: Monthly Review has a Statement button');
      btn.click(); await wait(20);
      ok(modal.classList.contains('open'), 'statement: opens from Monthly Review');
      ok($('#stmt-month-label').textContent === getMonthLabel(mk), 'statement: shows the review month', $('#stmt-month-label').textContent);
      const pw = $('.stmt-modal', modal).getBoundingClientRect().width;
      ok(innerWidth > 1100 ? pw > 900 : pw >= innerWidth * 0.9, 'statement: full-width paper, not squeezed to 520px', `${pw} at ${innerWidth}`);
      ok(document.documentElement.scrollWidth <= innerWidth + 1, 'layout: the page never scrolls sideways', `${document.documentElement.scrollWidth} > ${innerWidth}`);
      const paperText = $('#stmt-paper').textContent;
      ok(!/NaN|undefined|Infinity/.test(paperText), 'statement: no NaN, undefined or Infinity anywhere');
      ['Opening balance', 'Closing balance', 'Not linked to an account', 'Wet market', 'Figures in brackets are negative', 'Prepared for', 'Test User']
        .forEach(s => ok(paperText.includes(s), `statement: shows "${s}"`));
      const { byCur } = monthlyInOut([mk]);
      $$('#stmt-paper .stmt-table')[0].querySelectorAll('tbody tr').forEach(tr => {
        const c = [...tr.children].map(td => td.textContent.trim());
        const f = byCur[c[0]] && byCur[c[0]][mk];
        if (!f) return;
        ok(near(parseNum(c[1]), f.inc + f.back + f.xIn), `statement ${c[0]}: money in matches Monthly In & Out`, c[1]);
        ok(near(parseNum(c[2]), f.exp + f.xOut), `statement ${c[0]}: money out matches Monthly In & Out`, c[2]);
        ok(near(parseNum(c[3]), f.inc + f.back + f.xIn - f.exp - f.xOut), `statement ${c[0]}: net matches Monthly In & Out`, c[3]);
      });
      const st = buildStatement(mk);
      st.sections.forEach(s => s.accounts.forEach(x => {
        const later = state.transactions.filter(t => t.account === x.a.name && (t.currency || state.currency) === s.cur && t.date > stmtMonthEnd(mk))
          .reduce((a, t) => a + txnBalanceEffect(t), 0);
        ok(near(x.closing, effectiveBal(x.a) - later), `statement ${x.a.name}: closing = today's balance less later rows`, `${x.closing} vs ${effectiveBal(x.a) - later}`);
        ok(near(x.opening + x.moneyIn - x.moneyOut, x.closing), `statement ${x.a.name}: opening + in − out = closing`);
      }));
      ok(st.sections.map(s => s.cur).join() === 'SGD,MYR,USD', 'statement: home currency first', st.sections.map(s => s.cur).join());

      const navBtns = $$('#stmt-modal .stmt-toolbar .month-nav-btn');
      navBtns[1].click(); await wait(10);
      ok($('#stmt-month-label').textContent === getMonthLabel(M0) && /isn't over yet/.test($('#stmt-paper').textContent), 'statement: next month is this month, flagged as in progress');
      navBtns[0].click(); navBtns[0].click(); await wait(10);
      ok($('#stmt-month-label').textContent === getMonthLabel(M2), 'statement: previous twice goes back two months');
      ok(!/NaN|undefined/.test($('#stmt-paper').textContent), 'statement: that month renders cleanly');
      $('#stmt-paper').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      ok(modal.classList.contains('open'), 'statement: clicking on the paper keeps it open');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      ok(!modal.classList.contains('open'), 'statement: Escape closes it');
      openStatement(mk);
      modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      ok(!modal.classList.contains('open'), 'statement: clicking outside closes it');
      openStatement(mk);
      $('#stmt-modal .modal-close').click();
      ok(!modal.classList.contains('open'), 'statement: the ✕ button closes it');

      openStatement(mk);
      let printed = null;
      const realPrint = window.print, beforeTitle = document.title;
      window.print = () => { printed = { cls: document.body.classList.contains('stmt-printing'), title: document.title }; };
      $$('#stmt-modal .stmt-toolbar button').find(b => /PDF/.test(b.textContent)).click();
      ok(printed && printed.cls && printed.title === 'PFMT Statement ' + mk, 'pdf: prints the statement alone, titled for the file name', JSON.stringify(printed));
      window.dispatchEvent(new Event('afterprint'));
      ok(!document.body.classList.contains('stmt-printing') && document.title === beforeTitle, 'pdf: the app goes back to normal after printing');
      window.print = realPrint;

      // ── Downloads ───────────────────────────────────────────────────────
      const capture = fn => { let got = null; const real = downloadBlob; downloadBlob = (blob, name) => { got = { blob, name }; }; try { fn(); } finally { downloadBlob = real; } return got; };
      const parseLine = l => { const out = []; let cur = '', q = false;
        for (let i = 0; i < l.length; i++) { const c = l[i];
          if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
          else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; }
        out.push(cur); return out; };
      const csvRows = async got => {
        const bytes = new Uint8Array(await got.blob.arrayBuffer());
        return { bom: bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF, rows: new TextDecoder().decode(bytes).split('\r\n').map(parseLine) };
      };
      // Walks every account ledger: each row's balance, every brought-forward
      // balance, every month total and every closing line must agree.
      const ledgerCheck = rows => {
        let open = false, bal = 0, sIn = 0, sOut = 0, mIn = 0, mOut = 0, closings = 0, good = true, forwards = 0, totals = 0;
        rows.forEach(c => {
          const label = c[1];
          if (label === 'Opening balance') { open = true; bal = +c[6]; sIn = sOut = mIn = mOut = 0; return; }
          if (!open) return;
          if (label === 'Balance brought forward') { forwards++; if (!near(bal, +c[6])) good = false; mIn = mOut = 0; return; }
          if (label && label.startsWith('Total for ')) { totals++; if (!near(mIn, +c[4] || 0) || !near(mOut, +c[5] || 0)) good = false; return; }
          if (label === 'Closing balance') { closings++; if (!near(bal, +c[6]) || !near(sIn, +c[4] || 0) || !near(sOut, +c[5] || 0)) good = false; open = false; return; }
          if (/^\d{4}-\d{2}-\d{2}$/.test(c[0])) {
            const i = +c[4] || 0, o = +c[5] || 0;
            bal = Math.round((bal + i - o) * 100) / 100; sIn += i; sOut += o; mIn += i; mOut += o;
            if (!near(bal, +c[6])) good = false;
          }
        });
        return { good, closings, forwards, totals };
      };
      const isZip = async blob => { const u = new Uint8Array(await blob.arrayBuffer()); return u[0] === 0x50 && u[1] === 0x4B && u[2] === 3 && u[3] === 4; };

      const sCsv = capture(() => $$('#stmt-modal .stmt-toolbar button').find(b => /CSV/.test(b.textContent)).click());
      ok(sCsv && sCsv.name === `pfmt_statement_${mk}.csv`, 'statement csv: file named for the month', sCsv && sCsv.name);
      const sc = await csvRows(sCsv);
      ok(sc.bom, 'statement csv: starts with the UTF-8 marker Excel needs');
      ok(sc.rows[1][0] === 'Monthly statement' && sc.rows.some(r => r[0] === 'Period' && r[1].startsWith(fmtDate(mk + '-01'))), 'statement csv: titled, with the period');
      const sl = ledgerCheck(sc.rows);
      ok(sl.closings === 4 && sl.good, 'statement csv: every account runs from opening to closing balance', JSON.stringify(sl));
      ok(sc.rows.some(r => r[0] === mk + '-28' && r[1] === 'Wet market' && r[3] === 'Cash'), 'statement csv: the unbooked Cash row is included');
      const sumRow = sc.rows.find(r => r[0] === 'SGD' && r.length >= 4);
      ok(sumRow && near(+sumRow[3], st.sections[0].net), 'statement csv: summary net matches the statement', sumRow && sumRow[3]);
      ok(sc.rows.some(r => r[0] === 'Spending: Rental' && near(+r[5], 1000)), 'statement csv: spending is broken down by category');
      const sX = capture(() => $$('#stmt-modal .stmt-toolbar button').find(b => /Excel/.test(b.textContent)).click());
      ok(sX && sX.name === `pfmt_statement_${mk}.xlsx` && await isZip(sX.blob), 'statement excel: an .xlsx named for the month');

      // Every CSV download: the UTF-8 marker, and text that looks like a formula stays text.
      state.transactions.unshift({ id: 'csv-f', date: M1 + '-15', type: 'expense', amount: 1, category: 'Other', account: 'DBS Checking', currency: 'SGD', description: '-S$12 refund', notes: '=1+1', created: M1 + '-15 09:00:00' });
      const bytesOf = async got => got ? new Uint8Array(await got.blob.arrayBuffer()) : new Uint8Array();
      const hasBom = b => b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;
      const tBytes = await bytesOf(capture(() => exportCSV()));
      const tText = new TextDecoder().decode(tBytes);
      ok(hasBom(tBytes), 'transactions csv: starts with the UTF-8 marker Excel needs');
      ok(tText.includes(`"'-S$12 refund"`) && tText.includes(`"'=1+1"`) && !/,"[=+@-]/.test(tText.replace(/^\uFEFF/, '')),
         'transactions csv: text that looks like a formula is kept as text', tText.split('\n').find(l => /S\$12/.test(l)));
      ok(hasBom(await bytesOf(capture(() => exportAccountsCSV()))), 'accounts csv: starts with the UTF-8 marker');
      state.transactions = state.transactions.filter(t => t.id !== 'csv-f');

      // Printing: each ledger names its account on every page; page numbers at the foot.
      openStatement(mk);
      const ledgerTables = $$('#stmt-paper .stmt-ledger');
      ok(ledgerTables.length && ledgerTables.every(tb => $('thead .stmt-cap', tb) && getComputedStyle($('thead .stmt-cap', tb)).display === 'none'),
         'pdf: every ledger carries its account name in its table head, hidden on screen');
      ok($$('#stmt-paper .stmt-ledger .stmt-cap th').map(th => th.textContent).some(x => /^DBS Checking.*SGD$/.test(x)), 'pdf: the repeated name says the account and currency',
         $$('#stmt-paper .stmt-cap th').map(th => th.textContent).join(' | '));
      stmtPrintMode(true);
      ok(/counter\(pages\)/.test($('#stmt-page-style').textContent) && $('#stmt-page-style').textContent.includes(getMonthLabel(mk)), 'pdf: page numbers and the statement name at the foot of each page');
      stmtPrintMode(false);
      ok($('#stmt-page-style').textContent === '' && !document.body.classList.contains('stmt-printing'), 'pdf: leaving print mode clears the page footer');

      // The note under Account balances names its causes and adds up.
      const sgdSec = buildStatement(mk).sections.find(x => x.cur === 'SGD');
      ok(sgdSec.gap && /1 transaction not booked to any SGD account/.test($('#stmt-paper').textContent) && $('#stmt-paper').textContent.includes(stmtNum(sgdSec.gap)),
         'statement: the note says exactly why SGD balances and cash flow differ', $$('#stmt-paper .stmt-note').map(p => p.textContent).find(t => /changed by/.test(t)));
      closeStatement();
      closeStatement();

      nav('transactions'); await wait(20);
      state.filterMonth = M2;
      $$('#view-transactions .panel-header button').find(b => /Statement/.test(b.textContent)).click(); await wait(10);
      ok(modal.classList.contains('open') && $('#stmt-month-label').textContent === getMonthLabel(M2), 'statement: opens from Transactions for the month shown there');
      closeStatement();
      state.filterMonth = M1;

      // ── Monthly In & Out ────────────────────────────────────────────────
      nav('analytics'); await wait(20);
      const io = monthlyInOut();
      const blocks = $$('#monthly-summary .msum-block');
      ok(blocks.length === Object.keys(io.byCur).length, 'in & out: one block per currency', blocks.length);
      ok(blocks.map(b => $('.msum-code', b).textContent).join() === 'SGD,MYR,USD', 'in & out: home currency first', blocks.map(b => $('.msum-code', b).textContent).join());
      const heads = blocks.map(b => $$('thead th', b));
      ok(heads.every(h => h.length === heads[0].length), 'in & out: every currency has the same columns', heads.map(h => h.length).join());
      const lefts = heads.map(h => h.map(th => Math.round(th.getBoundingClientRect().left)).join());
      ok(lefts.every(l => l === lefts[0]), 'in & out: columns line up across currencies', JSON.stringify(lefts));
      blocks.forEach(b => {
        const cur = $('.msum-code', b).textContent;
        const k = $$('.msum-kpi b', b).map(x => parseNum(x.textContent));
        const tot = $$('tr.msum-total td', b).map(x => x.textContent.trim());
        ok(near(k[0], parseNum(tot[2])), `in & out ${cur}: headline income equals the total row`, `${k[0]} vs ${tot[2]}`);
        ok(near(k[1], parseNum(tot[3])), `in & out ${cur}: headline spending equals the total row`, `${k[1]} vs ${tot[3]}`);
        ok(near(k[2], parseNum(tot[4])), `in & out ${cur}: headline kept equals the total row`, `${k[2]} vs ${tot[4]}`);
        ok(near(k[3], parseNum(tot[tot.length - 1])), `in & out ${cur}: headline net equals the total row`, `${k[3]} vs ${tot[tot.length - 1]}`);
        const netSum = Object.values(io.byCur[cur]).reduce((t, r) => t + r.inc - r.exp + r.xIn - r.xOut + r.back, 0);
        ok(near(k[3], netSum), `in & out ${cur}: net equals the sum of its months`);
        const widths = $$('.msum-bars i', b).map(i => parseFloat(i.style.width));
        ok(widths.length > 0 && widths.every(w => w > 0 && w <= 100.001), `in & out ${cur}: bars stay inside their column`, widths.join());
        ok($$('tr.msum-row', b).every(tr => $$('.msum-bars > div', tr).every(d => $$('i', d).reduce((t, i) => t + parseFloat(i.style.width), 0) <= 100.01)),
           `in & out ${cur}: a month's in and out bars never overflow`);
        ok(!/NaN|undefined|Infinity/.test(b.textContent), `in & out ${cur}: no NaN, undefined or Infinity`);
      });
      const sgdRow = () => $$('#monthly-summary tr.msum-row').find(r => r.getAttribute('onclick').includes('SGD|' + M1));
      sgdRow().click(); await wait(10);
      const detail = $('#monthly-summary tr.msum-open');
      ok(detail && /Income/.test(detail.textContent) && /Spending/.test(detail.textContent), 'in & out: clicking a month opens its breakdown');
      const sBtn = detail && $$('button', detail).find(b => /Statement for/.test(b.textContent));
      ok(sBtn && sBtn.textContent.includes(getMonthLabel(M1)), 'in & out: the breakdown links to that month\'s statement');
      sBtn.click(); await wait(10);
      ok(modal.classList.contains('open') && $('#stmt-month-label').textContent === getMonthLabel(M1), 'in & out: the link opens that statement');
      closeStatement();
      sgdRow().click(); await wait(10);
      ok(!$('#monthly-summary tr.msum-open'), 'in & out: clicking the month again closes it');
      if (innerWidth <= 600) {
        sgdRow().click(); await wait(10);
        const wrap = $('#monthly-summary .msum-wrap'), tbl = $('table', wrap);
        ok(tbl.scrollWidth <= wrap.clientWidth + 1, 'phone: Monthly In & Out fits without sideways scrolling', `${tbl.scrollWidth} vs ${wrap.clientWidth}`);
        // A phone shows each month as a card: month and net, then income and spending.
        const right = wrap.getBoundingClientRect().right + 1;
        const nets = $$('tr.msum-row > td:last-child, tr.msum-total > td:last-child', wrap);
        ok(nets.length && nets.every(td => td.getBoundingClientRect().right <= right), 'phone: with a month open, every Net sits inside the card',
           nets.map(td => Math.round(td.getBoundingClientRect().right)).join() + ' vs ' + Math.round(right));
        const figures = $$('tr.msum-row > td, tr.msum-total > td', wrap).filter(td => td.offsetParent);
        ok(figures.every(td => td.scrollWidth <= td.clientWidth + 1 && td.getBoundingClientRect().right <= right), 'phone: no month, income, spending or net is cut short',
           figures.filter(td => td.scrollWidth > td.clientWidth + 1).map(td => td.textContent.trim()).join(' | '));
        ok(/Income/.test(getComputedStyle($('tr.msum-row > td:nth-child(3)', wrap), '::before').content), 'phone: each card labels its figures');
        ok($$('tr.msum-row td', wrap).filter(td => getComputedStyle(td).visibility !== 'hidden').every(td => td.scrollWidth <= td.clientWidth + 1),
           'phone: no figure is cut off');
        sgdRow().click(); await wait(10);
      }
      const help = $('.msum-help');
      $('summary', help).click();
      ok(help.open && /Exchanged in \/ out/.test(help.textContent), 'in & out: "How each column is counted" opens');
      $('summary', help).click();
      ok(!help.open, 'in & out: ...and closes again');
      const range = state.trendMonths;
      ok($('#msum-range-note').textContent.includes(`Last ${range} months`), 'in & out: the note names the range');
      setTrendRange(3); await wait(10);
      ok(/Last 3 months/.test($('#msum-range-note').textContent), 'in & out: changing the range updates the note');
      setTrendRange(range); await wait(10);

      const ioPanel = $$('#view-analytics .panel').find(pn => /Monthly In/.test(($('.panel-title', pn) || {}).textContent || ''));
      const ioBtn = re => $$('.panel-header button', ioPanel).find(b => re.test(b.textContent));
      ok(ioBtn(/Excel/) && ioBtn(/CSV/), 'in & out: offers Excel and CSV downloads');
      const keys = summaryMonthKeys(), from = keys[keys.length - 1], to = keys[0];
      const iCsv = capture(() => ioBtn(/CSV/).click());
      ok(iCsv && iCsv.name === `pfmt_money_in_out_${from}_to_${to}.csv`, 'in & out csv: file named for the range', iCsv && iCsv.name);
      const ic = await csvRows(iCsv);
      ok(ic.bom && ic.rows[1][0] === 'Money in and out', 'in & out csv: titled "Money in and out"');
      const il = ledgerCheck(ic.rows);
      ok(il.good && il.closings === 4 && il.forwards >= 2 && il.totals >= 6, 'in & out csv: ledgers carry balances month to month like a bank statement', JSON.stringify(il));
      const hdr = ic.rows.findIndex(r => r[0] === 'SGD by month');
      const sgdMonths = Object.keys(io.byCur.SGD).sort();
      const monthRows = ic.rows.slice(hdr + 2, hdr + 2 + sgdMonths.length);
      ok(hdr > 0 && monthRows.every((r, i) => { const m = io.byCur.SGD[sgdMonths[i]];
        return near(+r[1], m.inc) && near(+r[2], m.exp) && near(+r[7], m.inc - m.exp + m.xIn - m.xOut + m.back); }),
        'in & out csv: every month matches the table on screen');
      const totalRow = ic.rows[hdr + 2 + sgdMonths.length];
      ok(totalRow && totalRow[0] === 'Total' && near(+totalRow[7], sgdMonths.reduce((t, k2) => { const m = io.byCur.SGD[k2]; return t + m.inc - m.exp + m.xIn - m.xOut + m.back; }, 0)),
        'in & out csv: the total row adds the months up');
      ok(ic.rows.some(r => r[0] === M0 + '-02' && r[1] === 'Kopi and toast'), 'in & out csv: this month\'s transactions are in it');
      ok(ic.rows.some(r => r[0] === M2 + '-14' && r[2] === 'Rental'), 'in & out csv: so are earlier months\'');
      const iX = capture(() => ioBtn(/Excel/).click());
      ok(iX && iX.name === `pfmt_money_in_out_${from}_to_${to}.xlsx` && await isZip(iX.blob), 'in & out excel: an .xlsx named for the range');

      // ── Broken pairs: shown, flagged and fixable ────────────────────────
      // The bug report: a pair with no outgoing leg vanished from the month
      // list while search still found it. Three broken shapes go in at once.
      const leg = o => Object.assign({ category: 'Transfer', currency: 'SGD', created: M0 + '-03 10:00:00' }, o);
      state.transactions.push(
        leg({ id: 'ghost-1', date: M0 + '-03', type: 'income', amount: 3000.16, currency: 'MYR', account: 'Maybank', description: 'Monthly Investment MY', transferGroup: 'tg_ghost', transferPeer: 'Maybank' }),
        leg({ id: 'ghost-2', date: M0 + '-03', type: 'asset', amount: 3000.16, currency: 'MYR', account: 'Maybank', description: 'Monthly Investment MY', transferGroup: 'tg_ghost' }),
        leg({ id: 'lone-1', date: M0 + '-04', type: 'income', amount: 80, account: 'OCBC Savings', description: 'Half a transfer', transferGroup: 'tg_lone' }),
        leg({ id: 'same-1', date: M0 + '-05', type: 'expense', amount: 40, account: 'DBS Checking', description: 'Self move', transferGroup: 'tg_same' }),
        leg({ id: 'same-2', date: M0 + '-05', type: 'income', amount: 40, account: 'DBS Checking', description: 'Self move', transferGroup: 'tg_same' }));
      nav('transactions'); await wait(20);
      state.filterMonth = M0;
      ['filter-period', 'filter-cat', 'filter-cur', 'filter-acc', 'search-input'].forEach(id => { const el = $('#' + id); if (el) el.value = ''; });
      $('#filter-type').value = 'transfer';
      renderTransactions();
      const monthList = $('#all-txns').textContent;
      ok(['Monthly Investment MY', 'Half a transfer', 'Self move'].every(d => monthList.includes(d)), 'data check: broken pairs show in the month list instead of vanishing');
      ok($$('#all-txns .pair-warn').length === 5, 'data check: every row of a broken pair is flagged', $$('#all-txns .pair-warn').length);
      ok(/3 transfers need attention/.test($('#data-banner').textContent), 'data check: the banner counts them', $('#data-banner').textContent.trim());
      $('#search-input').value = 'Monthly Investment'; renderTransactions();
      ok($$('#all-txns .txn-row').filter(r => /Monthly Investment MY/.test(r.textContent)).length === 2, 'data check: search shows the same two rows as the list');
      $('#search-input').value = ''; $('#filter-type').value = ''; renderTransactions();
      openStatement(M0);
      ok(/don't form a proper pair/.test($('#stmt-paper').textContent), 'data check: the statement warns while a pair is broken');
      openStatement(M2);
      ok(!/don't form a proper pair/.test($('#stmt-paper').textContent), 'data check: an earlier month\'s statement, which the broken pair can\'t touch, doesn\'t warn');
      closeStatement();
      $('#data-banner button').click(); await wait(10);
      ok($('#datacheck-modal').classList.contains('open') && $$('#datacheck-list .dc-item').length === 3, 'data check: Review lists all three');
      const dcItem = re => $$('#datacheck-list .dc-item').find(i => re.test(i.textContent));
      ok(dcItem(/Self move/) && !/Make separate/.test(dcItem(/Self move/).textContent) && /Edit/.test(dcItem(/Self move/).textContent),
         'data check: a same-account pair offers Edit, not Make separate');
      $$('button', dcItem(/Half a transfer/)).find(b => /Make separate/.test(b.textContent)).click(); await wait(10);
      const loneRow = state.transactions.find(t => t.id === 'lone-1');
      ok(loneRow && !loneRow.transferGroup && pairProblems().length === 2, 'data check: Make separate unlinks the row');
      $$('button', dcItem(/Monthly Investment MY/)).find(b => /Delete/.test(b.textContent)).click(); await wait(10);
      ok(!state.transactions.some(t => t.transferGroup === 'tg_ghost') && pairProblems().length === 1, 'data check: Delete removes both rows of the ghost');
      $$('button', dcItem(/Self move/)).find(b => /Delete/.test(b.textContent)).click(); await wait(10);
      ok(/proper pair/.test($('#datacheck-list').textContent), 'data check: an empty review says everything is a proper pair');
      closeDataCheck();
      state.transactions = state.transactions.filter(t => t.id !== 'lone-1');
      state.filterMonth = M1; renderAll();
      ok(!$('#data-banner').textContent.trim(), 'data check: the banner goes once everything is fixed');

      // Edit repairs each shape it is offered for: open it, say where the
      // money went, save, and it is a proper pair.
      const fixes = [
        ['both leaving', 'tg_fix1', [['expense', 'DBS Checking'], ['expense', 'OCBC Savings']], () => {}],
        ['both arriving', 'tg_fix2', [['income', 'DBS Checking'], ['income', 'OCBC Savings']], () => {}],
        ['same account', 'tg_fix3', [['expense', 'DBS Checking'], ['income', 'DBS Checking']], () => { populateToAccounts('OCBC Savings'); updateTransferUI(); }],
        ['a purchase with its funding marked arriving', 'ag_fix4', [['income', 'OCBC Savings'], ['asset', 'DBS Checking']], () => {}],
      ];
      for (const [shape, g, legsOf, adjust] of fixes) {
        legsOf.forEach(([type, account], i) => state.transactions.push(leg({ id: `${g}-${i}`, date: M1 + '-09', type, amount: 75, account, description: 'Fix me ' + shape,
          category: type === 'asset' ? 'Investment' : 'Transfer', transferGroup: g })));
        const before = { dbs: effectiveBal(state.accounts.find(a => a.name === 'DBS Checking')), ocbc: effectiveBal(state.accounts.find(a => a.name === 'OCBC Savings')) };
        ok(pairProblems().some(p => p.group === g), `data check edit (${shape}): starts broken`);
        dataCheckEdit(g); adjust();
        await saveTransaction(); await wait(10);
        const legs = state.transactions.filter(t => t.transferGroup === g);
        const types = legs.map(l => `${l.type} ${l.account}`).sort().join(', ');
        ok(!pairProblems().some(p => p.group === g) && legs.length === 2, `data check edit (${shape}): saving makes it a proper pair`, types);
        const want = g === 'ag_fix4' ? 'asset DBS Checking, expense OCBC Savings' : 'expense DBS Checking, income OCBC Savings';
        ok(types === want, `data check edit (${shape}): the money goes the way the form said`, types);
        const after = { dbs: effectiveBal(state.accounts.find(a => a.name === 'DBS Checking')), ocbc: effectiveBal(state.accounts.find(a => a.name === 'OCBC Savings')) };
        const moved = [after.dbs - before.dbs, after.ocbc - before.ocbc];
        const expectMoved = { tg_fix1: [0, 150], tg_fix2: [-150, 0], tg_fix3: [-75, 75], ag_fix4: [0, -150] }[g];
        ok(near(moved[0], expectMoved[0]) && near(moved[1], expectMoved[1]), `data check edit (${shape}): balances move by exactly the repair`, moved.join(', '));
        state.transactions = state.transactions.filter(t => t.transferGroup !== g);
      }
      renderAll();

      // The search count is the number of lines it shows: a transfer is one.
      nav('transactions'); state.filterMonth = M1;
      ['filter-period', 'filter-type', 'filter-cat', 'filter-cur', 'filter-acc'].forEach(id => { const el = $('#' + id); if (el) el.value = ''; });
      for (const q of ['SGD to', 'To OCBC', 'a', 'Movie']) {
        $('#search-input').value = q; renderTransactions();
        const said = +(($('.search-summary strong') || {}).textContent || '').replace(/\D/g, '');
        ok(said === $$('#all-txns .txn-row').length && said > 0, `search "${q}": the count is the number of lines shown`, `${said} said, ${$$('#all-txns .txn-row').length} shown`);
      }
      $('#search-input').value = ''; renderTransactions();

      // ── A pair can only be edited as that pair ──────────────────────────
      const tOut = state.transactions.find(t => t.transferGroup === 'tg_1' && t.type === 'expense');
      openTxnModal(tOut.id);
      ok(!$('#tab-transfer').disabled && ['expense', 'income', 'asset', 'payback'].every(k => $('#tab-' + k).disabled),
         'edit: a transfer can only be edited as a transfer');
      setType('expense', $('#tab-expense'));   // as if the lock were bypassed
      await saveTransaction();
      ok(state.transactions.filter(t => t.transferGroup === 'tg_1').length === 2 && tOut.type === 'expense',
         'edit: saving one side of a pair as another type is refused');
      closeTxnModal();
      state.transactions.push(leg({ id: 'ap-1', date: M1 + '-06', type: 'expense', amount: 500, account: 'DBS Checking', description: 'Buy shares', transferGroup: 'ag_lock', transferPeer: 'OCBC Savings' }),
                              leg({ id: 'ap-2', date: M1 + '-06', type: 'asset', amount: 500, account: 'OCBC Savings', description: 'Buy shares', transferGroup: 'ag_lock', transferPeer: 'DBS Checking' }));
      openTxnModal('ap-1');
      ok(!$('#tab-asset').disabled && ['expense', 'income', 'transfer', 'payback'].every(k => $('#tab-' + k).disabled), 'edit: an asset purchase can only be edited as one');
      closeTxnModal();
      const plain = state.transactions.find(t => !t.transferGroup && t.type === 'expense');
      openTxnModal(plain.id);
      ok(['expense', 'income', 'transfer', 'asset', 'payback'].every(k => !$('#tab-' + k).disabled), 'edit: an ordinary row can switch type freely');
      closeTxnModal();
      state.transactions = state.transactions.filter(t => t.transferGroup !== 'ag_lock');

      // ── Descriptions used before ────────────────────────────────────────
      {
        const d = $('#txn-desc'), list = $('#txn-desc-list');
        const enter = () => { d.focus(); d.dispatchEvent(new Event('focus')); };
        const type = s => { d.value = s; d.dispatchEvent(new Event('input', { bubbles: true })); };
        const key = k => { const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }); d.dispatchEvent(e); return e; };
        const open = () => !list.hidden && getComputedStyle(list).display !== 'none';
        const rows = () => $$('.desc-opt', list);
        const names = () => rows().map(r => $('.desc-t', r).textContent);
        const tap = text => { const r = rows().find(x => $('.desc-t', x).textContent === text); const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
                              r.dispatchEvent(md); r.click(); return md.defaultPrevented; };
        state.transactions.push(leg({ id: 'ds-x', date: M1 + '-03', type: 'expense', amount: 7, category: 'Other', description: '<img src=x onerror="window.__dsx=1">Kaya & co' }));

        openTxnModal(); setType('expense', $('#tab-expense'));
        setSelectVal('txn-account', 'OCBC Savings'); onTxnAccountChange(); setSelectVal('txn-cat', 'Health');
        enter();
        ok(open() && rows().length === 5 && d.getAttribute('aria-expanded') === 'true', 'suggest: entering an empty Description offers five used before', names().join(' | '));
        ok(!names().some(n => /salary|Interest|To OCBC|SGD to/.test(n)), 'suggest: ...only spending, no income or transfers', names().join(' | '));
        type('gr');
        ok(names().join() === 'Groceries and meals,MRT and Grab', 'suggest: "gr" offers what starts with it, then what has a word starting with it', names().join(' | '));
        ok(rows()[0].querySelector('.desc-t').innerHTML === '<b>Gr</b>oceries and meals' && rows()[1].querySelector('.desc-t').innerHTML === 'MRT and <b>Gr</b>ab', 'suggest: what was typed is in bold', rows().map(r => r.querySelector('.desc-t').innerHTML).join(' | '));
        ok($('.desc-m', rows()[1]).textContent === '🚇 Transport · S$168.53', 'suggest: each shows its category and the last amount', $('.desc-m', rows()[1]).textContent);
        ok(tap('MRT and Grab'), 'suggest: pressing on one keeps the focus in the box, so the list stays until the tap lands');
        ok(d.value === 'MRT and Grab' && $('#txn-cat').value === 'Transport', 'suggest: tapping one fills the description and its category', `${d.value} / ${$('#txn-cat').value}`);
        ok($('#txn-account').value === 'OCBC Savings' && $('#txn-currency').value === 'SGD', 'suggest: ...and leaves the account you chose alone', $('#txn-account').value);
        ok(!open() && d.getAttribute('aria-expanded') === 'false', 'suggest: the list closes after a pick');
        enter();
        ok(!open(), 'suggest: going back into a box that holds a description used before shows nothing until you type');
        type('kopo');
        ok(names().join() === 'Kopi and toast', 'suggest: one typo still finds it', names().join(' | '));
        type('mo');
        ok(key('ArrowDown').defaultPrevented && rows()[0].classList.contains('active') && d.getAttribute('aria-activedescendant') === rows()[0].id && rows()[0].getAttribute('aria-selected') === 'true',
           'suggest: the down arrow highlights the first, for screen readers too');
        key('ArrowUp'); key('ArrowDown');
        ok(rows()[0].classList.contains('active'), 'suggest: up from the first wraps to the last, down comes back');
        ok(key('Enter').defaultPrevented && d.value === 'Movie' && $('#txn-cat').value === 'Entertainment' && document.activeElement === d, 'suggest: Enter picks the highlighted one and stays in the box', `${d.value} / ${$('#txn-cat').value}`);
        type('kaya');
        ok(names().join() === '<img src=x onerror="window.__dsx=1">Kaya & co' && !$('img', list) && !window.__dsx, 'suggest: a description is shown as text, never run as markup', list.innerHTML);
        type('k');
        key('Escape');
        ok(!open() && $('#txn-modal').classList.contains('open'), 'suggest: Escape closes the list but not the form');
        key('Escape');
        ok(!$('#txn-modal').classList.contains('open'), 'suggest: a second Escape closes the form as before');
        openTxnModal(); type('k');
        d.dispatchEvent(new Event('blur'));
        ok(!open(), 'suggest: leaving the box closes the list');
        type('k'); closeTxnModal(); openTxnModal();
        ok(!open(), 'suggest: closing the form closes the list, and it does not come back on reopening');
        closeTxnModal();

        // Spelled unlike the suggestion it belongs to, so only the editing rule keeps the list shut.
        state.transactions.push(leg({ id: 'ds-y', date: M2 + '-02', type: 'expense', amount: 900, category: 'Rental', account: 'DBS Checking', description: 'room  rent' }));
        openTxnModal('ds-y'); enter();
        ok(!open(), 'suggest: opening a row to edit it offers nothing on entering the box');
        type('ro');
        ok(names()[0] === 'Room rent', 'suggest: ...but typing still does', names().join(' | '));
        closeTxnModal();

        openTxnModal(); setType('income', $('#tab-income')); type('s');
        ok(names().slice(0, 2).join() === 'September salary,August salary' && !names().some(n => /Room|Movie/.test(n)), 'suggest: income offers income, the latest first', names().join(' | '));
        closeTxnModal();

        openTxnModal(); setType('transfer', $('#tab-transfer'));
        setSelectVal('txn-account', 'OCBC Savings'); onTxnAccountChange();
        type('sgd');
        ok(names().join() === 'SGD to MYR,SGD to USD', 'suggest: a transfer offers transfers', names().join(' | '));
        ok($('.desc-m', rows()[1]).textContent === 'DBS Checking → Wise USD · S$135.00', 'suggest: ...showing where from and to', $('.desc-m', rows()[1]).textContent);
        tap('SGD to USD');
        ok($('#txn-account').value === 'DBS Checking' && $('#txn-to-account').value === 'Wise USD', 'suggest: picking a transfer fills both accounts', `${$('#txn-account').value} → ${$('#txn-to-account').value}`);
        ok($('#txn-currency').value === 'SGD' && $('#txn-recv-group').style.display === 'block', 'suggest: ...and the form follows: SGD sent, the USD received box shows');
        closeTxnModal();
        state.transactions = state.transactions.filter(t => t.id !== 'ds-x' && t.id !== 'ds-y');
      }

      // ── What a pair sends to the server ─────────────────────────────────
      state.userId = 'test-user'; window.__sb.calls.length = 0;
      await saveTransferPair({ amt: 50, recvAmt: 50, desc: 'Peer test', cat: 'Transfer', from: 'DBS Checking', to: 'OCBC Savings',
                               fromCur: 'SGD', toCur: 'SGD', date: M0 + '-05', notes: '' });
      const sent = window.__sb.calls.filter(c => c.op === 'upsert').flatMap(c => Array.isArray(c.row) ? c.row : [c.row]).filter(r => r && r.description === 'Peer test');
      ok(sent.length === 2 && sent.find(r => r.type === 'expense').transfer_peer === 'OCBC Savings'
         && sent.find(r => r.type === 'income').transfer_peer === 'DBS Checking', 'sync: a new transfer sends each side\'s other account');
      const u1 = crypto.randomUUID(), u2 = crypto.randomUUID();
      state.transactions.push(leg({ id: u1, date: M1 + '-07', type: 'expense', amount: 9, account: 'DBS Checking', description: 'Old pair', transferGroup: 'tg_old', transferPeer: '' }),
                              leg({ id: u2, date: M1 + '-07', type: 'income', amount: 9, account: 'OCBC Savings', description: 'Old pair', transferGroup: 'tg_old', transferPeer: '' }));
      window.__sb.calls.length = 0;
      ok(fillTransferPeers() >= 2, 'sync: pairs saved without their other account are repaired');
      await flushOutbox();
      const peerFix = window.__sb.calls.filter(c => c.op === 'update' && c.patch && 'transfer_peer' in c.patch);
      ok(peerFix.length >= 2 && peerFix.some(c => c.patch.transfer_peer === 'OCBC Savings'), 'sync: ...and the server is told', JSON.stringify(peerFix.map(c => c.patch)));
      state.userId = null;
      state.transactions = state.transactions.filter(t => t.description !== 'Peer test' && t.transferGroup !== 'tg_old');
      renderAll();

      // ── Never lose a change: the outbox ─────────────────────────────────
      // A reload here is the real load path (snLoadAll) against a fake server
      // holding window.__sb.tables, so "refresh the page" is tested as it runs.
      const keep = { transactions: state.transactions.slice(), accounts: state.accounts.slice(), budgets: state.budgets.slice(),
                     goals: state.goals.slice(), bills: (state.bills || []).slice(), reviewMonth: state.reviewMonth, filterMonth: state.filterMonth };
      fillTransferPeers();   // signed out, so local only: the fake server then holds complete pairs
      const asServer = t => ({ id: String(t.id), user_id: 'test-user', type: t.type, amount: t.amount, description: t.description,
        category: t.category, account: t.account, date: t.date, notes: t.notes || '', currency: t.currency,
        transfer_group: t.transferGroup || null, transfer_peer: t.transferPeer || null, created_at: '2026-01-01T00:00:00Z' });
      const server = window.__sb.tables = { transactions: state.transactions.map(asServer), accounts: [], budgets: [], goals: [], bills: [], preferences: [], backups: [] };
      const reload = async () => { await snLoadAll(); renderAll(); };
      const addViaForm = async (desc, amount) => {
        openTxnModal(); setType('expense', $('#tab-expense'));
        $('#txn-amount').value = String(amount); $('#txn-desc').value = desc; $('#txn-date').value = M1 + '-20';
        setSelectVal('txn-account', 'DBS Checking'); $('#txn-currency').value = 'SGD'; setSelectVal('txn-cat', 'Food & Drink');
        await saveTransaction(); await wait(20);
        return state.transactions.find(t => t.description === desc);
      };
      state.userId = 'test-user'; state.outbox = []; state.outboxRejected = [];
      state.accounts = keep.accounts;

      window.__sb.failWrites = true;
      const offline = await addViaForm('Offline lunch', 12.34);
      ok(offline && outbox().length === 1 && outbox()[0].kind === 'upsert', 'outbox: a change made offline is kept and queued', JSON.stringify(outbox().map(o => o.kind)));
      ok(!$('#sync-badge').hidden && getComputedStyle($('#sync-badge')).display !== 'none' && /1 not synced/.test($('#sync-badge').textContent), 'outbox: the badge shows, saying one change is waiting', $('#sync-badge').textContent);
      nav('transactions'); state.filterMonth = M1;
      ['filter-period', 'filter-type', 'filter-cat', 'filter-cur', 'filter-acc', 'search-input'].forEach(id => { const el = $('#' + id); if (el) el.value = ''; });
      renderTransactions();
      ok($$('#all-txns .txn-row').some(r => /Offline lunch/.test(r.textContent) && /Not synced/.test(r.textContent)), 'outbox: the row itself is marked not synced');
      state.accounts = []; await reload(); state.accounts = keep.accounts;
      ok(state.transactions.some(t => t.id === offline.id), 'outbox: it survives a reload that replaces everything with the server copy');
      ok(state.transactions.length === server.transactions.length + 1, 'outbox: ...and every other row comes from the server', `${state.transactions.length} vs ${server.transactions.length + 1}`);
      window.__sb.failWrites = false; window.__sb.calls.length = 0;
      await flushOutbox();
      const ups = window.__sb.calls.filter(c => c.op === 'upsert' && c.row && c.row.id === offline.id);
      ok(ups.length === 1 && outbox().length === 0, 'outbox: back online, it is sent exactly once', ups.length);
      ok($('#sync-badge').hidden && getComputedStyle($('#sync-badge')).display === 'none', 'outbox: the badge clears, and is really gone from the screen');
      server.transactions.push(asServer(offline));

      window.__sb.failWrites = true;
      openTxnModal(offline.id); $('#txn-amount').value = '15'; await saveTransaction(); await wait(20);
      ok(outbox().length === 1 && outbox()[0].kind === 'update', 'outbox: an edit made offline is queued');
      window.__sb.failWrites = false; window.__sb.calls.length = 0;
      window.dispatchEvent(new Event('online')); await wait(50); await flushOutbox();
      ok(window.__sb.calls.some(c => c.op === 'update' && c.patch && c.patch.amount === 15) && outbox().length === 0, 'outbox: coming back online sends what was waiting');

      deleteTransaction(offline.id); await wait(10); $('#confirm-ok-btn').click(); await wait(20);
      ok(!state.transactions.some(t => t.id === offline.id) && outbox().some(o => o.kind === 'delete' && o.rowId === offline.id && o.notBefore > Date.now()),
         'delete: queued at once, to be sent when the undo window ends');
      state.accounts = []; await reload(); state.accounts = keep.accounts;
      ok(!state.transactions.some(t => t.id === offline.id), 'delete: refreshing inside the undo window doesn\'t bring the row back');
      outbox().forEach(o => { o.notBefore = 0; }); window.__sb.calls.length = 0;
      await flushOutbox();
      ok(window.__sb.calls.filter(c => c.op === 'delete').length === 1 && outbox().length === 0, 'delete: then it reaches the server, once');
      server.transactions = server.transactions.filter(t => t.id !== offline.id); window.__sb.tables = server;

      const undoMe = await addViaForm('Undo me', 7);
      server.transactions.push(asServer(undoMe));
      deleteTransaction(undoMe.id); await wait(10); $('#confirm-ok-btn').click(); await wait(20);
      _runPendingUndo(); window.__sb.calls.length = 0; await flushOutbox();
      ok(state.transactions.some(t => t.id === undoMe.id) && !outbox().some(o => o.kind === 'delete') && !window.__sb.calls.some(c => c.op === 'delete'),
         'undo: brings the row back and cancels the queued delete');

      window.__sb.failWith = { code: '23514', message: 'new row violates check constraint "transactions_currency_check"' };
      await addViaForm('Refused row', 9); await flushOutbox();
      ok(rejectedWrites().length === 1 && $('#sync-badge').classList.contains('bad') && /not saved/.test($('#sync-badge').textContent),
         'refused: a change the server refuses is kept and flagged', $('#sync-badge').textContent);
      $('#sync-badge').click(); await wait(10);
      ok($('#syncprob-modal').classList.contains('open') && /currency_check/.test($('#syncprob-list').textContent), 'refused: the dialog gives the server\'s reason');
      window.__sb.failWith = null;
      $$('#syncprob-list button').find(b => /Try again/.test(b.textContent)).click(); await wait(30); await flushOutbox();
      ok(rejectedWrites().length === 0 && outbox().length === 0, 'refused: Try again sends it once the problem is fixed');
      closeSyncProblems();
      window.__sb.failWith = { code: '23514', message: 'refused again' };
      await addViaForm('Discard me', 3); await flushOutbox();
      $('#sync-badge').click(); await wait(10);
      $$('#syncprob-list button').find(b => /Discard/.test(b.textContent)).click(); await wait(50);
      ok(!state.transactions.some(t => t.description === 'Discard me') && rejectedWrites().length === 0 && $('#sync-badge').hidden,
         'refused: Discard goes back to the server copy');

      window.__sb.failWith = null; window.__sb.failWrites = false; window.__sb.tables = {};
      state.userId = null; state.outbox = []; state.outboxRejected = [];
      Object.assign(state, keep);
      renderAll();

      // ── USDT and crypto accounts ────────────────────────────────────────
      ok(['txn-currency', 'budget-currency', 'bill-currency', 'goal-currency', 'acc-currency', 'sp-currency', 'currency-select']
           .every(id => $('#' + id) && [...$('#' + id).options].some(o => (o.value || o.textContent) === 'USDT')), 'usdt: every currency picker offers USDT');
      ok(fmtWithCur(1234.5, 'USDT') === 'USDT 1,234.50' && fmtSigned(-3, 'USDT') === '-USDT 3.00', 'usdt: amounts read "USDT 1,234.50"', fmtWithCur(1234.5, 'USDT'));
      ok(fmtWithCur(5, 'XYZ') === 'XYZ 5.00', 'usdt: any other code gets a space before the amount too');
      openAccountModal();
      $('#acc-name').value = 'OKX Wallet'; $('#acc-balance').value = '0'; $('#acc-currency').value = 'USDT';
      await saveAccount();
      const okx = state.accounts.find(a => a.name === 'OKX Wallet');
      ok(okx && okx.currency === 'USDT', 'usdt: a USDT account can be created');
      // A Crypto account type: a new one defaults to USDT and gets a coin icon.
      openAccountModal();
      ok([...$('#acc-type').options].some(o => o.textContent === 'Crypto'), 'crypto: the account type picker offers Crypto');
      $('#acc-type').value = 'Crypto'; $('#acc-type').dispatchEvent(new Event('change'));
      ok($('#acc-currency').value === 'USDT' && /Binance/.test($('#acc-institution').placeholder), 'crypto: picking Crypto for a new account sets USDT', $('#acc-currency').value);
      $('#acc-name').value = 'Binance Spot'; $('#acc-balance').value = '250'; $('#acc-institution').value = 'Binance';
      await saveAccount();
      const bnb = state.accounts.find(a => a.name === 'Binance Spot');
      ok(bnb && bnb.type === 'Crypto' && bnb.currency === 'USDT' && bnb.icon === '🪙', 'crypto: saved as a USDT Crypto account with a coin icon', bnb && [bnb.type, bnb.currency, bnb.icon].join());
      openTxnModal();
      ok([...$('#txn-account').options].some(o => o.textContent.trim() === '🪙 Binance Spot'), 'crypto: it shows with its coin in the account picker');
      closeTxnModal();
      openAccountModal(state.accounts.find(a => a.name === 'DBS Checking').id);
      $('#acc-type').value = 'Crypto'; $('#acc-type').dispatchEvent(new Event('change'));
      ok($('#acc-currency').value === 'SGD', 'crypto: switching an existing account to Crypto leaves its currency alone', $('#acc-currency').value);
      $('#account-modal').classList.remove('open');
      state.accounts = state.accounts.filter(a => a.name !== 'Binance Spot');
      if (bnb) state.outbox = (state.outbox || []).filter(o => o.rowId !== String(bnb.id));
      openTxnModal(); setType('transfer', $('#tab-transfer'));
      setSelectVal('txn-account', 'DBS Checking'); $('#txn-currency').value = 'SGD';
      $('#txn-amount').value = '135'; $('#txn-desc').value = 'Buy USDT'; $('#txn-date').value = M0 + '-06';
      populateToAccounts('OKX Wallet'); updateTransferUI(); $('#txn-amount-recv').value = '100';
      await saveTransaction(); await wait(20);
      const buy = state.transactions.filter(t => t.description === 'Buy USDT');
      const bOut = buy.find(t => t.type === 'expense'), bIn = buy.find(t => t.type === 'income');
      ok(buy.length === 2 && bOut.currency === 'SGD' && bOut.amount === 135 && bIn.currency === 'USDT' && bIn.amount === 100,
         'usdt: buying USDT with SGD is saved as a cross-currency transfer', JSON.stringify(buy.map(t => [t.type, t.amount, t.currency])));
      ok(near(effectiveBal(okx), 100), 'usdt: the wallet holds 100 USDT', effectiveBal(okx));
      openStatement(M0);
      ok(/Tether \(USDT\)/.test($('#stmt-paper').textContent) && /OKX Wallet/.test($('#stmt-paper').textContent), 'usdt: the statement has a USDT section with the wallet');
      closeStatement();
      nav('analytics'); await wait(10);
      ok($$('#monthly-summary .msum-code').some(c => c.textContent === 'USDT'), 'usdt: Monthly In & Out shows USDT on its own');

      // Switching an existing account (say BingX, kept in USD) to USDT.
      const accId = crypto.randomUUID(), uA = crypto.randomUUID(), uB = crypto.randomUUID();
      state.accounts.push({ id: accId, name: 'BingX Old', type: 'Savings', institution: 'BingX', balance: 0, currency: 'USD', icon: '💳' });
      state.transactions.push(leg({ id: uA, date: M1 + '-10', type: 'income', amount: 300, currency: 'USD', account: 'BingX Old', description: 'Deposit', category: 'Investment' }),
                              leg({ id: uB, date: M1 + '-12', type: 'expense', amount: 95.92, currency: 'USD', account: 'BingX Old', description: 'Fee', category: 'Other' }));
      const bxBefore = effectiveBal(state.accounts.find(a => a.id === accId));
      state.userId = 'test-user'; state.outbox = []; window.__sb.calls.length = 0;
      openAccountModal(accId); $('#acc-currency').value = 'USDT';
      let saving = saveAccount(); await wait(10);
      ok($('#confirm-modal').classList.contains('open') && /2 transactions/.test($('#confirm-msg').textContent), 'account: switching to USDT asks to relabel its transactions');
      confirmResolve(false); await saving;
      ok(state.accounts.find(a => a.id === accId).currency === 'USD', 'account: saying no leaves the account as it was');
      openAccountModal(accId); $('#acc-currency').value = 'USDT';
      saving = saveAccount(); await wait(10);
      $('#confirm-ok-btn').click(); await saving; await flushOutbox();
      const bx = state.accounts.find(a => a.id === accId);
      ok(bx.currency === 'USDT' && state.transactions.filter(t => t.account === 'BingX Old').every(t => t.currency === 'USDT'), 'account: its transactions move to USDT with it');
      ok(near(effectiveBal(bx), bxBefore), 'account: the balance carries over unchanged', `${effectiveBal(bx)} vs ${bxBefore}`);
      ok(window.__sb.calls.filter(c => c.op === 'update' && c.patch && c.patch.currency === 'USDT').length >= 2, 'account: ...and the server is told about every row');
      openAccountModal(accId); $('#acc-name').value = 'BingX Main'; window.__sb.calls.length = 0;
      await saveAccount(); await flushOutbox();
      ok(state.transactions.filter(t => t.account === 'BingX Main').length === 2 && near(effectiveBal(state.accounts.find(a => a.id === accId)), bxBefore),
         'account: renaming keeps its history and balance');
      ok(window.__sb.calls.filter(c => c.op === 'update' && c.patch && c.patch.account === 'BingX Main').length === 2,
         'account: ...on the server too (a rename used to change this device only)');
      state.userId = null; state.outbox = [];
      state.accounts = state.accounts.filter(a => a.id !== accId && a.name !== 'OKX Wallet');
      state.transactions = state.transactions.filter(t => t.account !== 'BingX Main' && t.description !== 'Buy USDT');
      renderAll();

      // ── Net worth over time (Accounts) ──────────────────────────────────
      state.balancesMasked = true; nav('accounts'); await wait(20);
      const nwCurs = $$('#networth-body .nw-cur .review-code').map(c => c.textContent);
      ok(nwCurs.join() === 'SGD,MYR,USD', 'net worth: one chart per currency, home currency first', nwCurs.join());
      ok($$('#networth-body .nw-total').every(b => b.textContent === '••••••') && !$$('#networth-body .nw-axis').some(t => /\d{3}/.test(t.textContent) && /\$|RM/.test(t.textContent)),
         'net worth: hidden balances stay hidden — no totals and no axis amounts');
      state.balancesMasked = false; renderAll(); await wait(20);
      const later = (a, cur) => state.transactions.filter(t => t.account === a.name && (t.currency || state.currency) === cur && t.date > stmtMonthEnd(M0)).reduce((s2, t) => s2 + txnBalanceEffect(t), 0);
      ['SGD', 'MYR', 'USD'].forEach(cur => {
        const want = state.accounts.filter(a => a.currency === cur).reduce((s2, a) => s2 + effectiveBal(a) - later(a, cur), 0);
        const sec = $$('#networth-body .nw-cur').find(x => $('.review-code', x).textContent === cur);
        ok(sec && $('.nw-total', sec).textContent === fmtSigned(Math.round(want * 100) / 100, cur), `net worth ${cur}: the headline is today's balances added up`, sec && $('.nw-total', sec).textContent + ' vs ' + fmtSigned(want, cur));
      });
      const sgdChart = $('#networth-body .nw-chart[data-cur="SGD"]');
      const monthLabels = $$('text.nw-axis[text-anchor="middle"]', sgdChart).map(t => t.textContent);
      const thisMonth = new Date(+M0.slice(0, 4), +M0.slice(5, 7) - 1, 1).toLocaleDateString('en-SG', { month: 'short' });
      ok(sgdChart && $('.nw-line', sgdChart).getAttribute('d').split('L').length === 12 && monthLabels.length >= 6 && monthLabels[monthLabels.length - 1] === thisMonth,
         'net worth: twelve month ends on the line, months labelled (every other one when narrow), this month always', monthLabels.join());
      const labelBoxes = $$('text.nw-axis[text-anchor="middle"]', sgdChart).map(t => t.getBoundingClientRect());
      ok(labelBoxes.every((r, i) => i === 0 || r.left >= labelBoxes[i - 1].right), 'net worth: month labels never overlap');
      const svgBox = $('svg', sgdChart).getBoundingClientRect();
      $('svg', sgdChart).dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: svgBox.right - 14, clientY: svgBox.top + 40 }));
      const tipText = $('.nw-tip', sgdChart).textContent;
      ok(!$('.nw-tip', sgdChart).hidden && tipText.includes(getMonthLabel(M0)) && /DBS Checking/.test(tipText), 'net worth: pointing at the chart shows that month with each account', tipText.slice(0, 120));
      sgdChart.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      ok($('.nw-tip', sgdChart).textContent.includes(getMonthLabel(M1)), 'net worth: the arrow keys step through the months');
      $('svg', sgdChart).dispatchEvent(new PointerEvent('pointerleave'));
      ok($('.nw-tip', sgdChart).hidden, 'net worth: the tooltip goes when the pointer leaves');
      ok($$('#networth-body .nw-cur')[0].querySelectorAll('.nw-table tbody tr').length === 12, 'net worth: the same numbers are there as a table');
      ok(sgdChart.getBoundingClientRect().right <= innerWidth + 1 && $('.nw-tip', sgdChart).offsetLeft >= 0, 'net worth: the chart and its tooltip stay on screen');

      // ── My Accounts summary: one aligned table across currencies ────────
      state.balancesMasked = false;
      state.accounts.push({ id: 'cc-myr', name: 'Maybank Card', type: 'Credit Card', institution: 'Maybank', balance: -350, currency: 'MYR', icon: '💳' });
      renderAccounts(); await wait(10);
      const sumRows = $$('#accounts-list .acc-sum-row:not(.acc-sum-hd)');
      const curs = sumRows.map(r => $('.acc-sum-cur', r).textContent);
      ok(curs[0] === state.currency && curs.slice(1).join() === curs.slice(1).sort().join(), 'accounts summary: home currency first, then the rest A to Z', curs.join());
      ok($$('#accounts-list .acc-sum-hd').length === 1, 'accounts summary: the column names appear once, not on every currency');
      const usdRow = sumRows.find(r => /USD/.test($('.acc-sum-cur', r).textContent));
      ok(usdRow && $('.acc-sum-cell:nth-child(3) .acc-sum-v', usdRow).classList.contains('zero'), 'accounts summary: nothing owed reads muted, not red');
      const myrRow = sumRows.find(r => $('.acc-sum-cur', r).textContent === 'MYR');
      ok(myrRow && myrRow.classList.contains('has-debt') && /350\.00/.test($('.acc-sum-cell:nth-child(3)', myrRow).textContent), 'accounts summary: a card balance counts as debt', myrRow && myrRow.textContent.replace(/\s+/g, ' '));
      // Wide enough for the table (the header shows all three columns), or the compact lines.
      const tableLayout = getComputedStyle($('#accounts-list .acc-sum-hd').children[1]).display !== 'none';
      if (tableLayout) {
        const rightOf = (r, n) => Math.round($(`.acc-sum-cell:nth-child(${n})`, r).getBoundingClientRect().right);
        ok([2, 3, 4].every(n => new Set(sumRows.map(r => rightOf(r, n))).size === 1), 'accounts summary: every amount lines up with the one above it',
           [2, 3, 4].map(n => sumRows.map(r => rightOf(r, n)).join('/')).join(' · '));
      } else {
        const shown = r => $$('.acc-sum-cell[data-l]', r).filter(c => getComputedStyle(c).display !== 'none').length;
        ok(shown(myrRow) === 2 && sumRows.filter(r => !r.classList.contains('has-debt')).every(r => shown(r) === 0),
           'accounts summary, compact: a currency shows assets and debt only when something is owed', sumRows.map(shown).join());
        ok(sumRows.every(r => r.scrollWidth <= r.clientWidth + 1), 'accounts summary, compact: every line fits');
        const hd = $('#accounts-list .acc-sum-hd');
        ok(hd && [...hd.children].filter(c => getComputedStyle(c).display !== 'none').map(c => c.textContent).join('|') === '|' + t('acc_net_worth'),
           'accounts summary, compact: it says its figure is net worth', hd && hd.textContent);
      }
      ok(innerWidth > 600 || !tableLayout, 'phone: the accounts summary uses the compact lines');
      state.accounts = state.accounts.filter(a => a.id !== 'cc-myr');
      renderAccounts();
      state.balancesMasked = true;

      // ── Import a bank statement (CSV) ───────────────────────────────────
      const mon = mk => new Date(+mk.slice(0, 4), +mk.slice(5, 7) - 1, 1).toLocaleDateString('en-GB', { month: 'short' });
      const yr = M1.slice(0, 4);
      const csv = `Account Details For:,DBS Checking 123-45678-9\nStatement as at:,28 ${mon(M1)} ${yr}\n\n`
        + `Transaction Date,Reference,Debit Amount,Credit Amount,Transaction Ref1,Transaction Ref2,Transaction Ref3\n`
        + `07 ${mon(M1)} ${yr},POS,432.00,,DENTAL,CLINIC,\n`
        + `24 ${mon(M1)} ${yr},POS,23.45,,NETS,FAIRPRICE XTRA,\n`
        + `25 ${mon(M1)} ${yr},UMC,18.20,,GRAB* A-9X2,SINGAPORE,\n`
        + `26 ${mon(M1)} ${yr},ICT,,1200.00,SALARY,ACME PTE LTD,BONUS\n`;
      const fileOf = (text, name) => ({ name, text: async () => text });
      nav('transactions'); await wait(10);
      $$('#view-transactions .panel-header button').find(b => /Import/.test(b.textContent)).click(); await wait(10);
      ok($('#import-modal').classList.contains('open') && /CSV/.test($('#imp-body').textContent), 'import: the button opens the importer');
      await loadImportFile(fileOf('just,some\nwords,here\n', 'notes.csv'));
      ok(/No table of dated rows/.test($('#imp-body').textContent), 'import: a file with no dated rows says so plainly');
      state.userId = 'test-user'; state.outbox = []; window.__sb.calls.length = 0;
      await loadImportFile(fileOf(csv, 'DBS statement Oct.csv'));
      ok($('#imp-account').value === 'DBS Checking', 'import: the account is guessed from the file name', $('#imp-account').value);
      ok(/4 rows/.test($('.imp-summary').textContent) && /3 to add/.test($('.imp-summary').textContent) && /1 already in your book/.test($('.imp-summary').textContent),
         'import: four rows read, the one already recorded is left out', $('.imp-summary').textContent);
      const impRows = $$('.imp-table tbody tr');
      const rowOf = re => impRows.find(r => re.test(r.textContent));
      ok(rowOf(/DENTAL/) && !$('input[type=checkbox]', rowOf(/DENTAL/)).checked && /Already in your book/.test(rowOf(/DENTAL/).textContent), 'import: the duplicate is unticked and says what it matches');
      ok($('.imp-cat', rowOf(/GRAB/)).value === 'Transport' && $('.imp-cat', rowOf(/SALARY/)).value === 'Salary' && $('.imp-cat', rowOf(/FAIRPRICE/)).value === 'Groceries',
         'import: categories come from the book and from keywords', [$('.imp-cat', rowOf(/GRAB/)).value, $('.imp-cat', rowOf(/SALARY/)).value, $('.imp-cat', rowOf(/FAIRPRICE/)).value].join());
      ok(/1,200\.00/.test(rowOf(/SALARY/).textContent) && rowOf(/SALARY/).children[4].textContent.trim() !== '', 'import: a credit lands in money in');
      const groc = $('.imp-cat', rowOf(/FAIRPRICE/)); groc.value = 'Food & Drink'; groc.dispatchEvent(new Event('change'));
      ok($('.imp-cat', $$('.imp-table tbody tr').find(r => /FAIRPRICE/.test(r.textContent))).value === 'Food & Drink', 'import: a category you change is kept');
      ok(document.documentElement.scrollWidth <= innerWidth + 1, 'import: the dialog fits the screen');
      ok(!$('.imp-cols').open && /Transaction Date/.test($('.imp-cols summary').textContent) && /Debit Amount \/ Credit Amount/.test($('.imp-cols summary').textContent),
         'import: when every column is found, the column choices fold into one line that names them', $('.imp-cols summary').textContent);
      ok($('.imp-table-wrap').scrollWidth <= $('.imp-table-wrap').clientWidth + 1, 'import: the rows fit without scrolling sideways',
         $('.imp-table-wrap').scrollWidth + ' > ' + $('.imp-table-wrap').clientWidth);
      ok(parseFloat(getComputedStyle($('.imp-cat')).paddingRight) >= 24, 'import: the category name has room beside its arrow');
      ok(getComputedStyle($('.imp-table th.n')).fontFamily === getComputedStyle($$('.imp-table th')[1]).fontFamily, 'import: every column heading uses the same font');
      $('#imp-go').click(); await wait(20); await flushOutbox();
      const added = state.transactions.filter(t => /^Imported from DBS statement/.test(t.notes || ''));
      ok(added.length === 3 && added.every(t => t.account === 'DBS Checking' && t.currency === 'SGD') && added.find(t => /FAIRPRICE/.test(t.description)).category === 'Food & Drink',
         'import: three transactions added to the account, with the chosen categories', added.length);
      const batches = window.__sb.calls.filter(c => c.op === 'upsert' && Array.isArray(c.row));
      ok(batches.length === 1 && batches[0].row.length === 3, 'import: they reach the server in one request', JSON.stringify(window.__sb.calls.map(c => c.op)));
      ok(Object.values(state.importPrefs || {}).some(p => p.account === 'DBS Checking'), 'import: the column choices are remembered for this bank');
      window.__sb.calls.length = 0;
      _runPendingUndo(); await flushOutbox();
      ok(!state.transactions.some(t => /^Imported from DBS statement/.test(t.notes || '')) && window.__sb.calls.filter(c => c.op === 'delete').length === 3,
         'import: Undo removes all three, on the server too');
      openImport(); await loadImportFile(fileOf(csv, 'DBS statement Oct.csv'));
      $('#imp-go').click(); await wait(20); await flushOutbox();
      openImport(); await loadImportFile(fileOf(csv, 'DBS statement Oct.csv'));
      ok(/0 to add/.test($('.imp-summary').textContent) && /4 already in your book/.test($('.imp-summary').textContent) && $('#imp-go').disabled,
         'import: importing the same file again adds nothing', $('.imp-summary').textContent);
      await loadImportFile(fileOf(`Date,Details\n07 ${mon(M1)} ${yr},COFFEE\n24 ${mon(M1)} ${yr},TEA\n`, 'no amounts.csv'));
      ok($('.imp-cols') && $('.imp-cols').open && /weren’t found/.test($('.imp-cols summary').textContent) && $('#imp-go').disabled,
         'import: when a column is missing, the column choices open and nothing can be added', $('#imp-body').textContent.slice(0, 120));
      closeImport();
      state.transactions = state.transactions.filter(t => !/^Imported from/.test(t.notes || ''));
      state.userId = null; state.outbox = []; state.importPrefs = {};
      renderAll();

      // ── Only the open page draws; the others catch up when opened ───────
      nav('dashboard'); await wait(10);
      const realRT = renderTransactions;
      let drawnTxns = 0;
      renderTransactions = (...a) => { drawnTxns++; return realRT(...a); };
      renderAll();
      ok(drawnTxns === 0, 'speed: a change redraws only the page on screen');
      state.transactions.unshift({ id: 'fresh-1', date: M1 + '-15', type: 'expense', category: 'Other', amount: 1.23, currency: 'SGD',
                                   account: 'DBS Checking', description: 'Drawn on open', created: M1 + '-15 23:59:59' });
      renderAll();
      state.filterMonth = M1;
      ['filter-period', 'filter-type', 'filter-cat', 'filter-cur', 'filter-acc', 'search-input'].forEach(id => { const el = $('#' + id); if (el) el.value = ''; });
      nav('transactions'); await wait(10);
      ok(drawnTxns === 1 && $('#all-txns').textContent.includes('Drawn on open'), 'speed: a hidden page is up to date the moment it is opened', drawnTxns);
      renderTransactions = realRT;
      state.transactions = state.transactions.filter(t => t.id !== 'fresh-1');
      const pairLegs = state.transactions.filter(t => t.transferGroup === 'tg_1');
      ok(!isCrossCurrencyLeg(pairLegs[0]), 'speed: the transfer index answers from its cache');
      pairLegs[1].currency = 'MYR'; renderAll();
      ok(isCrossCurrencyLeg(pairLegs[0]), 'speed: ...and never with a stale answer after an edit');
      pairLegs[1].currency = 'SGD'; renderAll();

      // ── App Lock ────────────────────────────────────────────────────────
      $('#applock-pin').value = '4321'; $('#applock-pin-confirm').value = '4321';
      await saveAppLockPin();
      ok(state.appLockEnabled && state.appLockPinHash.indexOf('pbkdf2$') === 0, 'app lock: a new PIN is stored salted, not as a bare hash');
      const unlock = async pin => { $('#pin-lock-input').value = pin; await submitPinUnlock(); return $('#pin-lock-err').textContent; };
      ok(/Incorrect/.test(await unlock('0000')), 'app lock: a wrong PIN is refused');
      ok((await unlock('4321')) === '', 'app lock: the right PIN unlocks');
      for (let i = 0; i < 5; i++) await unlock('1111');
      ok(/Wait/.test(await unlock('4321')), 'app lock: after five wrong tries even the right PIN has to wait');
      _pinWaitUntil = 0; _pinFails = 0;
      state.appLockPinHash = await sha256Hex('2468');
      ok((await unlock('2468')) === '' && state.appLockPinHash.indexOf('pbkdf2$') === 0, 'app lock: a PIN stored the old way unlocks, and is re-stored salted');
      turnOffAppLock();

      // ── Every page still renders, in both languages ─────────────────────
      ['dashboard', 'transactions', 'budgets', 'bills', 'goals', 'analytics', 'accounts', 'settings'].forEach(v => {
        try { nav(v); ok($('#view-' + v).classList.contains('active'), `page: ${v} opens`); }
        catch (e) { ok(false, `page: ${v} opens`, e.message); }
      });
      nav('analytics');
      state.language = 'zh'; applyLanguage(); renderAll(); nav('analytics'); await wait(10);
      ok(/类别/.test($('#analytics-chart').textContent) && /预算/.test($('#analytics-chart').textContent), 'zh: breakdown headers are translated');
      ok(!/undefined|NaN/.test($('#analytics-chart').textContent + $('#monthly-summary').textContent), 'zh: no undefined or NaN');
      openStatement(mk); ok(!/undefined|NaN/.test($('#stmt-paper').textContent), 'zh: the statement renders'); closeStatement();
      state.language = 'en'; applyLanguage(); renderAll(); nav('analytics');

      // ── Arrange accounts ────────────────────────────────────────────────
      {
        const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222';
        state.accounts.push({ id: U1, name: 'Arrange One', type: 'Savings', institution: '', balance: 10, currency: 'SGD', icon: '🏦' },
                            { id: U2, name: 'Arrange Two', type: 'Savings', institution: '', balance: 20, currency: 'SGD', icon: '🏦' });
        state.balancesMasked = false; nav('accounts'); renderAccounts();
        const sgd = () => state.accounts.filter(a => a.currency === 'SGD').map(a => a.name);
        const listedSgd = () => $$('#accounts-list .account-name').map(e => e.textContent).filter(n => sgd().includes(n));
        const mv = (name, dir) => { const a = state.accounts.find(x => x.name === name); return $(`#accounts-list [data-move="${a.id}:${dir}"]`); };
        ok($('#acc-arrange-btn') && /Arrange/.test($('#acc-arrange-btn').textContent) && !$('#accounts-list .acc-move'), 'arrange: My Accounts has an Arrange button, and no move buttons until it is pressed');
        $('#acc-arrange-btn').click();
        ok($('#acc-arrange-btn').getAttribute('aria-pressed') === 'true' && $('#acc-arrange-btn').textContent === 'Done' && /▲ and ▼/.test(($('.acc-arrange-hint') || {}).textContent || ''),
           'arrange: it shows ▲ ▼ with a line saying how, and the button becomes Done');
        ok(!$$('#accounts-list .account-row button').some(b => /Edit|Delete|Update balance/.test(b.title)), 'arrange: edit, delete and update balance step aside while arranging');
        const first = sgd()[0], last = sgd()[sgd().length - 1];
        ok(mv(first, 'up').disabled && !mv(first, 'down').disabled && mv(last, 'down').disabled && !mv(last, 'up').disabled,
           'arrange: ▲ is off for the first account in a currency, ▼ for the last');
        ok(mv(first, 'down').getAttribute('aria-label') === `Move ${first} down`, 'arrange: each button names its account for screen readers', mv(first, 'down').getAttribute('aria-label'));
        const before = sgd();
        state.userId = 'test-user'; state.accountOrderSynced = false; window.__sb.calls.length = 0;
        mv('Arrange Two', 'up').click(); await wait(10);
        const want = before.slice(); const i = want.indexOf('Arrange Two'); [want[i - 1], want[i]] = [want[i], want[i - 1]];
        ok(sgd().join() === want.join() && listedSgd().join() === want.join(), 'arrange: ▲ swaps it with the account above, on screen too', listedSgd().join(' | '));
        ok(document.activeElement === mv('Arrange Two', 'up'), 'arrange: the focus stays on the button just pressed, so it can be pressed again');
        ok(!window.__sb.calls.some(c => c.op === 'update' && c.patch && 'sort_order' in c.patch), 'arrange: before migration 007 the order stays on the device and nothing is sent',
           JSON.stringify(window.__sb.calls.filter(c => c.op === 'update').map(c => c.patch)));
        ok(JSON.stringify(state.accountOrder) === JSON.stringify(state.accounts.map(a => String(a.id))), 'arrange: ...where it is remembered');
        state.accountOrderSynced = true; window.__sb.calls.length = 0;
        const before2 = sgd();
        mv('Arrange Two', 'up').click(); await wait(10);
        const want2 = before2.slice(); const i2 = want2.indexOf('Arrange Two'); [want2[i2 - 1], want2[i2]] = [want2[i2], want2[i2 - 1]];
        ok(sgd().join() === want2.join(), 'arrange: it moves past the next account in its own currency, never one in another', `${before2.join(' | ')} → ${sgd().join(' | ')}`);
        const sent = window.__sb.calls.filter(c => c.op === 'update' && c.patch && 'sort_order' in c.patch);
        ok(sent.length >= 1 && sent.every(c => c.patch.sort_order === state.accounts.findIndex(a => String(a.id) === c.filters[0][1][1])),
           'arrange: with migration 007 the new positions are sent', JSON.stringify(sent.map(c => [c.filters[0][1][1], c.patch.sort_order])));
        ok(state.accounts.every((a, k) => a.sortOrder === k), 'arrange: ...and every account is numbered by its place, so numbers never tie');
        openTxnModal();
        const picked = [...$('#txn-account').options].map(o => o.value).filter(n => sgd().includes(n));
        closeTxnModal();
        ok(picked.join() === sgd().join(), 'arrange: the transaction form lists the accounts in the new order', picked.join(' | '));
        // A reload puts them back in that order: from sort_order once the
        // database has it, from this device's record of it before then.
        const asRow = (a, k, withCol) => Object.assign({ id: a.id, user_id: 'test-user', name: a.name, type: a.type, institution: a.institution, currency: a.currency,
          starting_balance: a.balance, is_active: true, icon: a.icon }, withCol ? { sort_order: a.sortOrder ?? null } : {});
        const keepT = state.transactions.slice(), keepA = state.accounts.slice(), keepOrder = sgd().join();
        const keepLocal = state.accountOrder.slice();
        for (const withCol of [true, false]) {
          window.__sb.tables = { transactions: [], budgets: [], goals: [], bills: [], preferences: [], backups: [], accounts: keepA.slice().reverse().map((a, k) => asRow(a, k, withCol)) };
          // With the column: a device that has never seen the order (only the database knows it).
          state.accountOrder = withCol ? [] : keepLocal;
          state.outbox = []; await snLoadAll();
          ok(sgd().join() === keepOrder && state.accountOrderSynced === withCol, `arrange: a reload keeps the order ${withCol ? 'from the database' : 'kept on the device'}`, sgd().join(' | '));
        }
        // Once migration 007 runs: the first device to load shares the order it
        // was arranged in; a device loading after that adopts it.
        const tablesWith = rows => ({ transactions: [], budgets: [], goals: [], bills: [], preferences: [], backups: [], accounts: rows });
        const arranged = keepA.slice().reverse();          // this device's own arrangement
        window.__sb.tables = tablesWith(keepA.map(a => Object.assign(asRow(a, 0, true), { sort_order: null })));
        state.accountOrderSynced = false; state.accountOrder = arranged.map(a => String(a.id)); state.outbox = []; window.__sb.calls.length = 0;
        await snLoadAll(); await wait(10);
        const shared = window.__sb.calls.filter(c => c.op === 'update' && c.patch && 'sort_order' in c.patch);
        ok(state.accounts.map(a => a.name).join() === arranged.map(a => a.name).join() && state.accountOrderSynced,
           'sync: the first load after migration 007 keeps this device\'s arrangement', state.accounts.map(a => a.name).join(' | '));
        ok(shared.length === 2 && shared.every(c => c.patch.sort_order === state.accounts.findIndex(a => String(a.id) === c.filters[0][1][1])),
           'sync: ...and shares it, so the other devices get it without arranging again', JSON.stringify(shared.map(c => c.patch)));
        window.__sb.calls.length = 0;
        await snLoadAll();
        ok(!window.__sb.calls.some(c => c.op === 'update'), 'sync: loading again shares nothing more');
        const theirs = keepA.slice();                       // another device already stored this order
        window.__sb.tables = tablesWith(theirs.map((a, k) => Object.assign(asRow(a, 0, true), { sort_order: k })));
        state.accountOrderSynced = false; state.accountOrder = arranged.map(a => String(a.id)); window.__sb.calls.length = 0;
        await snLoadAll();
        ok(state.accounts.map(a => a.name).join() === theirs.map(a => a.name).join() && !window.__sb.calls.some(c => c.op === 'update'),
           'sync: a device loading after that adopts the stored order instead of overwriting it', state.accounts.map(a => a.name).join(' | '));
        // Coming back to the app picks up another device's new order without a reload.
        const moved = theirs.slice(1).concat(theirs[0]);
        window.__sb.tables = tablesWith(moved.map((a, k) => Object.assign(asRow(a, 0, true), { sort_order: k })));
        state.lastSync = new Date(Date.now() - 5000).toISOString();
        document.dispatchEvent(new Event('visibilitychange')); await wait(30);
        ok(state.accounts.map(a => a.name).join() === theirs.map(a => a.name).join(), 'sync: within a minute of the last load, coming back does not reload');
        state.lastSync = new Date(Date.now() - 5 * 60000).toISOString();
        openTxnModal();
        document.dispatchEvent(new Event('visibilitychange')); await wait(30);
        ok(state.accounts.map(a => a.name).join() === theirs.map(a => a.name).join(), 'sync: nothing reloads under an open window');
        closeTxnModal();
        document.dispatchEvent(new Event('visibilitychange')); await wait(50);
        ok(state.accounts.map(a => a.name).join() === moved.map(a => a.name).join(), 'sync: coming back to the app later picks up the order set on another device', state.accounts.map(a => a.name).join(' | '));
        // In Arrange, a device-only order says so.
        nav('accounts'); state.accountOrderSynced = false; _arrangingAccounts = true; renderAccounts();
        ok(/this device only/.test($('.acc-arrange-hint').textContent), 'sync: before migration 007, Arrange says the order is kept on this device only');
        state.accountOrderSynced = true; renderAccounts();
        ok(!/this device only/.test($('.acc-arrange-hint').textContent), 'sync: ...and stops saying it once the database keeps the order');
        state.transactions = keepT; state.accounts = keepA; state.accountOrderSynced = false; state.outbox = []; state.userId = null;
        $('#acc-arrange-btn').click();
        ok(!$('#accounts-list .acc-move') && $$('#accounts-list .account-row button').some(b => b.title === 'Edit'), 'arrange: Done brings the usual buttons back');
        state.accounts = state.accounts.filter(a => a.id !== U1 && a.id !== U2);
        renderAll();
      }

      // ── Update balance ──────────────────────────────────────────────────
      {
        state.userId = null;
        state.accounts.push({ id: 'acc-bx', name: 'Binance Test', type: 'Crypto', institution: 'Binance', balance: 1000, currency: 'USDT', icon: '🪙' });
        nav('accounts'); state.balancesMasked = false; renderAccounts();
        const rowOf = name => $$('#accounts-list .account-row').find(r => $('.account-name', r).textContent === name);
        const dbs = state.accounts.find(a => a.name === 'DBS Checking'), bx = state.accounts.find(a => a.name === 'Binance Test');
        const btn = rowOf('DBS Checking') && $$('button', rowOf('DBS Checking')).find(b => b.getAttribute('aria-label') === 'Update balance');
        ok(!!btn, 'update balance: every account row has the button');
        btn.click();
        ok($('#balance-modal').classList.contains('open') && /DBS Checking/.test($('#bal-title').textContent) && $('#bal-date').value === localDateStr(), 'update balance: it opens on today for that account');
        const had = balanceOn(dbs, localDateStr());
        ok(new RegExp(fmtWithCur(had, 'SGD').replace(/[$.]/g, '\\$&')).test($('#bal-now').textContent), 'update balance: it says what the app has', $('#bal-now').textContent);
        ok($('#bal-save').disabled, 'update balance: nothing to record until a balance is typed');
        const typeIn = v => { $('#bal-actual').value = String(v); $('#bal-actual').dispatchEvent(new Event('input')); };
        typeIn(had);
        ok($('#bal-save').disabled && /matches already/.test($('#bal-diff').textContent), 'update balance: the same balance records nothing');
        typeIn(r2(had + 123.45));
        ok(/\+S\$123\.45/.test($('#bal-diff').textContent) && /correction/.test($('#bal-diff').textContent) && /count twice/.test($('#bal-diff').textContent) && !$('#bal-save').disabled,
           'update balance: a bank account\'s difference is a correction, with the warning about missing rows', $('#bal-diff').textContent);
        const n0 = state.transactions.length;
        await saveBalanceUpdate(); await wait(10);
        const corr = state.transactions[0];
        ok(state.transactions.length === n0 + 1 && corr.type === 'income' && corr.amount === 123.45 && corr.account === 'DBS Checking' && corr.category === 'Other' && corr.description === 'Balance correction',
           'update balance: one row brings the account to the balance typed', JSON.stringify(corr));
        ok(near(effectiveBal(dbs), r2(had + 123.45)) && !$('#balance-modal').classList.contains('open'), 'update balance: the account now shows exactly that balance');
        ok($('.account-bal', rowOf('DBS Checking')).textContent === fmtWithCur(r2(had + 123.45), 'SGD'), 'update balance: the Accounts page shows the new balance', $('.account-bal', rowOf('DBS Checking')).textContent);
        // A crypto account, a loss, on an earlier day.
        openBalanceModal(bx.id);
        const day = addDaysStr(localDateStr(), -3);
        state.transactions.push({ id: 'bx-later', type: 'income', amount: 50, description: 'Deposit', category: 'Investment', account: 'Binance Test', date: addDaysStr(localDateStr(), -1), currency: 'USDT', created: '' });
        $('#bal-date').value = day; $('#bal-date').dispatchEvent(new Event('change'));
        typeIn(900);
        ok(/−USDT 100\.00/.test($('#bal-diff').textContent) && /loss \(Gain\/Loss\)/.test($('#bal-diff').textContent), 'update balance: an exchange account\'s difference is a gain or loss', $('#bal-diff').textContent);
        await saveBalanceUpdate(); await wait(10);
        const loss = state.transactions[0];
        ok(loss.type === 'expense' && loss.amount === 100 && loss.category === 'Gain/Loss' && loss.description === 'Market loss' && loss.date === day && loss.currency === 'USDT',
           'update balance: recorded as a Market loss under Gain/Loss on the day chosen', JSON.stringify(loss));
        ok(balanceOn(bx, day) === 900 && effectiveBal(bx) === 950, 'update balance: that day ends at the balance typed, and a later deposit still counts after it', `${balanceOn(bx, day)} / ${effectiveBal(bx)}`);
        ok(/Gain\/Loss/.test(loss.category) && catIcon('Gain/Loss') === '📊', 'update balance: Gain/Loss has its own icon');
        openTxnModal(loss.id);
        ok($('#txn-cat').value === 'Gain/Loss', 'update balance: opening the row keeps its Gain/Loss category', $('#txn-cat').value);
        closeTxnModal();
        state.transactions = state.transactions.filter(t => t !== corr && t !== loss && t.id !== 'bx-later');
      }

      // ── Net worth in one currency ───────────────────────────────────────
      {
        state.fx = undefined; window.__fxCalls.length = 0; window.__fxFail = false;
        nav('accounts'); renderAccounts(); await wait(30);
        ok(window.__fxCalls.length === 1 && /^https:\/\/api\.frankfurter\.dev\/v1\/latest\?base=SGD&symbols=[A-Z,]+$/.test(window.__fxCalls[0]),
           'fx: today\'s rates are asked for once, sending nothing but currency codes', window.__fxCalls.join(' '));
        ok(/symbols=MYR,USD$/.test(window.__fxCalls[0]), 'fx: only the currencies in use (USDT asks for the US dollar)', window.__fxCalls[0]);
        const total = $('#accounts-list .acc-sum-total');
        ok(!!total && /≈ SGD/.test(total.textContent), 'fx: the Accounts summary ends with a ≈ SGD total');
        const per = {};
        state.accounts.forEach(a => { const b = effectiveBal(a); per[a.currency] = (per[a.currency] || 0) + b; });
        const rate = { SGD: 1, MYR: 3.1733, USD: 0.77634, USDT: 0.77634 };
        const want = r2(Object.entries(per).reduce((s, [c, v]) => s + v / rate[c], 0));
        ok(total && parseNum($('.acc-sum-net', total).textContent) === want, 'fx: the total is every currency\'s net worth at the day\'s rate', `${total && $('.acc-sum-net', total).textContent} vs ${want}`);
        ok(/rates of 13 Nov 2026/.test($('.acc-fx-note').textContent) && /USDT at the US dollar rate/.test($('.acc-fx-note').textContent), 'fx: the note says whose rates and that USDT counts as dollars', $('.acc-fx-note').textContent);
        renderAccounts(); await wait(10);
        ok(window.__fxCalls.length === 1, 'fx: not asked again the same day');
        // Your own rate for one currency.
        openFxModal();
        ok($$('#fx-rows input').map(i => i.dataset.cur).join() === 'MYR,USD,USDT' && $('#fx-MYR').placeholder === '3.1733', 'fx: the rates window lists each currency with the day\'s rate', $$('#fx-rows input').map(i => i.dataset.cur + ':' + i.placeholder).join());
        $('#fx-MYR').value = '3'; saveFxRates();
        const want2 = r2(Object.entries(per).reduce((s, [c, v]) => s + v / (c === 'MYR' ? 3 : rate[c]), 0));
        ok(parseNum($('.acc-sum-total .acc-sum-net').textContent) === want2 && /MYR set by you/.test($('.acc-fx-note').textContent), 'fx: a rate you set is used, and the note says so', $('.acc-fx-note').textContent);
        useTodaysRates(); await wait(30);
        ok(parseNum($('.acc-sum-total .acc-sum-net').textContent) === want && !/set by you/.test($('.acc-fx-note').textContent), 'fx: "Use today\'s rates" goes back to them');
        // Offline with no rates yet: the total says what it leaves out.
        state.fx = undefined; window.__fxFail = true; renderAccounts(); await wait(30);
        ok(/Leaves out MYR, USD, USDT/.test($('.acc-fx-note').textContent) && parseNum($('.acc-sum-total .acc-sum-net').textContent) === r2(per.SGD), 'fx: offline with no rates, the total is the home currency and says what it leaves out', $('.acc-fx-note').textContent);
        window.__fxFail = false;
        state.balancesMasked = true; renderAccounts(); await wait(30);
        ok(/••••••/.test($('.acc-sum-total').textContent), 'fx: hidden balances hide the total too');
        state.balancesMasked = false;
        state.accounts = state.accounts.filter(a => a.id !== 'acc-bx'); renderAccounts();
      }

      // ── Again today ─────────────────────────────────────────────────────
      {
        nav('transactions'); state.filterMonth = M1;
        ['filter-period', 'filter-type', 'filter-cat', 'filter-cur', 'filter-acc', 'search-input'].forEach(id => { const el = $('#' + id); if (el) el.value = ''; });
        renderTransactions();
        const movie = state.transactions.find(t => t.description === 'Movie');
        const n0 = state.transactions.length;
        const againBtn = id => $$('#all-txns .icon-btn.again').find(b => b.getAttribute('onclick') === `repeatToday('${id}')`);
        ok(!!againBtn(movie.id) && againBtn(movie.id).getAttribute('aria-label') === 'Again today', 'again: every row has an Again today button');
        againBtn(movie.id).click();
        ok($('#txn-modal').classList.contains('open') && $('#txn-edit-id').value === '' && $('#txn-edit-badge').style.display === 'none' && $('#txn-modal-title').textContent === 'Add Transaction',
           'again: it opens a new transaction, not an edit');
        ok($('#txn-date').value === localDateStr() && $('#txn-amount').value === '20' && $('#txn-desc').value === 'Movie' && $('#txn-cat').value === 'Entertainment' && $('#txn-account').value === 'DBS Checking',
           'again: dated today, with the same amount, description, category and account', [$('#txn-date').value, $('#txn-amount').value, $('#txn-desc').value, $('#txn-cat').value, $('#txn-account').value].join(' | '));
        ok($('#txn-repeat').value === '' && $('#save-txn-btn').className.includes('btn-coral'), 'again: not set to repeat, and the button reads as a new expense');
        $('#txn-amount').value = '22.5';
        await saveTransaction(); await wait(10);
        const copy = state.transactions.find(t => t.description === 'Movie' && t.date === localDateStr());
        ok(state.transactions.length === n0 + 1 && copy && copy.amount === 22.5 && copy.id !== movie.id && movie.amount === 20 && movie.date === M1 + '-21',
           'again: saving adds a new row and leaves the original alone', JSON.stringify(copy));
        const out = state.transactions.find(t => t.transferGroup === 'tg_3' && t.type === 'expense');
        repeatToday(out.id);
        ok(state.currentType === 'transfer' && $('#txn-account').value === 'DBS Checking' && $('#txn-to-account').value === 'Wise USD' && $('#txn-amount-recv').value === '100' && ['expense', 'income', 'asset', 'payback'].every(k => !$('#tab-' + k).disabled),
           'again: a currency exchange comes back with both accounts and both amounts, as a new one');
        await saveTransaction(); await wait(10);
        const pair = state.transactions.filter(t => t.transferGroup && t.transferGroup !== 'tg_3' && t.description === 'SGD to USD' && t.date === localDateStr());
        ok(pair.length === 2 && !pairProblems().some(p => pair.some(l => l.transferGroup === p.group)) && state.transactions.filter(t => t.transferGroup === 'tg_3').length === 2,
           'again: saving it makes a new proper pair, and the original pair is untouched', pair.map(l => `${l.type} ${l.account} ${l.amount}`).join(', '));
        state.transactions = state.transactions.filter(t => t !== copy && !pair.includes(t));
        // A transfer to an account since deleted, in another currency: the copy
        // still arrives in that currency, with the amount that arrived.
        state.transactions.push({ id: 'gone-out', type: 'expense', amount: 50, description: 'To my old MYR account', category: 'Transfer', account: 'DBS Checking', date: M1 + '-08', currency: 'SGD', transferGroup: 'tg_gone', transferPeer: 'Old MYR', created: '' },
                                { id: 'gone-in', type: 'income', amount: 160, description: 'To my old MYR account', category: 'Transfer', account: 'Old MYR', date: M1 + '-08', currency: 'MYR', transferGroup: 'tg_gone', transferPeer: 'DBS Checking', created: '' });
        repeatToday('gone-out');
        ok($('#txn-to-account').value === 'Old MYR' && /no longer an account/.test($('#txn-to-account').selectedOptions[0].textContent) && $('#txn-recv-group').style.display === 'block' && $('#txn-amount-recv').value === '160',
           'again: a transfer to a deleted account in another currency keeps that account and the amount that arrived');
        await saveTransaction(); await wait(10);
        const gonePair = state.transactions.filter(t => t.description === 'To my old MYR account' && t.date === localDateStr());
        const goneIn = gonePair.find(t => t.type === 'income');
        ok(gonePair.length === 2 && goneIn && goneIn.currency === 'MYR' && goneIn.amount === 160, 'again: ...and the copy arrives in MYR, not in the sending currency', JSON.stringify(goneIn));
        state.transactions = state.transactions.filter(t => t.transferGroup !== 'tg_gone' && !gonePair.includes(t));
        renderAll();
      }

      // ── Empty states ────────────────────────────────────────────────────
      const savedT = state.transactions, savedA = state.accounts;
      state.transactions = []; renderAll(); nav('analytics'); await wait(10);
      ok(/Add transactions to see breakdown/.test($('#analytics-chart').textContent), 'empty: the breakdown shows its empty state');
      ok(/No income or spending/.test($('#monthly-summary').textContent), 'empty: Monthly In & Out shows its empty state');
      openStatement(mk);
      ok(/Wise USD/.test($('#stmt-paper').textContent) && !/NaN|undefined/.test($('#stmt-paper').textContent), 'empty: a month with no transactions still shows account balances');
      state.accounts = []; renderStatement();
      ok(/Nothing recorded/.test($('#stmt-paper').textContent), 'empty: no accounts and no transactions says nothing was recorded');
      closeStatement();
      state.transactions = savedT; state.accounts = savedA; renderAll(); nav('analytics');
    } catch (e) {
      R.push({ ok: false, name: 'the checks ran to the end', detail: e.stack });
    }
    const pre = document.createElement('pre');
    pre.id = 'e2e';
    pre.textContent = JSON.stringify({ results: R, errors });
    document.body.appendChild(pre);
  }, 80);
