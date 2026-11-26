  // ── Fit audit ────────────────────────────────────────────────────────────
  // ?view=fit opens every page, window and menu at the current size and
  // measures what doesn't fit on a phone: anything past the screen edge, rows
  // that scroll sideways, text cut off or on top of other text, controls too
  // small to tap or hidden behind the bottom bar, and inputs that make an
  // iPhone zoom in. ?view=fit&screen=NAME opens one screen and stops, for
  // screenshots. &lang=zh runs it in Chinese. Results go into pre#e2e as JSON.
  if (VIEW === 'fit') setTimeout(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const errors = [];
    window.addEventListener('error', e => errors.push('error: ' + e.message));
    window.addEventListener('unhandledrejection', e => errors.push('rejection: ' + ((e.reason && e.reason.message) || e.reason)));

    // Harder content than the main suite: long names, seven-figure amounts,
    // USDT, bills and goals, a broken pair (so the warning banner shows) and a
    // refused change (so the sync badge shows).
    state.accounts.push(
      { id: 5, name: 'OCBC 360 Joint Account with Mum', type: 'Savings', institution: 'OCBC Bank (Singapore)', balance: 1234567.89, currency: 'SGD', icon: '🏦' },
      { id: 6, name: 'Binance Spot Wallet', type: 'Investment', institution: 'Binance', balance: 98765.43, currency: 'USDT', icon: '🪙' });
    const long = tx(M0 + '-03', 'expense', 'Health', 12345.67, 'SGD', 'OCBC 360 Joint Account with Mum',
      'Annual family health insurance premium, renewal for next year with the hospital rider');
    state.transactions.unshift(long,
      tx(M0 + '-04', 'income', 'Salary', 123456.78, 'USDT', 'Binance Spot Wallet', 'Crypto payout'),
      tx(M0 + '-05', 'expense', 'Transfer', 300, 'SGD', 'DBS Checking', 'To an account that was deleted', { transferGroup: 'tg_broken' }));
    state.bills = [
      { id: 'b1', name: 'Netflix', amount: 19.98, currency: 'SGD', category: 'Entertainment', account: 'DBS Checking', dueDay: 5, amountVaries: false, isActive: true, notes: '' },
      { id: 'b2', name: 'Town Council Service & Conservancy Charges', amount: 1234.5, currency: 'SGD', category: 'Bills', account: 'OCBC 360 Joint Account with Mum', dueDay: 28, amountVaries: true, isActive: true, notes: '' },
      { id: 'b3', name: 'Phone and internet', amount: 83.74, currency: 'SGD', category: 'Bills', account: 'DBS Checking', dueDay: 15, amountVaries: false, isActive: true, notes: '' },
      { id: 'b4', name: 'Gym membership', amount: 120, currency: 'SGD', category: 'Sport', account: null, dueDay: 1, amountVaries: false, isActive: false, notes: '' }];
    state.goals = [
      { id: 'g1', name: 'Emergency fund (six months of expenses)', icon: '🛟', target: 30000, current: 12345.67, monthly: 1000,
        date: (+M0.slice(0, 4) + 1) + '-12-31', remarks: 'Kept in a separate account', currency: 'SGD', linkedAccount: '' },
      { id: 'g2', name: 'Japan trip', icon: '✈️', target: 5000, current: 5000, monthly: 0, date: '', remarks: '', currency: 'SGD', linkedAccount: '' },
      { id: 'g3', name: 'Crypto stack', icon: '🪙', target: 1000000, current: 98765.43, monthly: 0, date: '', remarks: '', currency: 'USDT', linkedAccount: 'Binance Spot Wallet' }];
    state.userId = 'fit-user';
    state.outbox = [];
    state.outboxRejected = [{ opId: 'fit1', kind: 'upsert', table: 'transactions', rowId: String(long.id), userId: 'fit-user', attempts: 3,
      lastError: 'new row for relation "transactions" violates check constraint "transactions_currency_check"' }];
    window.__sb.failWrites = true;
    if (P.get('lang') === 'zh') state.language = 'zh';

    // &poison=1: every piece of text a person types (descriptions, notes,
    // account, goal and bill names, an institution, a category, the display
    // name) carries markup that would run if any screen put it into the page
    // as HTML. xssAudit() then looks for it on every screen.
    const POISON = P.get('poison') === '1';
    const BAD = n => `${n}"><img src=x data-xss="${n}" onerror="window.__xss=(window.__xss||[]).concat('${n}')"><b data-xss="${n}">'`;
    if (POISON) {
      const renamed = new Map();
      state.accounts.forEach((a, i) => { if (i % 2 === 0) { renamed.set(a.name, BAD('account' + i)); a.name = renamed.get(a.name); a.institution = BAD('institution' + i); } });
      const rn = v => renamed.get(v) || v;
      state.transactions.forEach((t, i) => {
        t.account = rn(t.account); if (t.transferPeer) t.transferPeer = rn(t.transferPeer);
        if (i % 3 === 0) t.description = BAD('description' + i);
        if (i % 4 === 0) t.notes = BAD('notes' + i);
        if (i % 11 === 0 && !t.transferGroup) t.category = BAD('category' + i);
      });
      state.goals.forEach((g, i) => { g.name = BAD('goal' + i); g.remarks = BAD('remarks' + i); g.linkedAccount = rn(g.linkedAccount); });
      state.bills.forEach((b, i) => { b.name = BAD('bill' + i); b.notes = BAD('billnotes' + i); b.account = rn(b.account); });
      state.budgets.forEach((b, i) => { if (i === 0) b.category = BAD('budget' + i); });
      state.displayName = BAD('name');
      state.outboxRejected[0].lastError = BAD('server-error');
    }
    applyLanguage();
    renderAll();

    const csv = (() => {
      const mo = new Date(+M1.slice(0, 4), +M1.slice(5, 7) - 1, 1).toLocaleDateString('en-GB', { month: 'short' }), y = M1.slice(0, 4);
      return `Transaction Date,Reference,Debit Amount,Credit Amount,Transaction Ref1,Transaction Ref2\n07 ${mo} ${y},POS,432.00,,DENTAL,CLINIC\n`
        + `24 ${mo} ${y},POS,23.45,,NETS,FAIRPRICE XTRA SUPERMARKET TOA PAYOH HUB\n25 ${mo} ${y},UMC,18.20,,GRAB* A-9X2,SINGAPORE\n`
        + `26 ${mo} ${y},ICT,,123456.00,SALARY,ACME PTE LTD\n`;
    })();
    const login = panel => { $('#login-overlay').style.display = 'flex'; showAuthPanel(panel); };
    const txnType = type => { openTxnModal(); setType(type, $('#tab-' + type)); };
    const SCREENS = {
      'dashboard': () => showView('dashboard'),
      'transactions': () => showView('transactions'),
      'transactions-select': () => { showView('transactions'); toggleBulkMode(); bulkSelectAllVisible(); },
      'budgets': () => showView('budgets'),
      'budgets-planner': () => { showView('budgets'); toggleSalaryPlanner(); },
      'bills': () => showView('bills'),
      'goals': () => showView('goals'),
      'analytics': () => showView('analytics'),
      'analytics-month-open': () => { showView('analytics'); toggleMonthDetail('SGD|' + M1); $('#monthly-summary').scrollIntoView({ block: 'start', behavior: 'instant' }); },
      'accounts': () => { state.balancesMasked = false; showView('accounts'); },
      'accounts-arrange': () => { state.balancesMasked = false; showView('accounts'); toggleArrangeAccounts(); },
      'settings': () => showView('settings'),
      'menu': () => { showView('dashboard'); toggleSidebar(); },
      'txn-expense': () => txnType('expense'),
      'txn-income': () => txnType('income'),
      'txn-transfer': () => txnType('transfer'),
      'txn-asset': () => txnType('asset'),
      'txn-payback': () => txnType('payback'),
      'txn-edit': () => openTxnModal(long.id),
      'txn-again': () => repeatToday((state.transactions.find(t => t.description === 'Kopi and toast') || state.transactions.find(t => t.type === 'expense' && !t.transferGroup)).id),
      'txn-suggest': () => { txnType('expense'); $('#txn-desc').value = 'a'; showDescSuggestions(); },
      'txn-suggest-transfer': () => { txnType('transfer'); showDescSuggestions(); },
      'budget-new': () => openBudgetModal(),
      'budget-edit': () => openBudgetModal(1),
      'bill-new': () => openBillModal(),
      'bill-edit': () => openBillModal('b2'),
      'goal-new': () => openGoalModal(),
      'goal-edit': () => openGoalModal('g1'),
      'account-new': () => openAccountModal(),
      'account-edit': () => openAccountModal(5),
      'balance-update': () => { showView('accounts'); openBalanceModal(5); $('#bal-actual').value = '1234567.89'; renderBalanceDiff(); },
      'balance-update-crypto': () => { showView('accounts'); openBalanceModal(6); $('#bal-actual').value = '90000'; renderBalanceDiff(); },
      'fx-rates': () => { showView('accounts'); openFxModal(); },
      'confirm': () => { showConfirm('Delete this transaction?', 'Annual family health insurance premium, S$12,345.67. This can’t be undone.'); },
      'data-check': () => openDataCheck(),
      'sync-problems': () => openSyncProblems(),
      'statement': () => openStatement(M1),
      'import-start': () => { showView('transactions'); openImport(); },
      'import-file': async () => { showView('transactions'); openImport(); await loadImportFile({ name: 'DBS statement with a long file name.csv', text: async () => csv }); },
      'toast': () => { showView('transactions'); undoToast('Deleted “Annual family health insurance premium” (S$12,345.67)', () => {}, () => {}, 60000); },
      'sign-in': () => login('login'),
      'register': () => login('register'),
      'pin-lock': () => login('pinlock'),
    };
    const closeAll = () => {
      if (bulkMode) toggleBulkMode();
      if (_arrangingAccounts) toggleArrangeAccounts();
      const planner = $('#salary-planner-body'); if (planner && planner.style.display !== 'none') toggleSalaryPlanner();
      $$('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
      closeSidebar();
      $('#login-overlay').style.display = 'none';
      const toast = $('#toast'); if (toast) toast.classList.remove('show');
      $$('.main, .modal-backdrop, .modal').forEach(el => { el.scrollTop = 0; el.scrollLeft = 0; });
    };

    // What the person is looking at: a message, the open window, the menu,
    // the sign-in screen, or the page.
    const rootOf = () => $('#toast.show') || $('.modal-backdrop.open') || ($('.sidebar.open') && $('.sidebar'))
      || ($('#login-overlay').style.display === 'flex' && $('#login-overlay')) || document.body;
    // The element that scrolls that view, for screenshots.
    window.__fitScroller = () => {
      const root = rootOf();
      const pool = root === document.body ? [$('.main'), document.scrollingElement] : [$('.modal', root), root, ...$$('*', root)];
      return pool.find(el => el && el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)) || document.scrollingElement;
    };

    const name = el => {
      const parts = [];
      for (let e = el; e && e !== document.body && parts.length < 3; e = e.parentElement) {
        let s = e.tagName.toLowerCase();
        if (e.id) { s += '#' + e.id; parts.unshift(s); break; }
        const cls = [...e.classList].filter(c => !/^(active|open|show)$/.test(c)).slice(0, 2);
        if (cls.length) s += '.' + cls.join('.');
        parts.unshift(s);
      }
      return parts.join(' > ');
    };
    const snippet = el => (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').replace(/\s+/g, ' ').trim().slice(0, 50);
    const ink = s => /\S/.test(s);

    function audit(screen) {
      const out = [];
      const add = (kind, el, detail) => out.push({ screen, kind, at: el ? name(el) : '', text: el ? snippet(el) : '', detail: detail || '' });
      const vw = document.documentElement.clientWidth, vh = innerHeight;
      const root = rootOf();
      const css = new Map();
      const cs = el => { let v = css.get(el); if (!v) { v = getComputedStyle(el); css.set(el, v); } return v; };
      const shown = el => {
        for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
          const s = cs(e);
          if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
        }
        // A closed <details> lays out its contents but shows only the summary.
        const d = el.closest('details:not([open])');
        if (d && !(d.querySelector(':scope > summary') || d).contains(el)) return false;
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      };
      // A drawer parked off screen (the closed menu) is meant to be there.
      const parked = el => {
        for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
          if (cs(e).position === 'fixed') { const r = e.getBoundingClientRect(); return r.right <= 0 || r.left >= vw || r.bottom <= 0 || r.top >= vh; }
        }
        return false;
      };
      const layer = el => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const p = cs(e).position; if (p === 'fixed' || p === 'sticky') return e; } return null; };
      const clippers = el => {
        const list = [];
        for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
          const s = cs(e);
          if (e !== el && (s.overflowX !== 'visible' || s.overflowY !== 'visible')) list.push(e);
          if (s.position === 'fixed') break;   // nothing further out clips it
        }
        return list;
      };

      // 1. The page itself never scrolls sideways.
      if (document.documentElement.scrollWidth > vw + 1) add('page scrolls sideways', null, `${document.documentElement.scrollWidth}px wide on a ${vw}px screen`);

      // 2. Boxes that scroll sideways.
      $$('*', root).forEach(el => {
        const s = cs(el);
        if (!/auto|scroll/.test(s.overflowX) || el.scrollWidth <= el.clientWidth + 1 || !shown(el) || parked(el)) return;
        // Name the outermost things that stick out past its right edge.
        const edge = el.getBoundingClientRect().left + el.clientLeft + el.clientWidth + 1;
        const wide = $$('*', el).filter(d => shown(d) && d.getBoundingClientRect().right > edge && !(d.parentElement !== el && d.parentElement.getBoundingClientRect().right > edge))
          .slice(0, 3).map(d => `${name(d)} (${Math.round(d.getBoundingClientRect().width)}px)`);
        add('scrolls sideways', el, `${el.scrollWidth}px of content in ${el.clientWidth}px; too wide: ${wide.join('; ') || '?'}`);
      });

      // 3. Every piece of text: on screen, not cut off, not on top of other
      //    text, big enough to read.
      const texts = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => ink(n.nodeValue) ? 1 : 3 });
      for (let n; (n = walker.nextNode());) {
        const el = n.parentElement;
        if (!el || /^(SCRIPT|STYLE|OPTION|TEXTAREA|TITLE)$/.test(el.tagName) || !shown(el) || parked(el)) continue;
        const range = document.createRange(); range.selectNodeContents(n);
        const rects = [...range.getClientRects()].filter(r => r.width > 0.5 && r.height > 0.5);
        if (!rects.length) continue;
        const box = rects.reduce((a, r) => ({ left: Math.min(a.left, r.left), right: Math.max(a.right, r.right), top: Math.min(a.top, r.top), bottom: Math.max(a.bottom, r.bottom) }),
          { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
        // Walk out from the text. A box that scrolls on an axis can bring the
        // text into view on that axis, so boxes further out don't count there.
        let liveX = true, liveY = true, scrolled = false, cut = null, shortened = false;
        for (const c of [el, ...clippers(el)]) {
          const s = cs(c);
          if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
          const r = c.getBoundingClientRect();
          const inner = { left: r.left + c.clientLeft, right: r.left + c.clientLeft + c.clientWidth, top: r.top + c.clientTop, bottom: r.top + c.clientTop + c.clientHeight };
          const outX = liveX && (box.left < inner.left - 1 || box.right > inner.right + 1);
          const outY = liveY && (box.top < inner.top - 1 || box.bottom > inner.bottom + 1);
          const clipX = outX && /hidden|clip/.test(s.overflowX), clipY = outY && /hidden|clip/.test(s.overflowY);
          if (clipX || clipY) {
            if (s.textOverflow === 'ellipsis' || (s.webkitLineClamp && s.webkitLineClamp !== 'none')) shortened = true; else cut = c;
            break;
          }
          if (outX) scrolled = true;
          if (/auto|scroll/.test(s.overflowX)) liveX = false;
          if (/auto|scroll/.test(s.overflowY)) liveY = false;
        }
        const own = cs(el);
        if (cut) add('text cut off', el, cut === el ? 'by its own box' : `inside ${name(cut)}`);
        else if (shortened) add('text shortened with …', el);
        else if (!scrolled && (box.right > vw + 1 || box.left < -1)) add('text off the screen', el, `${Math.round(box.left)}–${Math.round(box.right)}px on a ${vw}px screen`);
        // A short word split over lines means its box is squeezed to a sliver
        // (long tokens like a server error's constraint name may wrap).
        if (rects.length > 1) {
          const re = /[A-Za-z]{4,15}/g;
          for (let m; (m = re.exec(n.nodeValue));) {
            const w = document.createRange(); w.setStart(n, m.index); w.setEnd(n, m.index + m[0].length);
            const lines = new Set([...w.getClientRects()].filter(r => r.width > 0.5).map(r => Math.round(r.top)));
            if (lines.size > 1) { add('word split across lines', el, `“${m[0]}” in a ${Math.round(el.getBoundingClientRect().width)}px box`); break; }
          }
        }
        const size = parseFloat(own.fontSize);
        if (size < 10) add('text under 10px', el, size + 'px');
        // Only the part that shows — inside every box that clips or scrolls
        // it — can sit on top of other text.
        const boxes = [el, ...clippers(el)].filter(c => cs(c).overflowX !== 'visible' || cs(c).overflowY !== 'visible').map(c => c.getBoundingClientRect());
        const seenRects = rects.map(r => boxes.reduce((v, c) => ({ left: Math.max(v.left, c.left), right: Math.min(v.right, c.right), top: Math.max(v.top, c.top), bottom: Math.min(v.bottom, c.bottom) }), r))
          .filter(r => r.right > r.left && r.bottom > r.top);
        if (seenRects.length) texts.push({ el, rects: seenRects, layer: layer(el) });
      }
      // Sorted by top edge, each piece is only compared with pieces that
      // start before it ends.
      texts.forEach(t => { t.top = Math.min(...t.rects.map(r => r.top)); t.bottom = Math.max(...t.rects.map(r => r.bottom)); });
      texts.sort((p, q) => p.top - q.top);
      for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length && texts[j].top < texts[i].bottom - 3; j++) {
        const a = texts[i], b = texts[j];
        const hit = a.rects.some(p => b.rects.some(q =>
          Math.min(p.right, q.right) - Math.max(p.left, q.left) > 2 && Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > 3));
        if (!hit || a.el === b.el || a.layer !== b.layer || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        add('text on top of other text', a.el, `overlaps ${name(b.el)} “${snippet(b.el)}”`);
      }

      // 4. Pickers wide enough for what they show.
      const ctx = document.createElement('canvas').getContext('2d');
      $$('select', root).forEach(sel => {
        if (!shown(sel) || parked(sel) || sel.selectedIndex < 0) return;
        const s = cs(sel);
        ctx.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
        const label = sel.options[sel.selectedIndex].text;
        if (label.replace(/\p{Extended_Pictographic}/gu, '').trim().length > 24) return;
        const need = ctx.measureText(label).width;
        // The text stops at the right padding, which must clear the drawn
        // arrow (its offset from the right edge plus its width).
        if (s.backgroundImage !== 'none') {
          const off = /100% - ([\d.]+)px/.exec(s.backgroundPositionX), arrow = (off ? +off[1] : 0) + (parseFloat(s.backgroundSize) || 0);
          if (parseFloat(s.paddingRight) < arrow + 2) add('picker text runs under its arrow', sel, `padding ${s.paddingRight}, arrow reaches ${arrow}px in`);
        }
        const room = sel.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
        if (need > room + 1) add('picker text cut off', sel, `needs ${Math.round(need)}px, has ${Math.round(room)}px`);
      });

      // 5. Inputs under 16px make iPhone Safari zoom in when tapped.
      $$('input, select, textarea', root).forEach(el => {
        if (/^(checkbox|radio|range|color|file|hidden|button|submit)$/.test(el.type) || !shown(el) || parked(el)) return;
        if (parseFloat(cs(el).fontSize) < 16) add('input zooms the page on iPhone', el, cs(el).fontSize);
      });

      // 6. Controls: big enough to tap, visible without hover, and reachable —
      //    scrolled into view, nothing (like the bottom bar) sits on top.
      const controls = $$('a[href], button, input, select, textarea, summary, label[for], [onclick], [role="button"]', root)
        .filter(el => !(el.tagName === 'INPUT' && el.type === 'hidden') && shown(el) && !parked(el))
        // A <label for> beside a full-size field is not a separate target: the
        // field itself is (WCAG 2.5.8's "equivalent" exception).
        .filter(el => { if (el.tagName !== 'LABEL') return true; const f = el.control; return !(f && shown(f) && f.getBoundingClientRect().height >= 24); })
        .filter((el, _, all) => !all.some(o => o !== el && o.contains(el) && o.tagName !== 'LABEL' && o.matches('button, a[href], [onclick], [role="button"]')));
      const boxOf = el => ((el.tagName === 'INPUT' && el.closest('label')) || el).getBoundingClientRect();
      const small = r => r.width < 24 || r.height < 24;
      const centre = r => [r.left + r.width / 2, r.top + r.height / 2];
      const gap = ([x, y], r) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
      controls.forEach(el => {
        const r = boxOf(el);
        if (small(r)) {
          // WCAG 2.5.8's spacing rule: a 24px circle on its centre touches no
          // other target, nor another small target's circle.
          const c = centre(r);
          const near = controls.find(o => {
            if (o === el || o.contains(el) || el.contains(o) || layer(o) !== layer(el)) return false;
            const q = boxOf(o);
            return small(q) ? Math.hypot(c[0] - centre(q)[0], c[1] - centre(q)[1]) < 24 : gap(c, q) < 12;
          });
          if (near) add('too small to tap', el, `${Math.round(r.width)}×${Math.round(r.height)}px, next to ${name(near)}`);
        }
        let op = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) op *= +cs(e).opacity;
        if (op < 0.35) add('only visible on hover', el, `opacity ${op.toFixed(2)}`);
      });
      controls.filter(el => !(el instanceof SVGElement)).forEach(el => {
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        const r = el.getClientRects()[0] || el.getBoundingClientRect();
        if (r.bottom <= 0 || r.top >= vh) { add('can’t be scrolled into view', el, `${Math.round(r.top)}px from the top of an ${vh}px screen`); return; }
        const pts = [[r.left + r.width / 2, r.top + r.height / 2]];
        const hitOk = ([x, y]) => {
          if (x < 0 || y < 0 || x >= vw || y >= vh) return false;
          const hit = document.elementFromPoint(x, y);
          return hit && (hit === el || el.contains(hit) || (hit.tagName === 'LABEL' && hit.contains(el)) || (el.id && hit.closest(`label[for="${el.id}"]`)));
        };
        if (!pts.some(hitOk)) {
          const [x, y] = pts[0];
          const hit = x >= 0 && y >= 0 && x < vw && y < vh ? document.elementFromPoint(x, y) : null;
          add('covered, can’t be tapped', el, hit ? `under ${name(hit)}` : `centre ${Math.round(x)},${Math.round(y)} is off the screen`);
        }
      });

      // 7. The last thing on a page clears the bottom bar.
      if (root === document.body) {
        const main = $('.main'); main.scrollTop = main.scrollHeight;
        const nav = $('.bottom-nav');
        if (nav && shown(nav)) {
          const fab = $('.bnav-fab');
          const top = Math.min(nav.getBoundingClientRect().top, fab ? fab.getBoundingClientRect().top : Infinity);
          const view = $('.view.active');
          let last = null, bottom = -Infinity;
          $$('*', view).forEach(el => {
            if (el.children.length || !shown(el)) return;
            const b = el.getBoundingClientRect().bottom;
            if (b > bottom) { bottom = b; last = el; }
          });
          if (last && bottom > top + 1) add('last item hidden behind the bottom bar', last, `ends at ${Math.round(bottom)}px, bar starts at ${Math.round(top)}px`);
        }
      }

      // 8. A list row keeps its name beside its icon (a squeezed row pushes
      //    the name onto a line of its own, under a lonely icon).
      [['.txn-row', '.txn-ico', '.txn-name'], ['.account-row', '.account-ico', '.account-name']].forEach(([row, ico, nm]) => {
        $$(row, root).forEach(r => {
          const i = $(ico, r), n = $(nm, r);
          if (!i || !n || !shown(i) || !shown(n)) return;
          if (n.getBoundingClientRect().top >= i.getBoundingClientRect().bottom - 1) add('name pushed below its icon', n);
        });
      });

      // 9. A window fits across the screen and starts on it.
      const box = root.classList && root.classList.contains('modal-backdrop') && $('.modal', root);
      if (box) {
        const r = box.getBoundingClientRect();
        if (r.left < -1 || r.right > vw + 1) add('window wider than the screen', box, `${Math.round(r.left)}–${Math.round(r.right)}px`);
      }
      $$('.main, .modal-backdrop, .modal').forEach(el => { el.scrollTop = 0; });

      // Known and accepted, each with its reason.
      const ACCEPTED = [
        ['too small to tap', /trend-bar-col/, 'a year of bars on a phone; the same month figures are rows in Monthly In & Out'],
      ];
      for (let i = out.length - 1; i >= 0; i--) if (ACCEPTED.some(([k, at]) => out[i].kind === k && at.test(out[i].at))) out.splice(i, 1);

      // One line per problem and place.
      const seen = new Map();
      out.forEach(f => { const k = f.kind + '|' + f.at + '|' + f.detail; if (seen.has(k)) seen.get(k).count++; else seen.set(k, Object.assign(f, { count: 1 })); });
      return [...seen.values()];
    }

    // ── &poison=1: nothing typed is ever run as markup ──
    function xssAudit(screen) {
      const out = [];
      const add = (kind, el, detail) => out.push({ screen, kind, at: el ? name(el) : '', text: '', detail });
      if (window.__xss && window.__xss.length) { add('typed text ran as code', null, window.__xss.join(', ')); window.__xss = []; }
      document.querySelectorAll('[data-xss]').forEach(el => add('typed text became markup', el.parentElement, `<${el.tagName.toLowerCase()}> from ${el.getAttribute('data-xss')}`));
      document.querySelectorAll('[onerror]').forEach(el => add('typed text became markup', el, 'an onerror attribute'));
      return out;
    }

    // ── &a11y=1: what a screen-reader or keyboard user meets ──
    // Names: every control says what it is (aria-label, a <label>, its own
    // text), never only a symbol like ✏️ or ▲, and never only a placeholder.
    // Contrast: text against what is actually behind it, WCAG AA (4.5:1, or
    // 3:1 for large text). Focus: a control looks different when focused.
    // Windows: an open one is announced as a dialog and holds the focus.
    // Language: the page says which language it is in.
    const toRGB = c => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const over = (top, bottom) => { const a = top.a + bottom.a * (1 - top.a); if (!a) return { r: 0, g: 0, b: 0, a: 0 };
      return { r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a, g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a, b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a, a }; };
    const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    // What is painted behind an element: its own and its ancestors' backgrounds,
    // stacked; null when an image or gradient is in the way (can't be measured).
    const backdrop = el => {
      const layers = [];
      for (let e = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.backgroundImage && s.backgroundImage !== 'none') return null;
        const c = toRGB(s.backgroundColor);
        if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
      }
      let base = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
      return base;
    };
    const accName = el => {
      const by = el.getAttribute('aria-labelledby');
      if (by) return by.split(/\s+/).map(id => (document.getElementById(id) || {}).textContent || '').join(' ').trim();
      const al = (el.getAttribute('aria-label') || '').trim();
      if (al) return al;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
        if (el.labels && el.labels.length) return [...el.labels].map(l => l.textContent).join(' ').trim();
        if (/^(button|submit|reset)$/.test(el.type)) return el.value;
        return (el.title || '').trim();
      }
      const own = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() + [...el.querySelectorAll('img[alt]')].map(i => i.alt).join(' ');
      return (own || el.title || '').trim();
    };
    const hasWords = s => /[\p{L}\p{N}]/u.test(s);
    function a11yAudit(screen) {
      const out = [];
      const add = (kind, el, detail) => out.push({ screen, kind, at: el ? name(el) : '', text: el ? snippet(el) : '', detail: detail || '' });
      const root = rootOf();
      const visible = el => { if (el.closest('[aria-hidden="true"],[hidden]')) return false; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; } const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const controls = [...root.querySelectorAll('button, a[href], input, select, textarea, summary, [role="button"], [role="option"], [role="tab"], [onclick]')]
        .filter(el => !(el.tagName === 'INPUT' && el.type === 'hidden') && visible(el));
      controls.forEach(el => {
        const n = accName(el), field = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
        if (field) {
          if (!n) add(el.placeholder ? 'field labelled only by its placeholder' : 'field with no label', el, el.placeholder ? `placeholder “${el.placeholder}”` : el.id || el.type);
        } else if (!n) add('control with no name', el);
        else if (!hasWords(n)) add('control named only by a symbol', el, `reads as “${n}”`);
        // Something clickable that isn't a real control can't be reached by keyboard.
        const native = /^(BUTTON|A|INPUT|SELECT|TEXTAREA|SUMMARY|LABEL)$/.test(el.tagName);
        if (!native && el.hasAttribute('onclick') && !el.closest('button, a[href]') && el.getAttribute('role') !== 'option' && !(el.tabIndex >= 0 && el.getAttribute('role')))
          add('clickable but not reachable by keyboard', el, `<${el.tagName.toLowerCase()}> with onclick, no role and tabindex`);
      });
      // An open window is a dialog with a name, and the focus is inside it.
      // (Checked before the focus sampling below, which moves the focus.)
      const win = root.classList && root.classList.contains('modal-backdrop') ? root : null;
      if (win) {
        const box = win.querySelector('[role="dialog"], [role="alertdialog"]') || (win.matches('[role="dialog"],[role="alertdialog"]') ? win : null);
        if (!box) add('window not announced as a dialog', win);
        else if (!box.getAttribute('aria-labelledby') && !box.getAttribute('aria-label')) add('dialog with no name', box);
        else if (box.getAttribute('aria-modal') !== 'true') add('dialog not marked modal', box);
        if (!win.contains(document.activeElement)) add('focus left behind the open window', win, `focus is on ${document.activeElement ? name(document.activeElement) : 'nothing'}`);
      }
      // Focus shows. Sampled, since focusing everything is slow; transitions
      // are paused so the focused look is read, not its first frame.
      const noAnim = document.createElement('style');
      noAnim.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
      document.head.appendChild(noAnim);
      controls.filter(el => !el.disabled).slice(0, 60).forEach(el => {
        const look = () => { const s = getComputedStyle(el); return [s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 ? 'o' : '', s.boxShadow, s.borderColor, s.backgroundColor, s.textDecorationLine].join('|'); };
        if (document.activeElement === el) el.blur();   // already focused (a window's first field): compare against unfocused
        const before = look();
        el.focus({ preventScroll: true });
        if (document.activeElement !== el) return;
        const after = look();
        el.blur();
        if (after === before || (!after.startsWith('o') && after.split('|').slice(1).join('|') === before.split('|').slice(1).join('|'))) add('no visible focus', el);
      });
      noAnim.remove();
      // Contrast of every piece of text.
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => /\S/.test(n.nodeValue) ? 1 : 3 });
      const done = new Set();
      for (let t; (t = walker.nextNode());) {
        const el = t.parentElement;
        if (!el || done.has(el) || /^(SCRIPT|STYLE|OPTION|TITLE)$/.test(el.tagName) || !visible(el) || el.closest('[disabled], .acc-move[disabled]')) continue;
        if (!hasWords(t.nodeValue)) continue;   // emoji and symbols are drawn in their own colours
        done.add(el);
        const s = getComputedStyle(el);
        const fg = toRGB(s.color); if (!fg) continue;
        let op = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) op *= +getComputedStyle(e).opacity;
        const bg = backdrop(el); if (!bg) continue;
        const shown = over({ ...fg, a: fg.a * op }, bg);
        const size = parseFloat(s.fontSize), bold = +s.fontWeight >= 700;
        const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
        const r = ratio(shown, bg);
        if (r < need - 0.05) add('text contrast too low', el, `${r.toFixed(2)}:1, needs ${need}:1 (${s.color} on rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}), ${size}px)`);
      }
      // Pictures and charts say what they show.
      root.querySelectorAll('img').forEach(img => { if (visible(img) && !img.hasAttribute('alt')) add('image with no alt text', img); });
      root.querySelectorAll('svg').forEach(svg => {
        const r = svg.getBoundingClientRect();
        if (!visible(svg) || r.width < 120 || r.height < 60 || svg.closest('[aria-hidden="true"]')) return;
        if (!svg.getAttribute('aria-label') && !svg.getAttribute('aria-labelledby') && !svg.querySelector('title') && !svg.closest('[role="img"][aria-label]'))
          add('chart with no description', svg);
      });
      const lang = document.documentElement.lang || '';
      if ((state.language === 'zh') !== lang.startsWith('zh')) add('page language does not match what it shows', null, `lang="${lang}" while showing ${state.language}`);
      const seen = new Map();
      out.forEach(f => { const k = f.kind + '|' + f.at + '|' + f.text; if (seen.has(k)) seen.get(k).count++; else seen.set(k, Object.assign(f, { count: 1 })); });
      return [...seen.values()];
    }

    // Measure in the app's own fonts, not a fallback that is wider or narrower.
    await Promise.race([document.fonts.ready, wait(5000)]);
    const only = P.get('screen');
    if (only) { closeAll(); await SCREENS[only](); return; }
    const findings = [];
    for (const [screen, open] of Object.entries(SCREENS)) {
      closeAll();
      try { await open(); } catch (e) { errors.push(`${screen}: ${e.message}`); continue; }
      await wait(350);
      // Let fades and slides finish, or a half-faded page looks hidden.
      const ending = document.getAnimations().filter(an => an.effect && an.effect.getComputedTiming().iterations !== Infinity);
      await Promise.race([Promise.all(ending.map(an => an.finished.catch(() => {}))), wait(2000)]);
      findings.push(...(P.get('a11y') === '1' ? a11yAudit(screen) : POISON ? xssAudit(screen) : audit(screen)));
    }
    closeAll();
    const pre = document.createElement('pre');
    pre.id = 'e2e'; pre.style.display = 'none';
    pre.textContent = JSON.stringify({ findings, errors, screens: Object.keys(SCREENS) });
    document.body.appendChild(pre);
  }, 300);
