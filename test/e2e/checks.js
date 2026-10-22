  // ── Checks ───────────────────────────────────────────────────────────────
  // Runs inside the page after seed.js. ?view= instead opens one screen and
  // stops, for screenshots. Results go into a pre#e2e element as JSON.
  const VIEW = P.get('view') || 'checks';
  setTimeout(async () => {
    if (VIEW === 'review') { document.getElementById('analytics-chart').closest('.panel').scrollIntoView({ block: 'start' }); return; }
    if (VIEW === 'msum') { document.getElementById('monthly-summary').closest('.panel').scrollIntoView({ block: 'start' }); return; }
    if (VIEW === 'msum-open') { toggleMonthDetail('SGD|' + M1); document.getElementById('monthly-summary').closest('.panel').scrollIntoView({ block: 'start' }); return; }
    if (VIEW === 'stmt') { openStatement(M1); return; }
    if (VIEW === 'print') { openStatement(M1); document.body.classList.add('stmt-printing'); return; }

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
        const netTh = $$('thead th', wrap).find(th => th.classList.contains('msum-net'));
        ok(netTh && netTh.getBoundingClientRect().right <= wrap.getBoundingClientRect().right + 1 && netTh.getBoundingClientRect().width > 60,
           'phone: with a month open, Net still sits inside the table', netTh && netTh.getBoundingClientRect().width);
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

      // ── What a pair sends to the server ─────────────────────────────────
      state.userId = 'test-user'; window.__sb.calls.length = 0;
      await saveTransferPair({ amt: 50, recvAmt: 50, desc: 'Peer test', cat: 'Transfer', from: 'DBS Checking', to: 'OCBC Savings',
                               fromCur: 'SGD', toCur: 'SGD', date: M0 + '-05', notes: '' });
      const sent = window.__sb.calls.filter(c => c.op === 'upsert' && c.row && c.row.description === 'Peer test');
      ok(sent.length === 2 && sent.find(c => c.row.type === 'expense').row.transfer_peer === 'OCBC Savings'
         && sent.find(c => c.row.type === 'income').row.transfer_peer === 'DBS Checking', 'sync: a new transfer sends each side\'s other account');
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
      ok(!$('#sync-badge').hidden && /1 not synced/.test($('#sync-badge').textContent), 'outbox: the badge says one change is waiting', $('#sync-badge').textContent);
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
      ok($('#sync-badge').hidden, 'outbox: the badge clears');
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
