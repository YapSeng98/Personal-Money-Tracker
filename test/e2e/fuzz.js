  // ── Random use ───────────────────────────────────────────────────────────
  // ?view=fuzz&seed=N&steps=M drives the real app through M random everyday
  // actions, through its own forms and functions: adding, editing and deleting
  // every kind of row (with and without undo), bulk delete and recategorise,
  // repeats coming due, renaming accounts and changing their type or currency,
  // adding and deleting accounts, goals and bills, dropping the connection and
  // reloading. The fake server applies each write the way Postgres would
  // (fake-supabase.js, apply mode), so a write it would refuse is caught here.
  //
  // After every step the whole book is checked:
  //   • no duplicate ids; every amount a positive number, every date real;
  //   • no broken transfer or purchase pairs, and each pair's two sides agree;
  //   • every row is in its account's currency and names an account that
  //     exists (or one that was deleted); so do goals and bills;
  //   • every balance equals its starting balance plus its rows, and a goal
  //     tracking an account shows that balance;
  //   • a repeat never adds the same occurrence twice;
  //   • once online, nothing is left waiting or refused, and the server holds
  //     exactly what the screen shows, field for field;
  //   • a reload shows exactly what was there before it;
  //   • undo puts back exactly what was deleted.
  // Results go into pre#e2e in the same shape as checks.js's.
  if (VIEW === 'fuzz' || VIEW === 'health') setTimeout(async () => {
    const results = [], errors = [], counts = {}, failed = new Map(), ops = {};
    window.addEventListener('error', e => errors.push('error: ' + e.message));
    window.addEventListener('unhandledrejection', e => errors.push('rejection: ' + ((e.reason && e.reason.message) || e.reason)));
    let seed = +(P.get('seed') || 1);
    const STEPS = +(P.get('steps') || 150);
    // mulberry32: an earlier multiply-and-add generator lost precision in doubles
    // and fell into a loop of 10,466 numbers, so most runs repeated each other.
    const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const pick = a => a[Math.floor(rnd() * a.length)];
    const chance = p => rnd() < p;
    const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
    const $ = s => document.querySelector(s);
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const r2 = v => Math.round(v * 100) / 100;
    const log = [];
    let step = 0;
    const check = (cond, name, detail) => {
      counts[name] = (counts[name] || 0) + 1;
      if (cond) return;
      if (failed.has(name)) { failed.get(name).times++; return; }
      const d = typeof detail === 'function' ? detail() : detail;
      failed.set(name, { times: 1, detail: `seed ${P.get('seed') || 1}, step ${step}: ${String(d).slice(0, 400)}\n      after: ${log.slice(-6).join(' → ')}` });
    };

    // ── the starting book: a real backup as its server holds it, or
    //    seed.js's rows with real ids, on a fake server ──
    const S = window.__sb;
    const real = window.__serverSeed;
    if (real) {
      state.userId = real.uid; state.outbox = []; state.outboxRejected = [];
      S.tables = JSON.parse(JSON.stringify(real.tables));
      S.tables.backups = [];
    } else {
    state.userId = newId();
    state.outbox = []; state.outboxRejected = [];
    state.transactions.forEach(t => { t.id = newId(); });
    state.accounts.forEach(a => { a.id = newId(); });
    state.budgets.forEach(b => { b.id = newId(); });
    state.goals = []; state.bills = [];
    state.accounts.push({ id: newId(), name: 'Binance', type: 'Crypto', institution: 'Binance', balance: 500, currency: 'USDT', icon: '🪙' },
                        { id: newId(), name: 'UOB Card', type: 'Credit Card', institution: 'UOB', balance: -300, currency: 'SGD', icon: '💳' });
    const uid = state.userId;
    S.tables = {
      transactions: state.transactions.map(t => ({ id: t.id, user_id: uid, type: t.type, amount: t.amount, description: t.description, category: t.category,
        account: t.account, date: t.date, notes: t.notes || '', currency: t.currency, transfer_group: t.transferGroup || null, transfer_peer: t.transferPeer || null,
        is_recurring: false, recurring_frequency: null, next_run_date: null, recurring_source: null, created_at: t.date + 'T01:00:00Z' })),
      accounts: state.accounts.map(a => ({ id: a.id, user_id: uid, name: a.name, type: a.type, institution: a.institution, currency: a.currency,
        starting_balance: a.balance, is_active: true, icon: a.icon, created_at: '2026-01-01T00:00:00Z' })),
      budgets: state.budgets.map(b => ({ id: b.id, user_id: uid, category: b.category, amount: b.amount, spent: 0, alert_amount: 0, currency: b.currency,
        rollover: false, period_start: null, period_end: null, created_at: '2026-01-01T00:00:00Z' })),
      goals: [], bills: [], backups: [], preferences: []
    };
    }
    S.apply = true;
    // Every third run, a database that hasn't had migration 007: the order
    // must still work, stay on the device, and never be sent.
    if ((+(P.get('seed') || 1)) % 3 === 0) S.without = { accounts: ['sort_order'] };
    showView('settings');   // a light page to redraw after every step

    // Dialogs answer yes; the undo toast hands its two choices to the test;
    // toasts are kept so a refused save can be told apart from a saved one.
    window.showConfirm = async () => true;
    let undo = null;
    window.undoToast = (msg, restore, commit) => { undo = { restore, commit }; };
    const toasts = [];
    window.showToast = (msg, kind) => { toasts.push([kind, String(msg)]); };
    window.alert = () => {}; window.confirm = () => true;

    const settle = async () => { for (let i = 0; i < 3; i++) { await wait(0); await flushOutbox(); } };
    const reload = async () => { await snLoadAll(); renderAll(); await settle(); };

    const today = localDateStr();
    const accts = () => state.accounts;
    const curOf = a => a.currency || state.currency;
    const deleted = new Set(['Cash', '']);   // names rows may point at with no account behind them
    const moved = new Set();                 // rows whose date was edited by hand
    const rescheduled = new Set();           // repeats whose date or frequency was edited
    const money = () => chance(0.05) ? 0.01 : r2(chance(0.1) ? 1000 + rnd() * 50000 : 1 + rnd() * 300);
    const dateIn = () => addDaysStr(today, chance(0.05) ? int(1, 40) : -int(0, 220));
    const DESC = ['Lunch', 'Grab', 'Daily transport', '午餐', "O'Brien & Co", '<b>bold</b>', 'Rent', 'Salary', 'Top up', 'Tea  break ', 'Refund #2'];
    const sameCur = (a, others) => others.filter(o => o.name !== a.name && curOf(o) === curOf(a));
    const plainRows = () => state.transactions.filter(t => !t.transferGroup && ['expense', 'income', 'payback'].includes(t.type));
    const groups = () => { const m = new Map(); state.transactions.forEach(t => { if (t.transferGroup) (m.get(t.transferGroup) || m.set(t.transferGroup, []).get(t.transferGroup)).push(t); }); return m; };
    const errorsSince = n => toasts.slice(n).filter(t => t[0] === 'error').map(t => t[1]);

    // Fill the open transaction form and save it; returns any error toasts.
    async function save(f) {
      if (f.type) setType(f.type, $('#tab-' + f.type));
      if (f.account !== undefined) { $('#txn-account').value = f.account; onTxnAccountChange(); }
      if (state.currentType === 'transfer') {
        if (f.to !== undefined) populateToAccounts(f.to);
        updateTransferUI();
        if (f.recv !== undefined) $('#txn-amount-recv').value = f.recv;
      }
      if (state.currentType === 'asset' && f.fund !== undefined) { populateFundAccounts(f.fund); updateAssetUI(); }
      if (f.amount !== undefined) $('#txn-amount').value = f.amount;
      if (f.desc !== undefined) $('#txn-desc').value = f.desc;
      if (f.cat !== undefined && [...$('#txn-cat').options].some(o => o.value === f.cat)) $('#txn-cat').value = f.cat;
      if (f.date !== undefined) $('#txn-date').value = f.date;
      if (f.repeat !== undefined && $('#txn-repeat-group').style.display !== 'none') $('#txn-repeat').value = f.repeat;
      const n = toasts.length;
      await saveTransaction();
      closeTxnModal();
      return errorsSince(n);
    }
    const catFor = () => pick([...$('#txn-cat').options].map(o => o.value));

    // Delete through the app, then undo or let it go through.
    function resolveUndo(before, label) {
      if (!undo) return;
      const u = undo; undo = null;
      if (chance(0.3)) {
        u.restore();
        const after = new Set(state.transactions.map(t => String(t.id)));
        check(before.size === after.size && [...before].every(id => after.has(id)), 'undo puts back exactly what was deleted', `${label}: ${before.size} rows before, ${after.size} after undo`);
        log[log.length - 1] += ' (undone)';
      } else u.commit();
    }

    const OPS = [
      [24, 'add a row', async () => {
        const type = pick(['expense', 'expense', 'expense', 'income', 'payback']), a = pick(accts());
        openTxnModal(); setType(type, $('#tab-' + type));
        const repeat = chance(0.12) ? pick(['weekly', 'monthly', 'yearly']) : '';
        const errs = await save({ type, account: a.name, amount: money(), desc: pick(DESC), cat: catFor(), date: dateIn(), repeat });
        check(!errs.length, 'a valid row is accepted', `${type} on ${a.name}: ${errs.join('; ')}`);
        return `${type}${repeat ? ' (' + repeat + ')' : ''} on ${a.name}`;
      }],
      [10, 'add a transfer', async () => {
        const a = pick(accts()), b = pick(accts().filter(x => x.name !== a.name));
        if (!b) return null;
        openTxnModal();
        const cross = curOf(a) !== curOf(b);
        const errs = await save({ type: 'transfer', account: a.name, to: b.name, amount: money(), recv: cross ? money() : undefined, desc: pick(DESC), date: dateIn() });
        check(!errs.length, 'a valid transfer is accepted', `${a.name} → ${b.name}: ${errs.join('; ')}`);
        return `transfer ${a.name} → ${b.name}`;
      }],
      [6, 'add a purchase', async () => {
        const a = pick(accts()), src = chance(0.6) ? pick(sameCur(a, accts())) : null;
        openTxnModal();
        const errs = await save({ type: 'asset', account: a.name, fund: src ? src.name : '', amount: money(), desc: pick(DESC), cat: undefined, date: dateIn() });
        check(!errs.length, 'a valid purchase is accepted', `${a.name} from ${src ? src.name : 'nothing'}: ${errs.join('; ')}`);
        return `purchase into ${a.name}${src ? ' from ' + src.name : ''}`;
      }],
      [12, 'edit a row', async () => {
        const t = pick(plainRows());
        if (!t) return null;
        openTxnModal(t.id);
        const f = {};
        if (chance(0.5)) f.amount = money();
        if (chance(0.3)) f.desc = pick(DESC);
        if (chance(0.3)) f.date = dateIn();
        if (chance(0.3)) f.account = pick(accts()).name;
        if (chance(0.2)) { f.type = pick(['expense', 'income', 'payback']); setType(f.type, $('#tab-' + f.type)); }
        if (chance(0.3)) f.cat = catFor();
        if (!t.recurringSource && chance(0.15)) f.repeat = pick(['', 'weekly', 'monthly', 'yearly']);
        if (f.date) moved.add(String(t.id));
        if (t.isRecurring && (f.date || 'repeat' in f)) rescheduled.add(String(t.id));
        const was = { ...t };
        const errs = await save(f);
        check(!errs.length, 'a valid edit is accepted', `${Object.keys(f).join(',')}: ${errs.join('; ')}`);
        const now = state.transactions.find(x => x.id === t.id) || {};
        const kept = ['account', 'currency', 'category', 'type', 'description', 'amount', 'date'].filter(k => {
          const touched = k === 'currency' ? 'account' in f : k === 'category' ? 'cat' in f || 'type' in f : k === 'description' ? 'desc' in f : k in f;
          return !touched && JSON.stringify(now[k]) !== JSON.stringify(k === 'description' ? String(was[k]).trim() : was[k]);
        });
        check(!kept.length, 'editing a row changes only what was edited', () => kept.map(k => `${k}: ${JSON.stringify(was[k])} became ${JSON.stringify(now[k])}`).join('; ') + ` (on “${was.account}”)`);
        return `edit ${t.type} (${Object.keys(f).join(', ') || 'nothing'})`;
      }],
      [6, 'edit a transfer', async () => {
        const legs = [...groups().values()].filter(g => g.length === 2 && g.some(l => l.type === 'income') && g.some(l => l.type === 'expense'));
        const g = pick(legs);
        if (!g) return null;
        const out = g.find(l => l.type === 'expense');
        openTxnModal(out.id);
        const a = chance(0.3) ? pick(accts()) : accts().find(x => x.name === out.account) || pick(accts());
        const others = accts().filter(x => x.name !== a.name);
        const b = chance(0.3) || !others.some(x => x.name === g.find(l => l.type === 'income').account) ? pick(others) : others.find(x => x.name === g.find(l => l.type === 'income').account);
        const cross = curOf(a) !== curOf(b);
        const errs = await save({ account: a.name, to: b.name, amount: chance(0.6) ? money() : undefined, recv: cross ? money() : undefined, date: chance(0.3) ? dateIn() : undefined });
        check(!errs.length, 'a valid transfer edit is accepted', `${a.name} → ${b.name}: ${errs.join('; ')}`);
        return `edit transfer → ${a.name} → ${b.name}`;
      }],
      [4, 'edit a transfer\'s description only', async () => {
        const g = pick([...groups().values()].filter(l => l.length === 2 && l.some(x => x.type === 'income') && l.some(x => x.type === 'expense')));
        if (!g) return null;
        const was = g.map(l => ({ ...l }));
        openTxnModal(g.find(l => l.type === 'expense').id);
        const errs = await save({ desc: pick(DESC) + ' ' + int(1, 99) });
        check(!errs.length, 'a transfer whose accounts are untouched saves', errs.join('; '));
        const changed = was.flatMap(w => { const now = state.transactions.find(x => x.id === w.id) || {}; return ['account', 'currency', 'amount', 'type', 'date'].filter(k => now[k] !== w[k]).map(k => `${w.type} ${k}: ${w[k]} → ${now[k]}`); });
        check(!changed.length, 'editing a transfer\'s description changes nothing else', () => changed.join('; '));
        return 'edit transfer description';
      }],
      [6, 'edit a purchase', async () => {
        const t = pick(state.transactions.filter(x => x.type === 'asset'));
        if (!t) return null;
        openTxnModal(t.id);
        const hold = accts().find(x => x.name === t.account && curOf(x) === (t.currency || state.currency));
        if (!hold) { closeTxnModal(); return null; }
        // Sometimes only the amount: a funded purchase must stay funded.
        if (chance(0.3)) {
          const before = state.transactions.filter(x => x.transferGroup && x.transferGroup === t.transferGroup).length;
          const n = toasts.length;
          await save({ amount: money() });
          const after = state.transactions.filter(x => x.transferGroup && x.transferGroup === t.transferGroup).length;
          check(errorsSince(n).length || after === before, 'editing a purchase\'s amount keeps how it was paid for', () => `${before} rows in its pair before, ${after} after`);
          return `edit purchase amount in ${hold.name}`;
        }
        const src = chance(0.5) ? pick(sameCur(hold, accts())) : null;
        const errs = await save({ fund: src ? src.name : '', amount: chance(0.5) ? money() : undefined });
        check(!errs.length, 'a valid purchase edit is accepted', `${hold.name} from ${src ? src.name : 'nothing'}: ${errs.join('; ')}`);
        return `edit purchase in ${hold.name} → funded from ${src ? src.name : 'nothing'}`;
      }],
      [8, 'delete a row', async () => {
        const t = pick(state.transactions);
        if (!t) return null;
        const before = new Set(state.transactions.map(x => String(x.id)));
        await deleteTransaction(t.id);
        const gone = t.transferGroup ? state.transactions.filter(x => x.transferGroup === t.transferGroup).length === 0 : !state.transactions.includes(t);
        check(gone, 'deleting removes the row, and both sides of a pair', t.transferGroup);
        log.push(`delete ${t.transferGroup ? 'a pair' : t.type}`);
        resolveUndo(before, 'single delete');
        return '';
      }],
      [4, 'bulk delete', async () => {
        const n = int(1, 5), ids = [...new Set(Array.from({ length: n }, () => pick(state.transactions)).filter(Boolean).map(t => String(t.id)))];
        if (!ids.length) return null;
        const before = new Set(state.transactions.map(x => String(x.id)));
        bulkSelected.clear(); ids.forEach(id => bulkSelected.add(id)); bulkMode = true;
        await bulkDeleteSelected();
        log.push(`bulk delete ${ids.length}`);
        resolveUndo(before, 'bulk delete');
        return '';
      }],
      [4, 'bulk recategorise', async () => {
        const ids = [...new Set(Array.from({ length: int(1, 5) }, () => pick(state.transactions)).filter(Boolean).map(t => String(t.id)))];
        bulkSelected.clear(); ids.forEach(id => bulkSelected.add(id)); bulkMode = true;
        populateBulkCategorySelect();
        const opts = [...$('#bulk-cat-select').options].map(o => o.value).filter(Boolean);
        $('#bulk-cat-select').value = pick(opts);
        await bulkApplyCategory();
        return `recategorise ${ids.length} as ${$('#bulk-cat-select').value || '?'}`;
      }],
      [4, 'rename an account', async () => {
        const a = pick(accts());
        openAccountModal(a.id);
        const name = (chance(0.5) ? 'Acct ' : 'Account “') + Math.floor(rnd() * 1e6);
        $('#acc-name').value = name;
        if (chance(0.3)) { $('#acc-type').value = pick([...$('#acc-type').options].map(o => o.value)); }
        if (chance(0.3)) $('#acc-balance').value = String(r2((rnd() - 0.3) * 5000));
        const n = toasts.length;
        await saveAccount();
        check(!errorsSince(n).length, 'a valid account edit is accepted', errorsSince(n).join('; '));
        return `rename ${a.name} → ${name}`;
      }],
      [2, 'reuse an account name', async () => {
        const a = pick(accts()), b = pick(accts().filter(x => x.id !== a.id));
        if (!b) return null;
        const n = toasts.length, count = accts().length;
        if (chance(0.5)) { openAccountModal(a.id); $('#acc-name').value = chance(0.5) ? b.name : b.name.toUpperCase(); }
        else { openAccountModal(); $('#acc-name').value = ' ' + b.name.toLowerCase() + ' '; $('#acc-balance').value = '10'; }
        await saveAccount();
        $('#account-modal').classList.remove('open');
        check(errorsSince(n).length && accts().length === count && accts().find(x => x.id === a.id).name === a.name, 'an account name already in use is refused', () => `${a.name} / ${b.name}: ${accts().map(x => x.name).join(', ')}`);
        return `try to reuse “${b.name}”`;
      }],
      [2, 'change an account\'s currency', async () => {
        const a = pick(accts());
        openAccountModal(a.id);
        const cur = pick(['SGD', 'USD', 'MYR', 'USDT', 'AUD'].filter(c => c !== curOf(a)));
        $('#acc-currency').value = cur;
        await saveAccount();
        return `${a.name} → ${cur}`;
      }],
      [3, 'add an account', async () => {
        openAccountModal();
        const name = 'New ' + Math.floor(rnd() * 1e6);
        $('#acc-name').value = name;
        $('#acc-type').value = pick([...$('#acc-type').options].map(o => o.value));
        $('#acc-currency').value = pick(['SGD', 'USD', 'MYR', 'USDT', 'AUD']);
        $('#acc-balance').value = String(r2((rnd() - 0.2) * 3000));
        await saveAccount();
        return `add account ${name}`;
      }],
      [2, 'delete an account', async () => {
        if (accts().length < 4) return null;
        const a = pick(accts());
        deleted.add(a.name);
        await deleteAccount(String(a.id));
        check(!accts().some(x => x.id === a.id), 'a deleted account is gone from the list', a.name);
        return `delete account ${a.name}`;
      }],
      [3, 'add a goal', async () => {
        openGoalModal();
        $('#goal-name').value = 'Goal ' + Math.floor(rnd() * 1e4);
        $('#goal-target').value = String(r2(100 + rnd() * 20000));
        $('#goal-currency').value = pick(['SGD', 'USD', 'MYR', 'USDT']);
        populateGoalAccountOptions('');
        const links = [...$('#goal-account').options].map(o => o.value).filter(Boolean);
        if (links.length && chance(0.7)) { $('#goal-account').value = pick(links); onGoalAccountChange(); }
        if (chance(0.25)) $('#goal-date').value = '';
        const n = toasts.length;
        await saveGoal();
        check(!errorsSince(n).length, 'a valid goal is accepted', errorsSince(n).join('; '));
        return `goal${$('#goal-account').value ? ' tracking ' + $('#goal-account').value : ''}${$('#goal-date').value ? '' : ' with no date'}`;
      }],
      [2, 'edit a goal', async () => {
        const g = pick(state.goals);
        if (!g) return null;
        openGoalModal(g.id);
        $('#goal-target').value = String(r2(100 + rnd() * 20000));
        if (chance(0.3)) $('#goal-date').value = chance(0.5) ? '' : addDaysStr(today, int(30, 2000));
        await saveGoal();
        return `edit goal ${g.name}`;
      }],
      [2, 'add a bill', async () => {
        openBillModal();
        $('#bill-name').value = pick(['Phone', 'Netflix', 'Rent', 'Insurance']) + ' ' + int(1, 99);
        $('#bill-amount').value = String(money());
        $('#bill-due-day').value = String(int(1, 31));
        const cur = pick(['SGD', 'MYR', 'USD']);
        $('#bill-currency').value = cur;
        const acc = pick([null, ...accts().filter(a => curOf(a) === cur)]);
        if ([...$('#bill-account').options].some(o => o.value === (acc ? acc.name : ''))) $('#bill-account').value = acc ? acc.name : '';
        const n = toasts.length;
        await saveBill();
        check(!errorsSince(n).length, 'a valid bill is accepted', errorsSince(n).join('; '));
        return `bill on ${acc ? acc.name : 'any account'}`;
      }],
      [2, 'plan budgets from a salary', async () => {
        showView('budgets');
        if ($('#salary-planner-body').style.display === 'none') toggleSalaryPlanner();
        $('#sp-currency').value = pick(['SGD', 'MYR', 'USD']); onSalaryPlannerCurrencyChange();
        $('#sp-salary').value = String(r2(1000 + rnd() * 9000)); $('#sp-salary').dispatchEvent(new Event('input'));
        const inputs = [...document.querySelectorAll('.sp-legend-pct-input')];
        inputs.forEach(inp => { inp.value = chance(0.4) ? String(int(1, 30)) : ''; });
        await applySalaryPlanToBudgets();
        if ($('#salary-planner-body').style.display !== 'none') toggleSalaryPlanner();
        showView('settings');
        return `plan budgets in ${$('#sp-currency').value}`;
      }],
      [4, 'move an account up or down', async () => {
        const a = pick(accts()), dir = pick(['up', 'down']);
        const same = accts().filter(x => curOf(x) === curOf(a)), at = same.indexOf(a);
        const other = same[dir === 'up' ? at - 1 : at + 1];
        const before = accts().map(x => x.name);
        showView('accounts'); if (!_arrangingAccounts) toggleArrangeAccounts();
        const btn = document.querySelector(`#accounts-list [data-move="${a.id}:${dir}"]`);
        check(!!btn && btn.disabled === !other, 'each account has ▲ ▼, off at the ends of its currency', () => `${a.name} ${dir}: ${btn ? (btn.disabled ? 'disabled' : 'enabled') : 'missing'}, neighbour ${other ? other.name : 'none'}`);
        if (btn && !btn.disabled) btn.click();
        const after = accts().map(x => x.name);
        if (other) {
          const want = before.slice(); const i = want.indexOf(a.name), j = want.indexOf(other.name); [want[i], want[j]] = [want[j], want[i]];
          check(after.join('|') === want.join('|'), 'moving swaps an account with its neighbour in the same currency, nothing else', () => `${before.join(' | ')}\n      → ${after.join(' | ')}`);
        } else check(after.join('|') === before.join('|'), 'at the end of its currency, an account stays put');
        const listed = [...document.querySelectorAll('#accounts-list .account-name')].map(e => e.textContent);
        const grouped = [...new Set(accts().map(curOf))].sort(byHomeCurrency).flatMap(c => accts().filter(x => curOf(x) === c).map(x => x.name));
        check(listed.join('|') === (new Set(accts().map(curOf)).size > 1 ? grouped : accts().map(x => x.name)).join('|'), 'the Accounts page lists them in that order', () => listed.join(' | '));
        openTxnModal();
        const picker = [...$('#txn-account').options].map(o => o.value);
        closeTxnModal();
        check(picker.join('|') === [...new Set(accts().map(curOf))].sort().flatMap(c => accts().filter(x => curOf(x) === c).map(x => x.name)).join('|') || (new Set(accts().map(curOf)).size === 1 && picker.join('|') === accts().map(x => x.name).join('|')),
              'the transaction form offers accounts in the same order', () => picker.join(' | '));
        if (chance(0.5)) toggleArrangeAccounts();
        showView('settings');
        return `move ${a.name} ${dir}`;
      }],
      [3, 'update an account to its real balance', async () => {
        const a = pick(accts());
        openBalanceModal(a.id);
        const date = chance(0.7) ? today : addDaysStr(today, -int(0, 200));
        $('#bal-date').value = date; $('#bal-date').dispatchEvent(new Event('change'));
        const had = balanceOn(a, date), actual = chance(0.1) ? had : r2(had + (rnd() - 0.5) * (chance(0.1) ? 200000 : 2000));
        $('#bal-actual').value = String(actual); $('#bal-actual').dispatchEvent(new Event('input'));
        const n = state.transactions.length;
        await saveBalanceUpdate(); closeBalanceModal();
        check(balanceOn(a, date) === actual && state.transactions.length === n + (actual === had ? 0 : 1), 'updating a balance makes that day end at exactly what was typed, with one row',
              () => `${a.name} on ${date}: ${balanceOn(a, date)} vs ${actual} (${state.transactions.length - n} rows)`);
        return `update ${a.name} to ${actual}`;
      }],
      [4, 'again today', async () => {
        const t = pick(state.transactions);
        if (!t) return null;
        const legs = t.transferGroup ? state.transactions.filter(x => x.transferGroup === t.transferGroup) : [t];
        const ids = new Set(state.transactions.map(x => String(x.id)));
        repeatToday(t.id);
        const n = toasts.length;
        await saveTransaction(); closeTxnModal();
        const added = state.transactions.filter(x => !ids.has(String(x.id)));
        // A purchase whose two sides are in different currencies (an account's
        // currency changed since) can't be made again as it is: say so, add nothing.
        if (legs.length === 2 && legs.some(x => x.type === 'asset') && legs[0].currency !== legs[1].currency) {
          const fund = legs.find(x => x.type !== 'asset'), fundAcc = accts().find(a => a.name === fund.account);
          if (fundAcc) check(errorsSince(n).length && !added.length, 'Again today refuses, rather than half-copies, a purchase across currencies', () => `added ${added.length}`);
          else check(added.length === 2 && !pairProblems().length, 'Again today copies a purchase whose source was deleted as a whole pair', () => `added ${added.length}`);
          return 'again today: a purchase across currencies';
        }
        // (A pair's copy takes the sending side's description for both sides, as every pair the app makes.)
        const desc = String((legs.find(x => x.type === 'expense') || t).description).trim();
        const shape = (x, copied) => [x.type, x.amount, x.account, x.currency || state.currency, copied || !t.transferGroup ? String(x.description).trim() : desc].join('|');
        check(!errorsSince(n).length && added.length === legs.length && added.every(x => x.date === today && !x.isRecurring && !x.recurringSource)
              && legs.map(x => shape(x)).sort().join() === added.map(x => shape(x, true)).sort().join(), 'Again today saves the same transaction dated today, as a new one',
              () => `${errorsSince(n).join('; ')} | was ${legs.map(x => shape(x)).join(', ')} | added ${added.map(x => shape(x, true) + ' ' + x.date).join(', ')}`);
        return `again today: ${t.transferGroup ? 'a pair' : t.type}`;
      }],
      [4, 'another device changes the book', async () => {
        // A row added, edited or deleted on the server by another device, then
        // a reload: it arrives here, unless this device still has its own
        // change to that row waiting, which wins.
        await runRecurring(); renderAll(); await settle();   // as the reload step does: what loading would add anyway
        const before = snap(), what = pick(['adds', 'edits', 'deletes']);
        const pending = new Set(outbox().map(o => o.rowId));
        const rows = S.tables.transactions.filter(r => !r.transfer_group && !r.is_recurring && !r.recurring_source && !pending.has(String(r.id)));
        let expect = JSON.parse(JSON.stringify(before)), said;
        if (what === 'adds' || !rows.length) {
          const a = pick(accts());
          const r = { id: newId(), user_id: state.userId, type: 'expense', amount: money(), description: 'From my laptop', category: 'Other', account: a.name,
            date: addDaysStr(today, -int(0, 30)), notes: '', currency: curOf(a), transfer_group: null, transfer_peer: null, is_recurring: false,
            recurring_frequency: null, next_run_date: null, recurring_source: null, created_at: new Date().toISOString() };
          S.tables.transactions.push(r);
          expect.transactions.push(txnShape({ ...r, transferGroup: '', transferPeer: '', isRecurring: false }));
          said = `laptop adds a row on ${a.name}`;
        } else if (what === 'edits') {
          const r = pick(rows);
          r.amount = money(); r.description = 'Fixed on my laptop';
          const e = expect.transactions.find(x => x.id === String(r.id));
          if (e) { e.amount = r.amount; e.description = r.description; }
          said = 'laptop edits a row';
        } else {
          const r = pick(rows);
          S.tables.transactions = S.tables.transactions.filter(x => x !== r);
          expect.transactions = expect.transactions.filter(x => x.id !== String(r.id));
          said = 'laptop deletes a row';
        }
        expect.transactions.sort((a, b) => (a.id < b.id ? -1 : 1));
        await reload();
        // (A goal tracking an account follows its balance; that has its own check.)
        const diff = firstDiff(expect, snap(), ['current']);   // (sortOrder is on the server once synced, so it matches either way)
        check(!diff, 'another device\'s change arrives on reload, and nothing else changes', () => `${said}: ${diff}`);
        return said;
      }],
      [3, 'repair a broken pair', async () => {
        // Old data can hold pairs the app no longer makes. Put one on the
        // server, load it, and fix it with one of the Data check's buttons.
        const shapes = { lone: ['income'], 'both leaving': ['expense', 'expense'], 'both arriving': ['income', 'income'], same: ['expense', 'income'],
                         three: ['expense', 'income', 'income'], 'purchase funded by an arriving row': ['income', 'asset'] };
        const shape = pick(Object.keys(shapes));
        const a = pick(accts()), b = pick(sameCur(a, accts()));
        if (!b) return null;
        const g = (shape.startsWith('purchase') ? 'ag_' : 'tg_') + 'broken' + int(1, 1e6);
        const date = dateIn(), amt = money();
        shapes[shape].forEach((type, i) => S.tables.transactions.push({ id: newId(), user_id: state.userId, type, amount: amt, description: 'Old ' + shape,
          category: type === 'asset' ? 'Investment' : 'Transfer', account: shape === 'same' || i === 0 ? a.name : b.name, date, notes: '', currency: curOf(a),
          transfer_group: g, transfer_peer: null, is_recurring: false, recurring_frequency: null, next_run_date: null, recurring_source: null, created_at: date + 'T02:00:00Z' }));
        await reload();
        const p = pairProblems().find(x => x.group === g);
        check(!!p, 'the Data check finds a broken pair', `${shape} not flagged`);
        if (!p) return shape;
        const can = ['delete', ...(p.kind !== 'same' ? ['separate'] : []), ...(p.kind === 'same' || p.kind === 'types' ? ['edit'] : [])];
        const fix = pick(can);
        // (Undo here would only bring the broken pair back.)
        if (fix === 'delete') { dataCheckDelete(g); const u = undo; undo = null; if (u) u.commit(); }
        else if (fix === 'separate') dataCheckSeparate(g);
        else {
          dataCheckEdit(g);
          if (state.currentType === 'transfer') { populateToAccounts(a.name === $('#txn-account').value ? b.name : a.name); updateTransferUI(); }
          else populateFundAccounts(chance(0.7) ? (sameCur(accts().find(x => x.name === $('#txn-account').value) || a, accts())[0] || {}).name || '' : '');
          const n = toasts.length;
          await saveTransaction(); closeTxnModal();
          check(!errorsSince(n).length, 'the Data check\'s Edit saves', () => `${shape}: ${errorsSince(n).join('; ')}`);
        }
        await settle();
        check(!pairProblems().some(x => x.group === g), 'each Data check fix leaves no broken pair behind', () => `${shape} → ${fix}: ${state.transactions.filter(x => x.transferGroup === g).map(x => x.type + ' ' + x.account).join(', ')}`);
        return `repair ${shape} by ${fix}`;
      }],
      // Repeats come due only inside snLoadAll(), and every caller redraws after it.
      [4, 'open the app (repeats come due)', async () => { await runRecurring(); renderAll(); return 'repeats run'; }],
      [5, 'lose the connection', async () => { S.failWrites = true; offline = int(1, 4); return `offline for ${offline}`; }],
      [5, 'reload', async () => {
        await runRecurring(); renderAll(); await settle();
        const before = snap(), order = accts().map(a => a.name).join(' | ');
        await reload();
        const after = snap();
        const diff = firstDiff(before, after);
        check(!diff, 'a reload shows exactly what was there before', diff);
        check(accts().map(a => a.name).join(' | ') === order, 'a reload keeps the accounts in the order you arranged', () => `${order}\n      became ${accts().map(a => a.name).join(' | ')}`);
        return S.failWrites ? 'reload while offline' : 'reload';
      }],
    ];
    let offline = 0;

    // ── the book as plain data, for comparing ──
    const N = v => (v === undefined || v === null ? '' : v);
    const txnShape = t => ({ id: String(t.id), type: t.type, amount: +t.amount, description: N(t.description), category: N(t.category), account: N(t.account),
      date: t.date, notes: N(t.notes), currency: t.currency || state.currency, transferGroup: N(t.transferGroup), transferPeer: N(t.transferPeer),
      isRecurring: !!t.isRecurring, recurringFrequency: N(t.recurringFrequency), nextRunDate: N(t.nextRunDate), recurringSource: N(t.recurringSource) });
    const accShape = a => ({ id: String(a.id), name: a.name, type: a.type, institution: N(a.institution), balance: +a.balance, currency: a.currency || 'SGD', icon: N(a.icon), sortOrder: N(a.sortOrder) });
    const goalShape = g => ({ id: String(g.id), name: g.name, target: +g.target, current: +g.current, monthly: +g.monthly || 0, date: N(g.date), currency: g.currency, linkedAccount: N(g.linkedAccount) });
    const billShape = b => ({ id: String(b.id), name: b.name, amount: +b.amount, currency: b.currency, category: b.category, account: N(b.account), dueDay: b.dueDay, amountVaries: !!b.amountVaries, isActive: b.isActive !== false });
    const budgetShape = b => ({ id: String(b.id), category: b.category, amount: +b.amount, alertAmount: +b.alertAmount || 0, currency: b.currency });
    const byId = (list, f) => list.map(f).sort((a, b) => (a.id < b.id ? -1 : 1));
    const snap = () => ({ transactions: byId(state.transactions, txnShape), accounts: byId(state.accounts, accShape), goals: byId(state.goals, goalShape),
                          bills: byId(state.bills || [], billShape), budgets: byId(state.budgets, budgetShape) });
    function firstDiff(a, b, skip = []) {
      for (const tbl of Object.keys(a)) {
        const A = new Map(a[tbl].map(r => [r.id, r])), B = new Map(b[tbl].map(r => [r.id, r]));
        for (const [id, r] of A) {
          if (!B.has(id)) return `${tbl}: ${JSON.stringify(r).slice(0, 160)} is gone`;
          for (const k of Object.keys(r)) if (!skip.includes(k) && JSON.stringify(r[k]) !== JSON.stringify(B.get(id)[k])) return `${tbl} ${id.slice(0, 8)} ${k}: ${JSON.stringify(r[k])} became ${JSON.stringify(B.get(id)[k])} (${r.description || r.name || ''})`
            + (tbl === 'goals' ? ` — before ${JSON.stringify(r)}, after ${JSON.stringify(B.get(id))}; accounts now ${JSON.stringify(state.accounts.map(a => [a.name, a.currency, effectiveBal(a)]))}` : '');
        }
        for (const [id, r] of B) if (!A.has(id)) return `${tbl}: ${JSON.stringify(r).slice(0, 160)} appeared`;
      }
      return '';
    }
    // The server's rows in the same shapes, read the way snLoadAll reads them.
    const serverSnap = () => ({
      transactions: byId(S.tables.transactions || [], r => txnShape({ id: r.id, type: r.type, amount: r.amount, description: r.description, category: r.category,
        account: r.account, date: r.date, notes: r.notes, currency: r.currency, transferGroup: r.transfer_group, transferPeer: r.transfer_peer,
        isRecurring: r.is_recurring, recurringFrequency: r.recurring_frequency, nextRunDate: r.next_run_date, recurringSource: r.recurring_source })),
      accounts: byId(S.tables.accounts || [], r => accShape({ id: r.id, name: r.name, type: r.type, institution: r.institution, balance: r.starting_balance, currency: r.currency, icon: r.icon, sortOrder: r.sort_order })),
      goals: byId(S.tables.goals || [], r => goalShape({ id: r.id, name: r.name, target: r.target, current: r.current, monthly: r.monthly, date: r.target_date, currency: r.currency, linkedAccount: r.linked_account })),
      bills: byId(S.tables.bills || [], r => billShape({ id: r.id, name: r.name, amount: r.amount, currency: r.currency, category: r.category, account: r.account, dueDay: r.due_day, amountVaries: r.amount_varies, isActive: r.is_active })),
      budgets: byId(S.tables.budgets || [], r => budgetShape({ id: r.id, category: r.category, amount: r.amount, alertAmount: r.alert_amount, currency: r.currency }))
    });

    function checkBook(online) {
      const T = state.transactions;
      const ids = new Set(); let dup = null;
      T.forEach(t => { if (ids.has(String(t.id))) dup = t; ids.add(String(t.id)); });
      check(!dup, 'no two rows share an id', () => JSON.stringify(dup));
      const bad = T.find(t => typeof t.amount !== 'number' || !(t.amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(t.date) || isNaN(Date.parse(t.date)) || !t.type);
      check(!bad, 'every row has a positive amount, a real date and a type', () => JSON.stringify(bad));
      const probs = pairProblems();
      check(!probs.length, 'no broken transfer or purchase pairs', () => probs.map(p => `${p.why} (${p.legs.map(l => l.type + ' ' + l.account).join(', ')})`).join('; '));
      groups().forEach((legs, g) => {
        if (legs.length !== 2) return;
        const [x, y] = legs;
        check(x.transferPeer === y.account && y.transferPeer === x.account, 'each side of a pair names the other\'s account', () => `${x.account}→${x.transferPeer}, ${y.account}→${y.transferPeer}`);
        check(x.date === y.date, 'both sides of a pair share a date', () => `${x.date}/${y.date} (${x.description})`);
        if (legs.some(l => l.type === 'asset')) check(x.amount === y.amount, 'both sides of a purchase are the same amount', () => `${x.amount} vs ${y.amount}`);
        else check(x.category === 'Transfer' && y.category === 'Transfer', 'a transfer is always categorised Transfer', () => `${x.category}, ${y.category}`);
      });
      const names = new Map(accts().map(a => [a.name, a]));
      check(names.size === accts().length, 'no two accounts share a name', () => accts().map(a => a.name).join(', '));
      const wrongCur = T.find(t => names.has(t.account) && (t.currency || state.currency) !== curOf(names.get(t.account)));
      check(!wrongCur, 'every row is in its account\'s currency', () => wrongCur && `${wrongCur.type} ${wrongCur.currency} on ${wrongCur.account} (${curOf(names.get(wrongCur.account))})`);
      const lost = T.find(t => !names.has(t.account || '') && !deleted.has(t.account || ''));
      check(!lost, 'every row names an account that exists or was deleted', () => lost && `${lost.type} on “${lost.account}”`);
      const lostPeer = T.find(t => t.transferGroup && t.transferPeer && !names.has(t.transferPeer) && !deleted.has(t.transferPeer));
      check(!lostPeer, 'every transfer names an account that exists or was deleted', () => lostPeer && `→ “${lostPeer.transferPeer}”`);
      const lostGoal = state.goals.find(g => g.linkedAccount && !names.has(g.linkedAccount) && !deleted.has(g.linkedAccount));
      check(!lostGoal, 'a goal tracks an account that exists or was deleted', () => lostGoal && lostGoal.linkedAccount);
      const lostBill = (state.bills || []).find(b => b.account && !names.has(b.account) && !deleted.has(b.account));
      check(!lostBill, 'a bill names an account that exists or was deleted', () => lostBill && lostBill.account);
      accts().forEach(a => {
        const own = T.filter(t => t.account === a.name && (t.currency || state.currency) === curOf(a));
        const mine = r2(own.reduce((s, t) => s + (t.type === 'expense' ? -t.amount : ['income', 'asset', 'payback'].includes(t.type) ? t.amount : 0), +a.balance));
        check(effectiveBal(a) === mine, 'every balance is its starting balance plus its rows', () => `${a.name}: ${effectiveBal(a)} vs ${mine}`);
      });
      state.goals.forEach(g => {
        const a = names.get(g.linkedAccount);
        if (a && curOf(a) === g.currency) check(g.current === effectiveBal(a), 'a goal tracking an account shows its balance', () => `${g.name}: ${g.current} vs ${effectiveBal(a)} in ${a.name}`);
      });
      const occ = new Set(); let twice = null;
      // (A row moved by hand onto another occurrence's date is the user's doing.)
      T.forEach(t => { if (!t.recurringSource || moved.has(String(t.id))) return; const k = t.recurringSource + '|' + t.date; if (occ.has(k)) twice = t; occ.add(k); });
      check(!twice, 'a repeat never adds the same occurrence twice', () => twice && `${twice.description} on ${twice.date}`);
      // Every row a repeat added is on its schedule, after the first one and
      // not in the future.
      const tplById = new Map(T.filter(t => t.isRecurring).map(t => [String(t.id), t]));
      T.forEach(t => {
        const tpl = t.recurringSource && tplById.get(String(t.recurringSource));
        if (!tpl || moved.has(String(t.id)) || rescheduled.has(String(tpl.id))) return;
        let k = 1, d = recurDate(tpl.date, tpl.recurringFrequency, 1);
        while (d < t.date && k < 5000) d = recurDate(tpl.date, tpl.recurringFrequency, ++k);
        check(d === t.date && t.date <= today, 'a repeat adds rows only on its schedule, up to today', () => `${tpl.description} (${tpl.recurringFrequency} from ${tpl.date}) added ${t.date}`);
      });
      if (online) {
        const left = outbox().filter(o => o.userId === state.userId);
        check(!left.length, 'online, nothing is left waiting to be sent', () => left.map(o => `${o.kind} ${o.table}: ${o.lastError || 'never sent'}`).join('; '));
        const refused = rejectedWrites();
        check(!refused.length, 'the server refuses nothing the app sends', () => refused.map(o => `${o.kind} ${o.table} ${JSON.stringify(o.payload || {}).slice(0, 120)}: ${o.lastError}`).join('; '));
        // A pair's other-side name is rebuilt from the other row on every load,
        // so the server's copy of it is never read.
        // (Before migration 007 the order lives on the device, not the server.)
        const diff = firstDiff(snap(), serverSnap(), ['transferPeer', ...(state.accountOrderSynced ? [] : ['sortOrder'])]);
        check(!diff, 'online, the server holds exactly what the screen shows', diff ? 'screen vs server — ' + diff : '');
      }
    }

    const notes = [];
    // A real book loaded the real way: what loading repaired, then every
    // check above, then whether loading again changes anything.
    async function health(callsBefore) {
      const writes = c => c.op !== 'select' && c.table !== 'preferences';
      const tally = list => {
        const what = {};
        list.forEach(c => { const k = `${c.op} ${c.table}${c.patch ? ' (' + Object.keys(c.patch).join(', ') + ')' : ''}`; what[k] = (what[k] || 0) + (Array.isArray(c.row) ? c.row.length : 1); });
        return Object.entries(what).map(([k, v]) => `${v}× ${k}`).join('; ') || 'nothing';
      };
      const first = S.calls.slice(callsBefore).filter(writes);
      notes.push(`loading repaired or added: ${tally(first)}`);
      const stale = (real.tables.goals || []).map(g => {
        const now = state.goals.find(x => String(x.id) === String(g.id));
        return now && +g.current !== now.current ? `${g.name} ${g.current} → ${now.current}` : '';
      }).filter(Boolean);
      notes.push(stale.length ? `goals brought up to date with their accounts: ${stale.join('; ')}` : 'every goal already matched its account');
      const orphans = [...new Set(state.transactions.filter(t => !state.accounts.some(a => a.name === t.account)).map(t => t.account || '(none)'))];
      notes.push(orphans.length ? `rows booked to something that is not an account: ${orphans.join(', ')}` : 'every row is booked to an account');
      const tpls = state.transactions.filter(t => t.isRecurring);
      notes.push(`${tpls.length} repeating row${tpls.length === 1 ? '' : 's'}${tpls.length ? ': ' + tpls.map(t => `${t.description} (${t.recurringFrequency}, next ${t.nextRunDate})`).join('; ') : ''}`);
      tpls.forEach(t => check(!t.nextRunDate || t.nextRunDate > today, 'after loading, every repeat\'s next date is still to come', `${t.description}: ${t.nextRunDate}`));
      (state.bills || []).forEach(b => {
        const a = state.accounts.find(x => x.name === b.account);
        check(!b.account || (a && curOf(a) === b.currency), 'a bill\'s account exists and is in the bill\'s currency', `${b.name}: ${b.account} (${a ? curOf(a) : 'missing'}) vs ${b.currency}`);
      });
      checkBook(true);
      const before = snap(), mark = S.calls.length;
      await reload();
      check(!firstDiff(before, snap()), 'loading the book again gives the same book', () => firstDiff(before, snap()));
      const second = S.calls.slice(mark).filter(writes);
      check(!second.length, 'a second load has nothing left to repair', () => tally(second));
      checkBook(true);
    }

    try {
      const callsBefore = S.calls.length;
      await reload();
      if (real) state.transactions.forEach(t => { if (!state.accounts.some(a => a.name === t.account)) deleted.add(t.account || ''); });
      if (VIEW === 'health') { await health(callsBefore); throw 'done'; }
      checkBook(true);
      const total = OPS.reduce((s, o) => s + o[0], 0);
      for (step = 1; step <= STEPS; step++) {
        let r = rnd() * total, op = OPS[0];
        for (const o of OPS) { if ((r -= o[0]) < 0) { op = o; break; } }
        let said;
        try { said = await op[2](); }
        catch (e) { check(false, 'no action throws', `${op[1]}: ${e.stack || e.message}`); said = op[1] + ' (threw)'; }
        if (said === null) { step--; continue; }
        if (said) log.push(said);
        ops[op[1]] = (ops[op[1]] || 0) + 1;
        if (offline && --offline === 0) { S.failWrites = false; log.push('back online'); }
        await settle();
        checkBook(!S.failWrites);
      }
      S.failWrites = false;
      await settle();
      checkBook(true);
      await reload();
      checkBook(true);
    } catch (e) {
      if (e !== 'done') check(false, 'the run finishes', e.stack || e.message);
    }
    Object.keys(counts).forEach(name => {
      const f = failed.get(name);
      results.push({ ok: !f, name: `${VIEW}: ${name}`, detail: f ? `${f.times} of ${counts[name]} times. First: ${f.detail}` : '', times: counts[name] });
    });
    notes.forEach(n => results.push({ ok: true, name: `${VIEW}: ${n}`, note: true }));
    if (VIEW === 'fuzz') results.push({ ok: true, name: `fuzz: ran ${Object.entries(ops).map(([k, v]) => `${v}× ${k}`).join(', ')}` });
    const pre = document.createElement('pre');
    pre.id = 'e2e'; pre.style.display = 'none';
    pre.textContent = JSON.stringify({ results, errors });
    document.body.appendChild(pre);
  }, 300);
