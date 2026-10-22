  // ── Test data ────────────────────────────────────────────────────────────
  // Two months of SGD, MYR and USD with every kind of row the money rules
  // treat differently: a payback that settles a category exactly, one bigger
  // than its category, a work claim, a same-currency transfer, two currency
  // exchanges, spending booked to no account (Cash), and a row this month.
  // Months are relative to today — M1 (last month) is the one under review —
  // so the suite keeps passing as the calendar moves; days stop at the 28th.
  const P = new URLSearchParams(location.search);
  const M0 = localYM(), M1 = prevMonthKey(M0), M2 = prevMonthKey(M1);
  let id = 1, n = 0;
  const tx = (date, type, category, amount, currency, account, description, extra) =>
    Object.assign({ id: id++, date, type, category, amount, currency, account, description: description || category,
                    created: `${date} 09:${String(n++ % 60).padStart(2, '0')}:00` }, extra || {});
  const T = [];
  T.push(tx(M2 + '-01', 'income', 'Salary', 4000, 'SGD', 'DBS Checking', 'August salary'));
  [['Rental', 600], ['Health', 273], ['Food & Drink', 540], ['Education', 83], ['Other', 126], ['Transport', 181], ['Bills', 40.8], ['Sport', 18.5]]
    .forEach(([c, a]) => T.push(tx(M2 + '-14', 'expense', c, a, 'SGD', 'DBS Checking')));
  T.push(tx(M2 + '-10', 'expense', 'Health', 2495, 'MYR', 'Maybank'));
  T.push(tx(M2 + '-12', 'expense', 'Transport', 343, 'MYR', 'Maybank'));
  T.push(tx(M1 + '-01', 'income', 'Salary', 4000, 'SGD', 'DBS Checking', 'September salary'));
  T.push(tx(M1 + '-03', 'income', 'Freelance', 1.61, 'SGD', 'OCBC Savings', 'Interest'));
  [[M1 + '-02', 'Rental', 1000, 'Room rent'], [M1 + '-05', 'Food & Drink', 415, 'Groceries and meals'], [M1 + '-07', 'Health', 432, 'Dental'],
   [M1 + '-09', 'Education', 222, 'Course fee'], [M1 + '-10', 'Transport', 168.53, 'MRT and Grab'], [M1 + '-12', 'Other', 201.95, 'Gifts'],
   [M1 + '-15', 'Bills', 83.74, 'Phone and internet'], [M1 + '-18', 'Sport', 13.69, 'Badminton court']]
    .forEach(([d, c, a, desc]) => T.push(tx(d, 'expense', c, a, 'SGD', 'DBS Checking', desc)));
  T.push(tx(M1 + '-20', 'expense', 'Shopping', 60, 'SGD', 'DBS Checking', 'Concert tickets for two'));
  T.push(tx(M1 + '-21', 'payback', 'Shopping', 60, 'SGD', 'DBS Checking', 'Friend paid back ticket'));
  T.push(tx(M1 + '-21', 'expense', 'Entertainment', 20, 'SGD', 'DBS Checking', 'Movie'));
  T.push(tx(M1 + '-22', 'payback', 'Entertainment', 50, 'SGD', 'DBS Checking', 'Old IOU settled'));
  T.push(tx(M1 + '-25', 'payback', 'Claims', 128.20, 'SGD', 'DBS Checking', 'Work travel claim'));
  T.push(tx(M1 + '-26', 'expense', 'Transfer', 1000, 'SGD', 'DBS Checking', 'To OCBC Savings', { transferGroup: 'tg_1' }));
  T.push(tx(M1 + '-26', 'income', 'Transfer', 1000, 'SGD', 'OCBC Savings', 'From DBS Checking', { transferGroup: 'tg_1' }));
  T.push(tx(M1 + '-28', 'expense', 'Transfer', 1800, 'SGD', 'DBS Checking', 'SGD to MYR', { transferGroup: 'tg_2' }));
  T.push(tx(M1 + '-28', 'income', 'Transfer', 5742.28, 'MYR', 'Maybank', 'SGD to MYR', { transferGroup: 'tg_2' }));
  T.push(tx(M1 + '-27', 'expense', 'Transfer', 135, 'SGD', 'DBS Checking', 'SGD to USD', { transferGroup: 'tg_3' }));
  T.push(tx(M1 + '-27', 'income', 'Transfer', 100, 'USD', 'Wise USD', 'SGD to USD', { transferGroup: 'tg_3' }));
  T.push(tx(M1 + '-28', 'expense', 'Groceries', 45.10, 'SGD', 'Cash', 'Wet market'));
  [[M1 + '-04', 'Entertainment', 1511.08], [M1 + '-06', 'Health', 1023], [M1 + '-11', 'Food & Drink', 533.10], [M1 + '-16', 'Shopping', 412.94], [M1 + '-19', 'Transport', 356.91]]
    .forEach(([d, c, a]) => T.push(tx(d, 'expense', c, a, 'MYR', 'Maybank')));
  T.push(tx(M0 + '-02', 'expense', 'Food & Drink', 12.5, 'SGD', 'DBS Checking', 'Kopi and toast'));
  T.reverse();
  Object.assign(state, {
    transactions: T,
    accounts: [
      { id: 1, name: 'DBS Checking', type: 'Checking', institution: 'DBS', balance: 5000, currency: 'SGD', icon: '🏦' },
      { id: 2, name: 'OCBC Savings', type: 'Savings', institution: 'OCBC', balance: 12000, currency: 'SGD', icon: '🏦' },
      { id: 3, name: 'Maybank', type: 'Savings', institution: 'Maybank', balance: 2000, currency: 'MYR', icon: '🏦' },
      { id: 4, name: 'Wise USD', type: 'Wallet', institution: 'Wise', balance: 250, currency: 'USD', icon: '💳' }],
    budgets: [
      { id: 1, category: 'Health', currency: 'SGD', amount: 480 }, { id: 2, category: 'Food & Drink', currency: 'SGD', amount: 450 },
      { id: 3, category: 'Education', currency: 'SGD', amount: 200 }, { id: 4, category: 'Other', currency: 'SGD', amount: 440 },
      { id: 5, category: 'Transport', currency: 'SGD', amount: 160 }, { id: 10, category: 'Shopping', currency: 'SGD', amount: 100 },
      { id: 6, category: 'Entertainment', currency: 'MYR', amount: 500 }, { id: 7, category: 'Health', currency: 'MYR', amount: 800 },
      { id: 8, category: 'Food & Drink', currency: 'MYR', amount: 500 }, { id: 9, category: 'Shopping', currency: 'MYR', amount: 500 }],
    currency: 'SGD', reviewMonth: M1, filterMonth: M1, displayName: 'Test User', trendMonths: 12,
    theme: P.get('theme') || 'dark', language: 'en'
  });
  applyTheme();
  renderAll();
  const loginOverlay = document.getElementById('login-overlay');
  if (loginOverlay) loginOverlay.style.display = 'none';
  showView('analytics');
