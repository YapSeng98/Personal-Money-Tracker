#!/usr/bin/env node
/*
 * Importing a bank statement (CSV).
 *
 * Run:  node test/import.test.js
 *       PFMT_BACKUP=~/PFMT_Backups/<date>/transactions.json node test/import.test.js
 *         (also measures how often the suggested category matches the one you
 *          chose, on your own book: each fifth of it predicted from the rest)
 *
 * The statements below are written the way bank exports come: header lines
 * above the table, separate debit and credit columns or one signed amount,
 * quoted fields with commas, several reference columns, day-first dates.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extract(name) {
  const fn = HTML.match(new RegExp(`\\nfunction ${name}\\s*\\(`));
  if (fn) {
    const start = fn.index + 1;
    let depth = 0;
    for (let i = HTML.indexOf('{', start); i < HTML.length; i++) {
      if (HTML[i] === '{') depth++;
      else if (HTML[i] === '}' && --depth === 0) return HTML.slice(start, i + 1);
    }
  }
  // A one-line constant ends on its own line; an array opened with "[" at the
  // end of the line runs to the "];" that closes it.
  const line = HTML.match(new RegExp(`\\nconst ${name}\\s*=([^\\n]*)`));
  if (line) {
    const start = line.index + 1;
    if (!/\[\s*$/.test(line[1])) return HTML.slice(start, start + line[0].length - 1);
    return HTML.slice(start, HTML.indexOf('\n];', start) + 3);
  }
  throw new Error(`could not find ${name} in index.html`);
}
const NAMES = ['parseCSV', 'MONTHS3', 'dateParts', 'fullYear', 'detectDateOrder', 'parseImportDate', 'parseImportAmount',
  'findImportTable', 'detectImportColumns', 'readImportRows', 'findImportDuplicates',
  'IMPORT_KEYWORDS', 'IMPORT_INCOME_KEYWORDS', 'buildCategoryModel', 'suggestImportCategory'];
const API = new Function(`${NAMES.map(extract).join('\n')}\nreturn { ${NAMES.join(', ')} };`)();

let failed = 0, passed = 0;
function ok(cond, label, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`);
}
function group(name) { console.log('\n' + name); }
const read = (csv, opts = {}) => {
  const table = API.findImportTable(API.parseCSV(csv));
  const cols = API.detectImportColumns(table);
  return { table, cols, rows: API.readImportRows(table, cols, opts) };
};

group('Reading CSV');
{
  const r = API.parseCSV('﻿a,b,c\r\n"x, y","he said ""hi""","line\nbreak"\n\n1,2,3\n');
  ok(r.length === 3, 'blank lines dropped, byte-order mark stripped', JSON.stringify(r));
  ok(r[0][0] === 'a' && r[1][0] === 'x, y' && r[1][1] === 'he said "hi"' && r[1][2] === 'line\nbreak', 'quoted commas, doubled quotes and line breaks survive');
  ok(API.parseCSV('Datum;Omschrijving;Bedrag\n01-10-2026;Bakker;12,50')[1][2] === '12,50', 'a semicolon file is read by its own separator');
  ok(API.parseCSV('a\tb\n1\t2')[1][1] === '2', 'a tab file too');
}

group('Dates');
{
  const d = (s, o) => API.parseImportDate(s, o);
  ok(d('2026-10-22') === '2026-10-22' && d('22 Oct 2026') === '2026-10-22' && d('22-OCT-26') === '2026-10-22', 'ISO, "22 Oct 2026", "22-OCT-26"');
  ok(d('Oct 22, 2026') === '2026-10-22' && d('22 Sept 2026') === '2026-09-22', '"Oct 22, 2026" and "22 Sept 2026"');
  ok(d('03/10/2026', 'dmy') === '2026-10-03' && d('03/10/2026', 'mdy') === '2026-03-10', 'day/month order is applied when asked');
  ok(d('31/02/2026', 'dmy') === null && d('not a date') === null && d('') === null, 'impossible dates and non-dates are refused');
  ok(API.detectDateOrder(['03/10/2026', '22/10/2026']) === 'dmy', 'a 22 in front means day first');
  ok(API.detectDateOrder(['10/03/2026', '10/22/2026']) === 'mdy', 'a 22 second means month first');
  ok(API.detectDateOrder(['03/10/2026', '04/10/2026']) === 'dmy', 'undecided: day first, as Singapore and Malaysian banks write it');
}

group('Amounts');
{
  const a = API.parseImportAmount;
  ok(a('1,234.50') === 1234.5 && a('-12.30') === -12.3 && a('(45.00)') === -45, 'commas, minus and brackets');
  ok(a('S$12.30') === 12.3 && a('RM 1 200.00') === 1200 && a('$ 9.90') === 9.9, 'currency symbols and spaces');
  ok(a('12.30 CR') === 12.3 && a('12.30 DR') === -12.3 && a('12.30-') === -12.3, 'CR, DR and a trailing minus');
  ok(a('12,50') === 12.5 && a('1.234,50') === 1234.5, 'a comma decimal point');
  ok(a('') === null && a('-') === null && a('abc') === null, 'blank, a dash and text are not amounts');
}

group('A statement with header lines, debit and credit columns, three reference columns');
{
  const csv = `Account Details For:,POSB Savings Account 123-45678-9
Statement as at:,22 Oct 2026
Available Balance:,1234.56

Transaction Date,Reference,Debit Amount,Credit Amount,Transaction Ref1,Transaction Ref2,Transaction Ref3
22 Oct 2026,POS,8.90,,NETS,FAIRPRICE XTRA,
21 Oct 2026,ICT,,4000.00,SALARY,ACME PTE LTD,OCT
20 Oct 2026,UMC,3.84,,SIMPLYGO,BUS/MRT,
`;
  const { table, cols, rows } = read(csv);
  ok(table.hasHeader && table.rows.length === 3, 'the table is found under the header lines', JSON.stringify(table.header));
  ok(cols.date === 0 && cols.out === 2 && cols.in === 3 && cols.amount === -1, 'date, money out and money in are found', JSON.stringify(cols));
  ok(cols.desc.join() === '4,5,6', 'all three reference columns make the description', cols.desc.join());
  ok(rows.length === 3 && rows[0].type === 'expense' && rows[0].amount === 8.9 && rows[1].type === 'income' && rows[1].amount === 4000,
     'debits are money out, credits money in', JSON.stringify(rows.map(r => [r.type, r.amount])));
  ok(rows[0].description === 'NETS · FAIRPRICE XTRA' && rows[1].date === '2026-10-21', 'descriptions are joined; dates read', rows[0].description);
}

group('Withdrawals and deposits, quoted fields, day-first slashes');
{
  const csv = `Account details for:,360 Account

Transaction date,Value date,Description,Withdrawals (SGD),Deposits (SGD)
22/10/2026,22/10/2026,"GRAB* A-123 SINGAPORE",12.50,
15/10/2026,15/10/2026,BONUS INTEREST,,3.21
03/10/2026,03/10/2026,"STARBUCKS, ION ORCHARD","1,007.10",
`;
  const { cols, rows } = read(csv);
  ok(cols.date === 0 && cols.desc.join() === '2' && cols.out === 3 && cols.in === 4, 'the first date column is the transaction date; value date is ignored', JSON.stringify(cols));
  ok(rows.length === 3 && rows[2].description === 'STARBUCKS, ION ORCHARD' && rows[2].amount === 1007.1 && rows[2].date === '2026-10-03',
     'a quoted comma and a thousands comma are read right', JSON.stringify(rows[2]));
}

group('One signed amount column, and a DR/CR marker column');
{
  const { cols, rows } = read(`Date,Description,Amount\n2026-10-19,TNG RELOAD,-50.00\n2026-10-18,INTEREST,0.06\n`);
  ok(cols.amount === 2 && rows[0].type === 'expense' && rows[1].type === 'income', 'a negative amount is money out');
  const m = read(`Date,Details,Amount,Debit/Credit\n19/10/2026,ZUS COFFEE,2.20,DR\n18/10/2026,REFUND,5.00,CR\n`);
  ok(m.cols.sign === 3 && m.cols.out === -1 && m.rows[0].type === 'expense' && m.rows[1].type === 'income', 'a Debit/Credit column decides the direction and is not read as money out', JSON.stringify(m.cols));
}

group('A credit card statement: spending is positive');
{
  const csv = `Date,Description,Amount\n20/10/2026,NETFLIX.COM,17.98\n15/10/2026,PAYMENT RECEIVED - THANK YOU,-500.00\n`;
  const plain = read(csv).rows, flipped = read(csv, { flip: true }).rows;
  ok(plain[0].type === 'income' && flipped[0].type === 'expense' && flipped[1].type === 'income', 'flip turns purchases into money out and the payment into money in');
}

group('Without a header row, columns are found from their values');
{
  const { table, cols, rows } = read(`10/22/2026,UBER TRIP,25.40\n10/21/2026,SAFEWAY,63.12\n`);
  ok(!table.hasHeader && cols.date === 0 && cols.amount === 2 && cols.desc.join() === '1', 'date, amount and description guessed', JSON.stringify(cols));
  ok(rows[0].date === '2026-10-22', 'month-first dates are recognised from the 22', rows[0].date);
}

group('Rows already in the book');
{
  const book = [
    { account: 'DBS', currency: 'SGD', type: 'expense', amount: 8.9, date: '2026-10-22', description: 'Lunch' },
    { account: 'DBS', currency: 'SGD', type: 'expense', amount: 3.84, date: '2026-10-19', description: 'Bus' },      // a day earlier
    { account: 'OCBC', currency: 'SGD', type: 'expense', amount: 12.5, date: '2026-10-22', description: 'Grab' },     // other account
    { account: 'DBS', currency: 'SGD', type: 'income', amount: 5, date: '2026-10-21', description: 'Refund' },       // other direction
  ];
  const rows = [
    { date: '2026-10-22', amount: 8.9, type: 'expense' }, { date: '2026-10-22', amount: 8.9, type: 'expense' },
    { date: '2026-10-20', amount: 3.84, type: 'expense' }, { date: '2026-10-22', amount: 12.5, type: 'expense' },
    { date: '2026-10-21', amount: 5, type: 'expense' }, { date: '2026-10-25', amount: 8.9, type: 'expense' }];
  const d = API.findImportDuplicates(rows, 'DBS', 'SGD', book);
  ok(d[0] && !d[1], 'one existing row matches one imported row: two identical coffees, one already in the book, one is new');
  ok(d[2] && d[2].description === 'Bus', 'a bank posting a day late still matches');
  ok(!d[3] && !d[4] && !d[5], 'another account, the other direction, or days apart are not duplicates');
}

group('Suggested categories');
{
  const book = [
    { type: 'expense', description: 'Lunch', category: 'Food & Drink' }, { type: 'expense', description: 'Lunch', category: 'Food & Drink' },
    { type: 'expense', description: 'Lunch', category: 'Other' },
    { type: 'expense', description: 'GRAB RIDE to office', category: 'Transport' }, { type: 'expense', description: 'Grab ride home', category: 'Transport' },
    { type: 'expense', description: 'NTUC FAIRPRICE Clementi', category: 'Groceries' },
    { type: 'income', description: 'October salary', category: 'Salary' },
    { type: 'expense', description: 'To OCBC', category: 'Transfer', transferGroup: 'tg_1' }];
  const m = API.buildCategoryModel(book);
  const s = (description, type = 'expense') => API.suggestImportCategory(m, { description, type });
  ok(s('Lunch').category === 'Food & Drink', 'the same description gets its most common category');
  ok(s('GRAB* A-123 SINGAPORE').category === 'Transport' && s('FAIRPRICE XTRA JURONG').category === 'Groceries', 'shared words carry the category over');
  ok(s('SIMPLYGO BUS/MRT').category === 'Transport' && s('SINGTEL MOBILE').category === 'Bills', 'with nothing similar in the book, keywords decide');
  ok(s('ACME PTE LTD SALARY OCT', 'income').category === 'Salary', 'income has its own history and keywords');
  ok(s('XYZZY 12345').category === 'Other', 'nothing to go on: Other');
  ok(s('To OCBC').category !== 'Transfer', 'transfers teach nothing');
}

const backup = process.env.PFMT_BACKUP && process.env.PFMT_BACKUP.replace(/^~/, process.env.HOME);
if (backup && fs.existsSync(backup)) {
  group('Accuracy on your own book (each fifth predicted from the other four)');
  // Per account: a book only ever learns from itself.
  const rows = JSON.parse(fs.readFileSync(backup, 'utf8')).map(t => ({ ...t, transferGroup: t.transfer_group }))
    .filter(t => !t.transferGroup && (t.type === 'expense' || t.type === 'income') && t.category);
  [...new Set(rows.map(t => t.user_id))].forEach(uid => {
    const all = rows.filter(t => t.user_id === uid);
    let hit = 0, n = 0;
    for (let fold = 0; fold < 5; fold++) {
      const model = API.buildCategoryModel(all.filter((_, i) => i % 5 !== fold));
      all.forEach((t, i) => { if (i % 5 !== fold) return; n++; if (API.suggestImportCategory(model, t).category === t.category) hit++; });
    }
    const distinct = new Set(all.map(t => t.description.trim().toLowerCase())).size;
    console.log(`  account ${uid.slice(0, 8)}: ${hit} of ${n} match (${(100 * hit / n).toFixed(1)}%) — ${distinct} distinct descriptions`);
  });
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} checks passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
