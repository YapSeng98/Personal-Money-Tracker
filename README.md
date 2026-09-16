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
goes to Supabase fire-and-forget. The app stays usable with a bad connection;
a failed write raises a toast rather than losing the edit. On load, `snLoadAll()`
pulls every table fresh and overwrites the cache.

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

Seven tables, all in `public`, all with RLS on and a `user_id` referencing
`auth.users`. Full DDL: [`supabase/migrations/`](supabase/migrations/).

### `accounts`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | client-generated (`crypto.randomUUID()`) |
| `name` | text | unique per user in practice; transactions reference it by name |
| `type` | text | Checking, Savings, Credit Card, Investment, … |
| `institution` | text | |
| `currency` | text | SGD · USD · AUD · MYR |
| `starting_balance` | numeric | the balance *before* any transaction in the book |
| `is_active` | boolean | inactive accounts stay for history, drop out of pickers |

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
| `is_recurring`, `recurring_frequency`, `next_run_date` | | carried, not yet acted on |

### `budgets`
| Column | Type | Notes |
|---|---|---|
| `category`, `currency` | text | unique together per user — the same category can be budgeted separately in each currency |
| `amount` | numeric | the monthly limit |
| `alert_pct` | int | when to warn, default 80 |
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

### `notifications_sent`
`(user_id, kind, dedupe_key)` — used for bill reminders only; that primary key *is* the "once as due, once if late"
rule. See [Telegram alerts](#telegram-alerts).

---

## Frontend

| Page | What it does |
|---|---|
| Dashboard | Per-currency balance/income/expense hero, KPI cards, spend-by-category |
| Transactions | Full list with month/type/currency filters, bulk select, undo |
| Budgets | Per-currency budgets with rollover, plus "Plan from Salary" allocator |
| **Bills** | The monthly checklist — see below |
| Goals | Savings goals, optionally tracking a real account |
| Analytics | Spending trend, monthly in/out, savings rate, category breakdowns |
| Accounts | Balances, allocation, debt ratio |
| Settings | Account, profile, password, appearance, app lock, **Telegram alerts**, AI key, backup, data |

**Mobile (≤900px).** The sidebar becomes a hamburger drawer and a bottom bar
appears with Home / Txns / Goals / Stats and a centre **+**. Budgets, Bills,
Accounts and Settings are reached through the drawer.

**State** lives in one `state` object, persisted to `localStorage` under
`pfmt_state_v2` and reloaded from Supabase on sign-in. Nothing derived is ever
stored: balances, budget spend, savings rate and bill matching are all recomputed
on render, which is why they cannot disagree with the ledger.

**App lock** is a device-local PIN (Settings → App Lock). Its hash never syncs —
a PIN synced to the cloud would be pointless next to the session that could fetch
it.

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
| Budget | every expense saved in a category at or past its alert amount — only that category is checked | **none** — each expense sends the new total |
| Bill | once as it approaches, once more if it goes unpaid | `billId｜month｜due\|overdue` in `notifications_sent` |

Budget alerts were once limited to one per month per level; the owner asked for
every expense that hits to say so instead, so the latest total is always in front
of them. Bill reminders keep a limit because the daily run has no new spending
behind it and would otherwise repeat the same bill every morning. A bill reminder
is claimed in `notifications_sent` *before* it is sent — the primary key is the
rule, so overlapping runs cannot double-send — and a failed send releases the claim.

The three callers are scoped: the **expense** path (the app, after a save) checks
only that category's budget; the **manual** check (Settings) checks every budget and
bill; the **daily run** checks bills only.

Budget alerts are judged against the same effective limit the budget card draws,
rollover included, so an alert can never contradict the bar you are looking at.

Setup: [TELEGRAM_SETUP.md](TELEGRAM_SETUP.md).

---

## Tests

```bash
node test/run-all.js
```

170 checks across three suites. They load the **real** functions out of
`index.html` and the real Edge Function source rather than copies, so a failure
means the shipped code is wrong — not that a test is stale.

| Suite | Checks | Protects |
|---|---|---|
| `budget-invariants.test.js` | 89 | budget figures never negative, never more than the Transactions list shows, bars always 0–100%, rollover capped, cash vs P&L conservation, currencies never mixed, and every surface reporting the *same* month total |
| `bills-and-alerts.test.js` | 58 | the two copies of the shared rules are identical; one transaction never ticks two bills; a match is a real match; due dates survive short months; an alert never contradicts the budget card |
| `pfmt-notify.test.mjs` | 23 | the Edge Function itself, under a stubbed Deno and a stubbed network — auth gates, claim-before-send, one message not many, HTML escaping, failed sends releasing their claims |

The Edge Function suite needs no Deno and touches nothing live: Node's own type
stripping loads the `.ts` directly and the network is stubbed.

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
live within a minute. Keep `daily-money-tracker-app.html` byte-identical:

```bash
cp index.html daily-money-tracker-app.html
```

### The database

Run the files in [`supabase/migrations/`](supabase/migrations/) in order, in the
Supabase SQL Editor. They are additive and safe to re-run.

### The Edge Function

See [TELEGRAM_SETUP.md § redeploy](TELEGRAM_SETUP.md#if-you-ever-need-to-redeploy-the-function).
Remember `--no-verify-jwt`, and run `node tools/sync-shared-rules.js` first.

### Before pushing anything

```bash
node test/run-all.js && node tools/sync-shared-rules.js --check
```

---

## Known limitations

**Auth emails are capped at 2/hour.** Supabase's free built-in SMTP. Password
resets and invitations hit `429 over_email_send_rate_limit` quickly. Configuring
custom SMTP in Auth settings removes the cap.

**`budgets.spent` is dead data.** Left over from the ServiceNow backend, which
maintained it with a business rule. Nothing reads it — spend is always recomputed
from transactions. It is kept only so an old backup still restores.

**Currencies are never converted.** Every figure stays in the currency it was
entered in and totals are grouped per currency. A cross-currency transfer takes
both amounts from you rather than applying a rate; there is no FX rate anywhere
in the app, by design.

**A transaction fetch caps at 3,000 rows.** Coming back exactly on the limit is
taken as proof that older rows were left behind, and the backup then refuses to
write a file that would look complete but isn't.

**Recurring transactions are carried but dormant.** `is_recurring` and friends
survive a round trip and appear in backups; nothing generates from them. Bills
solve the adjacent problem from the other direction — see
[FEATURE_IDEAS.md](FEATURE_IDEAS.md) for why they are not the same thing.

**Bill matching can mis-attribute.** A bill marked "amount varies" matches on
category and account alone, so with two such bills in one category the first can
absorb the other's payment. The row always names the transaction it matched, so a
wrong match is visible; tying the bill to a specific account fixes it.

---

*PFMT — Personal Finance Money Tracker · Supabase + GitHub Pages*
