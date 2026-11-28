# Personal Finance Money Tracker (PFMT)

A personal finance web app backed by Supabase. Track transactions across
currencies, hold budgets and savings goals, tick off the bills you pay every
month, and get told on Telegram when a budget or a bill needs attention — all
from a single HTML file hosted on GitHub Pages.

**Live:** https://yapseng98.github.io/Personal-Money-Tracker/

> 📖 **New to the app?** [USER_GUIDE.md](USER_GUIDE.md) is the step-by-step
> version. This README covers architecture, data model and deployment.
> 🔔 **Setting up alerts?** [TELEGRAM_SETUP.md](TELEGRAM_SETUP.md).
> 💾 **Setting up backups?** [BACKUP_STEPS.md](BACKUP_STEPS.md).
> 💡 **Ideas not yet built?** [FEATURE_IDEAS.md](FEATURE_IDEAS.md).

---

## Contents

1. [Tech stack](#tech-stack)
2. [Architecture](#architecture)
3. [The two ledgers](#the-two-ledgers) ← read this before changing any money maths
4. [Data model](#data-model)
5. [Frontend](#frontend)
6. [Bills](#bills)
7. [Telegram alerts](#telegram-alerts)
8. [Tests](#tests)
9. [Deployment](#deployment)
10. [Known limitations](#known-limitations)

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS + HTML5 + CSS3, one file, no build step |
| Backend | Supabase — Postgres with Row Level Security |
| Auth | Supabase Auth (email + password), JWT sessions |
| Server logic | One Supabase Edge Function (Deno), `pfmt-notify` |
| Scheduling | `pg_cron` + `pg_net`, one nightly job |
| Local cache | Browser `localStorage` (`pfmt_state_v2`) |
| Notifications | Telegram Bot API |
| AI insights | Groq API (optional, user's own key) |
| Hosting | GitHub Pages |

There is no build, no bundler and no package manager. `index.html` is the app;
opening it is running it. `daily-money-tracker-app.html` is a byte-identical twin
kept for the original filename.

---

## Architecture

```
┌──────────────────────────────────────────────┐
│  GitHub Pages — index.html (SPA)             │
│                                              │
│   state (memory) ──► localStorage            │
│        │              pfmt_state_v2          │
│        │              (offline cache)        │
│        ▼                                     │
│   supabase-js v2  ──────────┐                │
└─────────────────────────────┼────────────────┘
                              │ JWT
                              ▼
        ┌─────────────────────────────────────┐
        │  Supabase — oqsqfrpblinvsizitmgl    │
        │                                     │
        │  Postgres + RLS                     │
        │   accounts · transactions · budgets │
        │   bills · goals · preferences       │
        │   notifications_sent                │
        │                                     │
        │  Auth (email/password)              │
        │                                     │
        │  Edge Function: pfmt-notify ───────────► Telegram Bot API
        │        ▲                            │
        │        │ x-pfmt-cron-secret         │
        │  pg_cron — nightly 01:00 UTC        │
        └─────────────────────────────────────┘
```

**Sync model.** Every change updates local state and `localStorage` first, then
waits in an outbox until Supabase confirms it (see [Frontend](#frontend)). The
app stays usable with a bad connection and nothing is lost. On load,
`snLoadAll()` pulls every table fresh and merges it with whatever this device
still has waiting, so a change that hadn't landed is never overwritten.

**Row Level Security** is the whole authorisation story: every table carries a
`user_id` and a policy of `auth.uid() = user_id` for select, insert, update and
delete. The app holds only the publishable key, which grants nothing on its own —
without a signed-in session, every query returns zero rows.

---

## The two ledgers

The most important idea in the codebase, and the one that has caused every money
bug so far. **Two different questions are asked of the same transactions:**

| | Cash ledger | P&L ledger |
|---|---|---|
| Question | "What is in this account?" | "What did this month cost me?" |
| Computed by | `effectiveBal()` | `curStats()`, `pfmtBudgetSpent()`, `trendTotals()` |
| Counts | every movement | only real income and spending |
| Transfers | **yes** — money really moved | **no** — you are no more or less well off |
| Asset purchases | **yes** — the cash left | **no** — you swapped cash for a holding |
| Claims reimbursements | **yes** — money landed | **no** — see below |

A transfer and a funded asset purchase are each written as **two rows sharing a
`transfer_group`**: an expense on the source and an income (or `asset`) on the
destination. Both balances move through the normal cash logic, and
`isFlow(t) => !t.transferGroup` keeps both legs out of every P&L figure. Neither
leg can exist without the other — deleting one deletes both.

### Work claims

You pay for a client dinner in June and the company pays you back in September.
The expense counts **in June** — you really were out of pocket then. The
September reimbursement is a pure in-and-out: it credits the account it lands in
and touches nothing else, because the cost it settles was already counted in its
own month. Netting it again in September would make an unrelated month look
cheaper than it was.

That is what the `Claims` category means, and it is why
`pfmtPaybackOffsets()` exists:

```js
const PFMT_CLAIMS_CATEGORY = 'Claims';
function pfmtPaybackOffsets(t) {
  return t.type === 'payback' && t.category !== PFMT_CLAIMS_CATEGORY;
}
```

A `payback` in any *other* category — a friend settling their half of dinner —
does reduce what that month cost, because it was never really your cost.

### One definition, two runtimes

`pfmtPaybackOffsets` is one function in one place because it was once five
copies. The Claims rule was added to four of them and the Analytics trend chart
kept its own, so the same month read **S$1,886.70** on the dashboard and
**S$1,758.50** on the chart directly below it.

The notifier has to answer the same questions while nobody has the page open, so
the rules live in a marked block in `index.html`:

```
/* ═══ PFMT SHARED MONEY RULES — v1 — BEGIN ═══ */
   … PFMT_CLAIMS_CATEGORY, pfmtIsFlow, pfmtPaybackOffsets,
     pfmtBudgetSpent, pfmtBudgetRollover, pfmtBudgetLimit, pfmtBudgetAlerts,
     pfmtMatchBills, pfmtBillStatus, pfmtBillsToRemind …
/* ═══ PFMT SHARED MONEY RULES — v1 — END ═══ */
```

`index.html` is the source. `node tools/sync-shared-rules.js` copies the block
verbatim into `supabase/functions/pfmt-notify/shared-money-rules.js`, and
`test/bills-and-alerts.test.js` compares the two character for character and
fails if anyone forgot. **Never edit the generated copy.**

---

## Data model

Eight tables, all in `public`, all with RLS on and a `user_id` referencing
`auth.users`. Full DDL: [`supabase/migrations/`](supabase/migrations/).

### `accounts`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | client-generated (`crypto.randomUUID()`) |
| `name` | text | unique per user (the app refuses a second account with the same name); transactions reference it by name |
| `type` | text | Checking, Savings, Credit Card, Cash, Investment, Crypto (a new Crypto account defaults to USDT) |
| `institution` | text | |
| `currency` | text | SGD · USD · AUD · MYR · USDT |
| `starting_balance` | numeric | the balance *before* any transaction in the book |
| `is_active` | boolean | inactive accounts stay for history, drop out of pickers |
| `sort_order` | integer | the order set with Accounts → Arrange (migration 007); null until an account is moved |

The displayed balance is never stored — it is `starting_balance` plus every
transaction in that account's currency, recomputed on render.

### `transactions`
| Column | Type | Notes |
|---|---|---|
| `type` | text | `expense` · `income` · `transfer` · `asset` · `payback` |
| `amount` | numeric | always positive; `type` carries the direction |
| `category` | text | |
| `account` | text | matched to `accounts.name` |
| `date` | date | |
| `currency` | text | never converted — each row stays in its own currency |
| `transfer_group` | text | shared id linking the two legs of a transfer or funded asset |
| `transfer_peer` | text | the other leg's account, rebuilt on load |
| `is_recurring`, `recurring_frequency`, `next_run_date` | | a row that repeats; `runRecurring()` adds each one on its day |
| `owed_by` | text | on an expense: who will pay it back (migration 008). Claims count without it |
| `settles` | uuid | on a payback: the expense it pays back, so part payments show (008) |
| `receipt_path` | text | the receipt photo in Storage, `receipts/<user id>/<id>.jpg` (008) |

### `notes`
My notes (migration 008): things to pay, collect or record later. `body`, and
optionally `kind` (`expense` · `income` · `transfer`), `amount`, `currency`,
`due_date`; `done_at` and `txn_id` once recorded. Synced through the outbox like
the rest; until 008 runs they stay on the device, and are sent once it has.

### `budgets`
| Column | Type | Notes |
|---|---|---|
| `category`, `currency` | text | unique together per user — the same category can be budgeted separately in each currency |
| `amount` | numeric | the monthly limit |
| `alert_amount` | numeric | the amount at which to warn ("tell me at S$380 of S$400"); empty means 80% of the limit (migration 003) |
| `rollover` | boolean | carry last month's unused room into this one |
| `spent` | numeric | **dead column** — spend is always recomputed from transactions |

### `bills`
| Column | Type | Notes |
|---|---|---|
| `name` | text | |
| `amount` | numeric | typical amount; an estimate when `amount_varies` |
| `category`, `account` | text | `account` null means "any account" |
| `due_day` | int | 1–31, clamped to short months at render time |
| `amount_varies` | boolean | match on category and account alone |
| `is_active` | boolean | paused bills are ignored entirely |

**There is deliberately no `paid` column** — see [Bills](#bills).

### `goals`
`name`, `icon`, `target`, `current`, `monthly`, `target_date`, `remarks`,
`currency`, `linked_account`. A goal linked to an account tracks that account's
live balance instead of a typed-in figure.

### `preferences`
One row per user: `currency`, `language`, `theme`, `budget_alerts`, `now_assist`,
`trend_months`, `trend_metric`, `display_name`, `avatar_color`,
`monthly_income_target`, `ai_api_key`, and the alert settings
`telegram_chat_id`, `notify_budget`, `notify_bills`, `bill_lead_days`.

Settings follow you to every device. Choosing a theme, Budget Alerts, Now
Assist, or the Analytics trend range or type saves it on the device at once
and upserts it to this row (`savePrefs`). Until the server confirms it, the
change waits in `prefsPending`, and a load puts it back over the server's
older copy, so the choice survives a refresh or going offline. A new account's
first row starts with this device's settings rather than the server's defaults.

### `notifications_sent`
`(user_id, kind, dedupe_key)` — that primary key *is* the "once as due, once if late"
rule for bills, and "once a month per category" for running-high alerts (`kind`
'trend', allowed by migration 009). See [Telegram alerts](#telegram-alerts).

### `backups`
`taken_at`, `device`, `counts` — a note each time a backup is downloaded, so the
"time for a backup" reminder follows the person across devices (migration 005).

### What the app does, at a glance

- **Dashboard**: the balance board per currency, notes coming up, money owed to
  you, recent entries and spending by category.
- **Transactions**: search by words, amounts (`>100`), type, account, category,
  a year, the last 3 months or a date range, with saved searches; suggestions to
  make a hand-typed monthly entry repeat; one ⋯ per row on a phone.
- **Notes**: *My notes* for things to pay, collect or record later (Record it
  turns one into the transaction), and *On transactions* for what was written
  on rows, with #tags.
- **Analytics**: Monthly Review (a row per currency that adds up on screen),
  Running high (categories well above the average of the 3 months before, each
  counted to the same day), Spending Trend, Monthly In & Out, Year in review.
- **Accounts**: net worth, Update balance, investment returns (Modified Dietz:
  money moved in or out is never profit), and the one-currency total.
- **Budgets** offer amounts from your own history; **Wall display** is a live
  full-screen board; a **new version** bar offers Reload after each update;
  long-pressing the installed app offers Add expense, income, transfer or Update
  balance.
- **Telegram**: budget, bill and running-high alerts, and quick add ("lunch
  12.50"). See [TELEGRAM_SETUP.md](TELEGRAM_SETUP.md).

---

## Frontend

| Page | What it does |
|---|---|
| Dashboard | Per-currency balance/income/expense hero, KPI cards, spend-by-category |
| Transactions | Full list with month/type/currency filters, bulk select, undo, **Again today** (↻) on every row, a **Data check** for broken transfer pairs, a **Statement** button, and **Import** for a bank's CSV statement |
| Budgets | Per-currency budgets with rollover, plus "Plan from Salary" allocator |
| **Bills** | The monthly checklist — see below |
| Goals | Savings goals, optionally tracking a real account |
| Analytics | Monthly Review (a donut per currency of every category spent), the **monthly statement** (view, PDF, Excel, CSV), spending trend, and Monthly In & Out (range totals, per-month bars, Excel and CSV downloads) |
| Accounts | Balances, **Arrange** (▲ ▼ within each currency), **Update balance** (⚖️) on every account, **net worth over time** (a line per currency, with a table view), a **≈ total in your home currency** at the day's exchange rates, allocation, debt ratio |
| Settings | Account, profile, password, appearance, app lock, **Telegram alerts**, AI key, backup, data |

**Mobile (≤900px).** The sidebar becomes a hamburger drawer and a bottom bar
appears with Home / Txns / Goals / Stats and a centre **+**. Budgets, Bills,
Accounts and Settings are reached through the drawer.

**State** lives in one `state` object, persisted to `localStorage` under
`pfmt_state_v2` and reloaded from Supabase on sign-in. Nothing derived is ever
stored: balances, budget spend, savings rate and bill matching are all recomputed
on render, which is why they cannot disagree with the ledger.

**Writes go through an outbox.** Every insert, update and delete is applied
locally, queued in `state.outbox`, and sent: at once, then again on reconnect,
on returning to the app, every 30 seconds and on each load. A reload merges the
server's rows with what is still queued (`mergeWithOutbox`), so a change that
hadn't landed is never overwritten and a deleted row can't come back. Inserts
are upserts, so a retry never duplicates. The badge in the top bar shows what is
waiting, and anything the server refuses (a constraint, a missing column) can be
retried or discarded from there. Consecutive inserts into the same table go up
to 100 per request; if the server refuses a batch, each row is retried alone so
one bad row can't hold up the rest.

**Other devices' changes arrive on return.** Coming back to the app (the
page becoming visible again) at least a minute after the last load reloads the
book quietly through the same path (`refreshOnReturn`), so a new account order
or rows added on another device appear without a manual reload. It never runs
under an open window, and a failure leaves the screen as it was.

**Transfers and asset purchases are pairs** of rows sharing a `transferGroup`.
`pairProblems()` finds any that aren't one expense plus one income/asset on two
accounts; those are never hidden from the list, and the Data check fixes them.

**Descriptions used before.** The Description box lists up to five past
descriptions as you type, from the same kind of row (spending, income, a
payback, a transfer or a purchase). What starts with what you typed comes first.
Then come descriptions with a word starting with each typed word, then ones
containing it anywhere (for Chinese), then near misses with one typo. Within
each, recent use counts most (`buildDescIndex`, `suggestDescriptions`).
Entering an empty box lists your most used lately. Picking one fills in the
category it usually had. A transfer or purchase also fills in both accounts.
A plain row keeps the account you chose, because repeats are often paid from a
different account. Arrow keys, Enter and Escape work, and screen readers
announce the list (an ARIA combobox).

**Updating a balance.** ⚖️ on an account takes the balance the bank or
exchange shows and records the difference from the app's figure for that day
as one row (`balanceOn`, `balanceUpdateRow`). On an Investment or Crypto
account it is a Gain/Loss row (Market gain or Market loss), so a month's
trading profit or loss shows without entering every trade. On any other account
it is a Balance correction, and the window warns that a missing transaction
entered later would count twice.

**Net worth in one currency.** Every figure stays in its own currency, with
one exception: the ≈ total at the foot of the Accounts summary, which adds the
currencies up at the European Central Bank's rates for the day. They come from
frankfurter.dev once a day, sent nothing but currency codes, and are kept on
the device; USDT counts at the US dollar's rate. Rates opens a window to set
your own, per currency. With no rate for a currency yet (offline on first
use), the total leaves it out and says so.

**Arranging accounts.** Arrange on My Accounts puts ▲ ▼ on every account to
move it within its currency (the list is grouped by currency). `state.accounts`
is kept in that order, so every account list follows it: the transaction form,
goals, bills, the statement. Each move numbers every account by its place and
writes the ones that changed to `sort_order`; a new account takes the next
number, so numbers never tie. A load orders by `sort_order`, then by this
device's own record of the order (`state.accountOrder`), which is all there is
before migration 007 (Arrange then says the order is on this device only).
The first load after 007 runs, on a device that was arranged, shares that
order if no device has stored one yet; devices loading later adopt it.

**Again today.** ↻ on a transaction opens it as a new one dated today, with
the same amount, description, category and account (both accounts and both
amounts for a transfer), ready to adjust and save.

**Importing a bank statement.** `parseCSV` reads the file, `findImportTable`
skips any preamble to the table of dated rows, and `detectImportColumns` picks
the date, description and amount columns (one signed amount, or money out and
money in). Rows already in the book are matched one-to-one within a day
(`findImportDuplicates`) and left unticked. Categories come from the book's own
history first (`suggestImportCategory`), then from keywords. The column choices
are remembered per bank, keyed by the header row.

**Offline and installable.** `manifest.webmanifest` and `icons/` let the app be
added to a home screen; `sw.js` caches the page and its pinned libraries
(network-first for the page, never for Supabase), so it opens with no
connection and queues changes in the outbox.

**Three themes.** Light, Dark and Command Center (Settings → Appearance, or
the top-bar button, which steps light → dark → Command Center). Command Center
is the dark theme with a skin on top (`data-theme="dark"` plus
`data-skin="command"`), so every dark-mode rule still applies. It reads as an
operations wall: square instrument panels with a bracket at each corner (drawn
as background gradients, so no pseudo-element is taken), a header rule and a lit
marker on every panel title, line icons in the menus, logo and theme button (each
holder keeps its emoji in `.emo` for Light and Dark, `lineIcon()` draws the rest),
a cyan grid with scan lines behind the page, Chakra Petch figures that line up,
and outlined buttons that light up on hover. From 1280px the top bar carries a
live status strip (`#cc-status`): the connection (ONLINE, n QUEUED, OFFLINE,
n NOT SAVED, or LOCAL when signed out), a clock, and the last sync. It changes its
text nodes in place, so the once-a-second tick doesn't wake the accessibility
observer, and it is hidden from screen readers since the sync badge and month bar
say the same. Its text tokens keep 4.5:1 like the others.

**Accessible by default.** A few page-wide rules (`a11yPass`, re-run whenever
the page changes) keep every new form and button accessible: a `<label>` labels
the field in its `.form-group` or the field after it; a button drawn as a symbol
(✏️ ✕ ‹ ☰) speaks its title instead of "pencil"; settings switches are real
switches (named, reached by Tab, flipped by Space or Enter, announcing on or
off); Enter and Space press anything with `role="button"`; every window is a
named, modal dialog that takes the focus, keeps Tab inside, and hands the focus
back when it closes. The page's `lang` follows the language shown. Accent
colours have text shades (`--coral-t`, `--jade-t`, `--sky-t`, `--amber-t`,
`--indigo-t`, `--violet-t`) that keep text at 4.5:1 or more on light cards;
the bright accents stay for fills, bars and icons. Buttons keep white text at
4.5:1, and the dashboard's balance card uses a deep version of the brand
gradient so its figures read.

**Only the page on screen is drawn.** `renderAll()` draws the active page and
marks the others stale; `showView()` draws a page when it is opened.

**App lock** is a device-local PIN (Settings → App Lock), stored as PBKDF2
(310,000 rounds, per-device salt), with a 30-second wait after five wrong tries.
It never syncs — a PIN synced to the cloud would be pointless next to the session
that could fetch it.

---

## Bills

A bill is an **expectation you type once**, not a second ledger to keep by hand.
Each month the app looks through your real transactions for one that satisfies
each bill, and ticks it off when it finds one.

**Nothing about "paid" is stored.** The tick is recomputed on every render from
`state.transactions`, the same way budgets and savings rate are — so it can never
fall out of step with your ledger. Page back to a previous month and you see what
that month really did.

### How matching works — `pfmtMatchBills()`

A transaction satisfies a bill when **all** of these hold:

1. it is an `expense` and not half of a transfer,
2. it is in the month being shown,
3. same currency,
4. same category,
5. same account — *unless* the bill says "any account",
6. the amount is within `max(1.00, 2% of the bill)` — *unless* the bill is marked
   as varying, in which case the amount is ignored entirely.

**One transaction can only ever satisfy one bill.** Bills are matched
fewest-candidates-first, so a bill whose only possible payment is a single row is
never robbed of it by a looser bill that had other options.

### Status

| Status | Meaning |
|---|---|
| Paid | a matching transaction exists — the row shows which one, and the real amount |
| Due | unpaid, due date not yet reached |
| Overdue | unpaid, due date passed, in the current month |
| Missed | unpaid, in a month that has already ended |
| Upcoming | a future month |

The sidebar badge counts what is still unpaid **this** month regardless of which
month you are browsing, and turns red once any of them is late.

**Log payment** does not invent a transaction — it opens the normal transaction
form with the bill's details filled in, dated to the due day if that day has
passed. The payment lands in the ledger like any other expense, and the tick then
follows from the ledger.

---

## Telegram alerts

One Edge Function, `pfmt-notify`, reached two ways:

| Caller | Authentication | Scope |
|---|---|---|
| The app, after you record an expense; the Settings buttons | your Supabase JWT, verified against `/auth/v1/user` | you |
| `pg_cron`, nightly at 01:00 UTC (09:00 SGT) | `x-pfmt-cron-secret` header, constant-time compared | every user with alerts on |

The bot token lives **only** in the function's environment. A page served from
GitHub Pages cannot keep a secret, and the token is shared across every user of
the bot, so it belongs on the server side of the call. The app holds only the
chat id — an address, which grants nothing.

### What is sent, and how often

Everything pending goes out as **one message**, never one per item.

| Kind | Fires | Limit |
|---|---|---|
| Budget | every expense saved in a category at or past its alert amount — that category decides; every other budget past its alert is listed below it | **none** — each expense sends the new total |
| Bill | once as it approaches, once more if it goes unpaid | `billId｜month｜due\|overdue` in `notifications_sent` |

Budget alerts were once limited to one per month per level; the owner asked for
every expense that hits to say so instead, so the latest total is always in front
of them. Bill reminders keep a limit because the daily run has no new spending
behind it and would otherwise repeat the same bill every morning. A bill reminder
is claimed in `notifications_sent` *before* it is sent — the primary key is the
rule, so overlapping runs cannot double-send — and a failed send releases the claim.

The three callers are scoped: the **expense** path (the app, after a save) sends only
when that category's budget is at or past its alert, and then leads with it under
*Just now*, followed by every other budget already past its alert under *Also past
their alert*; the **manual** check (Settings) checks every budget and bill; the
**daily run** checks bills only.

Budget alerts are judged against the same effective limit the budget card draws,
rollover included, so an alert can never contradict the bar you are looking at.

Setup: [TELEGRAM_SETUP.md](TELEGRAM_SETUP.md).

---

## Tests

```bash
node test/run-all.js        # about 350,000 checks, no browser needed
node test/e2e/run.js        # the real page in headless Chrome (needs Node 22+ and Chrome)
node test/perf/bench.js     # how long a redraw takes with 5,000 transactions
```

The unit suites load the **real** functions out of `index.html` and the real
Edge Function source rather than copies, so a failure means the shipped code is
wrong — not that a test is stale.

| Suite | Checks | Protects |
|---|---|---|
| `budget-invariants.test.js` | 184 | budget figures never negative, never more than the Transactions list shows, bars always 0–100%, rollover capped, cash vs P&L conservation, currencies never mixed, every surface reporting the *same* month total, and statements that reconcile (opening + in − out = closing, a range equals its months added up), and a net worth line that matches every month's closing balance and ends on today's balances |
| `bills-and-alerts.test.js` | 72 | the two copies of the shared rules are identical; one transaction never ticks two bills; a match is a real match; due dates survive short months; an alert never contradicts the budget card |
| `pfmt-notify.test.mjs` | 48 | the Edge Function itself, under a stubbed Deno and a stubbed network — auth gates, claim-before-send, one message not many, HTML escaping, failed sends releasing their claims; the cron run is pinned to a date |
| `data-integrity.test.js` | 17 | every broken transfer-pair shape is named, and no list ever hides a row it should show (3,000 randomised lists) |
| `outbox.test.js` | 37 | writes queue, fold per row (into the row's latest write, so a change made after a failed send still lands last) and go out in order once; a dropped connection keeps them; a refusal moves aside; a reload keeps what hasn't landed; inserts go up in batches and a refused batch falls back to one row at a time |
| `import.test.js` | 37 | bank CSVs with header lines, quoted fields, either date order and no header row; signed, split or DR/CR amounts; credit cards where spending is positive; duplicates matched one-to-one; categories learned from the book |
| `app-lock.test.js` | 8 | the PIN is stored salted; an old PIN unlocks once and is re-stored |
| `descriptions.test.js` | 68,324 | what the Description box offers. One entry per description however it was capitalised or spaced. Only the kind of row being added, each pair offered once. Starts-with first, then word starts in any order, Chinese from anywhere, then one typo exactly (against a full edit-distance calculation). Recent use outranks old. The usual category fills in, and both accounts of a transfer or purchase. Descriptions show as text, never markup. Covers 300 random books (`SEED=n` tries another 300). `PFMT_BACKUP=~/PFMT_Backups/<date>` also replays a real book in date order and reports how often what you wrote would have been offered after 0–3 letters |
| `balance-and-fx.test.js` | 34,887 | Update balance and the one-currency total, on 400 random books (several currencies, cards in debt, rows after the day, rows in another account or currency): the row recorded brings that day to exactly the balance typed, leaves earlier days and other accounts alone and moves later days by the difference; a gain or loss on an investment or crypto account, a correction elsewhere, nothing when it already agrees. The total converts each currency once at its rate, USDT at the dollar's, your rate over the day's, and names any currency it has no rate for (2,000 random books against a total worked out in the test) |
| `statement.test.js` | 246,920 | the monthly statement against figures worked out independently, on 400 random books (`SEED=n` tries another 400) holding every awkward case (several currencies, cards in debt, transfers, exchanges, asset purchases, oversized paybacks, claims, unfunded holdings, rows booked to no account, one-sided transfers) over months crossing a year end and February: every row exactly once, opening + in − out = closing line by line, each month opening where the last closed, money in and out equal to the dashboard's, every column adding to its total, the gap between balances and cash flow explained cause by cause, a range equal to its months, the Excel/CSV figures the same, no CSV cell a spreadsheet would run as a formula. `PFMT_BACKUP=~/PFMT_Backups/<date>` also checks every month of every book in a real backup |

The **browser suite** (`test/e2e/`) builds a copy of the page with supabase-js
swapped for a recording fake (`fake-supabase.js`, which can also drop or refuse
writes, or apply them under the real schema's rules), loads dated-relative-to-today test data (`seed.js`, which also answers exchange-rate requests from a fixed table, so nothing goes to the network), and clicks through
the app (`checks.js`): about 370 checks at desktop, laptop and true 390px phone
sizes (and the desktop again in Command Center), covering the statement and its downloads, Monthly In & Out, the Data
check (and its Edit repairing every shape it offers to), a search count matching
the lines shown, offline saves surviving a reload, deletes not coming back, USDT, the net
worth chart, importing a CSV (and importing it twice), description suggestions
(typing, tapping, the arrow keys, Escape, a transfer filling both accounts),
Update balance (a correction, a market loss on an earlier day, nothing when it
agrees), the ≈ total (what is sent for rates, the sum, your own rate, offline,
hidden balances), Arrange (moving within a currency, the ends, focus, what is
sent before and after migration 007, a reload on a fresh device, the first
device after 007 sharing its order and later ones adopting it, coming back to
the app picking up another device's order but never under an open window) and
Again today (a row, a currency exchange, a transfer to a
deleted account), App Lock
and every page in both languages. A last run serves the app from localhost and
reloads it with the server stopped to prove the offline shell.

**Random use** (`fuzz.js`) drives the real app through long runs of everyday
actions, picked at random: adding, editing and deleting every kind of row (with
and without undo), bulk delete and recategorise, repeats coming due, renaming
accounts and changing their type or currency, reusing a name, deleting
accounts, goals, bills, planning budgets from a salary, repairing broken pairs
through the Data check, another device changing rows on the server, dropping
the connection and reloading. The fake server applies writes the way Postgres
would: an unknown column, a blank or malformed date, a non-uuid id or a missing
required value is refused. After every action the whole book is checked: no
broken pairs, every row in its account's currency and naming an account that
exists, every balance equal to its starting balance plus its rows, goals equal
to the accounts they track, repeats only on their schedule and never twice,
editing a field changing nothing else, undo restoring exactly, nothing left
unsent or refused once online, the server holding exactly what the screen
shows, a reload showing exactly what was there, another device's change
arriving, an updated balance landing on the figure typed, Again today
copying exactly, the account order surviving every reload, and another
device's new order arriving on a reload or on coming back to the app. Every third
run uses a database without migration 007. Every run includes six runs of 200 actions; `--fuzz --seeds=N
--steps=M` runs more, and `--backup … --user …` runs them on a copy of a real
book. `--health --backup … --user …` loads a real book the way the app does
and checks all of it, and that loading it twice changes nothing.

The **accessibility audit** (`fit.js`, `--a11y`) opens every page, window and
menu at 390px and 360px in Chinese, in light, dark and Command Center, and checks what a
screen-reader or keyboard user meets: every control has a name that isn't only a
symbol, every field a label (a placeholder doesn't count), text contrast is
WCAG AA against what is actually behind it, focus is visible, anything clickable
is reachable by keyboard, an open window is a named modal dialog holding the
focus, and the page's language matches what it shows. The **typed-markup pass**
(`--xss`) puts markup in every field a person types (descriptions, notes,
account, goal and bill names, a category, the display name, a server error) and
fails if any screen turns it into elements or runs it. Every run includes both
at 390px.

The **phone-fit audit** (`fit.js`) opens every page, window and menu — 43
screens, with long names, seven-figure amounts and USDT in the data — and
measures what a person would notice on a phone: anything past the screen edge,
boxes that scroll sideways, text cut off, squeezed or on top of other text,
picker labels running under their arrow, text under 10px, inputs under 16px
(iPhone zooms in on those), controls too small to tap (WCAG 2.5.8) or hidden
behind the bottom bar, and windows wider than the screen. Every run checks
320px, 360px in Chinese, 390px and a phone on its side; `--fit` checks every
size with a report, `--page-shots DIR [--themes=command] [--sizes=1280x800,390x844]` saves each main page to look at, and `--fit-shots DIR` saves screenshots of every screen,
scrolled top to bottom.

`--pdf DIR` saves the monthly statement as PDF exactly as Print → Save as PDF
makes it. With `--backup ~/PFMT_Backups/<date> --user <id prefix>` it prints
every month of a real book read from a local backup; nothing leaves the
machine. If headless Chrome freezes (it very occasionally does, in its graphics
process), the runner says so and runs those checks again in a fresh browser.

GitHub Actions (`.github/workflows/tests.yml`) runs both suites on every push.

These exist because of a real bug. A payback larger than the month's spending
made net spend negative, and the budget card rendered
`-S$87.36 spent of S$440.00 / -20% (S$527.36 left)` over a **full green bar** —
a negative CSS width is dropped by the browser, "left" exceeded the whole budget,
and the minus sign was swallowed by `fmtWithCur`'s `Math.abs`. Meanwhile the
Transactions page for the same filter plainly listed S$40.84.

---

## Deployment

### The app

GitHub Pages serves `index.html` from `main` at
https://yapseng98.github.io/Personal-Money-Tracker/. Push to `main` and it is
live within a minute. To deploy only after the tests pass, set Settings → Pages →
Source to **GitHub Actions**; the workflow's deploy job then publishes the site
once both suites are green. Keep `daily-money-tracker-app.html` byte-identical:

```bash
cp index.html daily-money-tracker-app.html
```

### The database

Run the files in [`supabase/migrations/`](supabase/migrations/) in order, in the
Supabase SQL Editor: 001 (the original tables) through 009. 007 remembers the
order accounts are arranged in; 008 adds My notes, money owed, receipt photos
(a private `receipts` bucket) and saved searches; 009 lets the alert run record
running-high alerts. They are additive and safe to re-run. Until a migration
runs, the app keeps what it adds on each device and never sends a column or
table the server doesn't have yet.

### The Edge Function

Two: `pfmt-notify` (alerts) and `pfmt-telegram` (quick add). See
[TELEGRAM_SETUP.md § redeploy](TELEGRAM_SETUP.md#if-you-ever-need-to-redeploy-the-function).
Remember `--no-verify-jwt` for both, and run `node tools/sync-shared-rules.js` first.

### Before pushing anything

```bash
node test/run-all.js && node test/e2e/run.js && node tools/sync-shared-rules.js --check
```

---

## Known limitations

**Auth emails are capped at 2/hour.** Supabase's free built-in SMTP. Password
resets and invitations hit `429 over_email_send_rate_limit` quickly. Configuring
custom SMTP in Auth settings removes the cap.

**`budgets.spent` is dead data.** Left over from the ServiceNow backend, which
maintained it with a business rule. Nothing reads it — spend is always recomputed
from transactions. It is kept only so an old backup still restores.

**Accounts are found by name.** Rows, goals and bills point at an account by
its name, so names are unique (case and spacing aside) and renaming one
repoints everything. A row whose account was deleted keeps that name; opening
it shows "(no longer an account)" rather than quietly picking another account.

**`transfer_peer` on the server can be stale for old pairs.** The other side's
account name is rebuilt from the partner row on every load, so nothing reads
the stored copy; old pairs that never had it filled keep it empty there.

**Currencies are converted in one place only.** Every figure stays in the
currency it was entered in and totals are grouped per currency. A
cross-currency transfer takes both amounts from you rather than applying a
rate. The single exception is the ≈ total on Accounts, an estimate at the day's
ECB rates (or yours); nothing else reads those rates. Rates you set stay on
the device that set them.

**The offline copy lives in localStorage**, which browsers cap at about 5 MB:
roughly 15,000 transactions. Past that, saving the offline copy fails quietly
(the server still has everything); moving it to IndexedDB would lift the cap.

**Transactions load in pages of 1,000 until none are left**, so there is no
ceiling on how many a user can have. Nothing renders until every page is in; if
a load fails, the last complete copy stays on screen and the header says so
until a sync succeeds.

**Recurring transactions add themselves.** Set **Repeat** (weekly, monthly,
yearly) on an expense, income or payback and each occurrence is added when the
app loads on or after its date, tagged `recurring_source`. If you entered it
yourself around the due date — a salary paid early — that occurrence is skipped.
An auto-added row never marks a bill as paid. Needs migration 005.

**Bill matching can mis-attribute.** A bill marked "amount varies" matches on
category and account alone, so with two such bills in one category the first can
absorb the other's payment. The row always names the transaction it matched, so a
wrong match is visible; tying the bill to a specific account fixes it.

---

*PFMT — Personal Finance Money Tracker · Supabase + GitHub Pages*
