# PFMT — User Guide

**Personal Finance Money Tracker** · Track spending, budgets, savings goals, and accounts — synced to ServiceNow, working offline, in your browser.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Interface Overview](#2-interface-overview)
3. [Dashboard](#3-dashboard)
4. [Transactions](#4-transactions)
5. [Budgets](#5-budgets)
6. [Savings Goals](#6-savings-goals)
7. [Analytics](#7-analytics)
8. [Accounts](#8-accounts)
9. [Multi-Currency](#9-multi-currency)
10. [AI Insights](#10-ai-insights)
11. [Settings & Profile](#11-settings--profile)
12. [Data, Sync & Export](#12-data-sync--export)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Getting Started

### Opening the app

Open the app URL in any modern browser (Chrome, Safari, Edge, Firefox) on desktop or mobile. No installation needed.

### Creating an account

1. On the login screen, tap **Register**
2. Fill in:
   - **Instance** — your ServiceNow instance (e.g. `dev405150.service-now.com`); pre-filled if provided
   - **Username** — lowercase, unique
   - **Display name** and **email**
   - **Password** (entered twice)
3. Tap **Create Account** — you're logged in immediately

### Logging in

1. Enter your **username** and **password**
2. Press **Enter** or tap **Sign In**

The app remembers your credentials and **auto-connects on your next visit** — you'll skip the login screen entirely. Because credentials are stored in the browser, avoid using shared/public computers.

### App Lock (PIN)

For a layer of privacy on top of auto-connect — a PIN prompt on every reopen, so a glance at an unlocked phone doesn't show your login already sitting there:

1. **Settings → App Lock** → enter a 4–6 digit PIN twice → **Enable App Lock**
2. From then on, **signing in always ends at the PIN screen**:

   `username + password  →  🔒 PIN  →  Dashboard`

   With App Lock on, **reopening or refreshing the app always asks for your password again** — the "auto-connect on your next visit" shortcut is deliberately switched off, because a saved session that opens straight into your finances would defeat the lock.

   The 1-minute idle re-lock is different: your session stays signed in, so **coming back after stepping away only costs the PIN**, not the password.

   | | What you enter |
   |---|---|
   | Reopen / refresh the app | Password **+** PIN |
   | Back after the 1-min idle lock | PIN only |
   | 🔒 Lock Now | PIN only |
   - It also **re-locks after 1 minute of inactivity**, so walking away from an open tab doesn't leave your finances on screen. Any click, tap, keypress, or scroll resets the timer
   - **🔒 Lock Now** in Settings locks it immediately if you'd rather not wait
3. **Forgot it?** Tap **Forgot PIN?** on the lock screen and verify with your account username/password — that clears the PIN so you can set a new one

The PIN is stored only on this device (like the balance mask) — it's never sent to ServiceNow, and doesn't sync to your other devices. Each device you use it on needs its own PIN set separately.

### Light & dark theme

**Settings → Appearance**, or the 🌙 / ☀️ button in the top bar for a quick flip.

- **Auto** (default) follows your phone or computer's own light/dark setting — including switching automatically when your device does at sunset
- **Light** / **Dark** pin it on this device regardless of the system setting

The choice is saved per device, so your phone can run dark while your laptop stays light.

### Working offline

If ServiceNow is unreachable, the app still works: everything is saved to your browser's local storage and re-synced when the connection returns. The connection status dot in the sidebar shows your sync state.

---

## 2. Interface Overview

### Desktop (wide screens)

- **Left sidebar** — navigate between Dashboard, Transactions, Budgets, Goals, Analytics, Accounts, and Settings
- **Top bar** — page title plus quick actions:
  - **⬇ CSV** — export transactions to a CSV file
  - **⬇ SN JSON** — export a ServiceNow-ready JSON backup
  - **✨ AI Insights** — open the AI analysis panel
  - **+ Add Transaction** — the fastest way to record spending
- **Month bar** (Dashboard, Transactions, Budgets) — step between months with **‹ ›**, or tap **Today** to jump back to the current month

### Mobile (phones & tablets)

- **Bottom navigation bar** — the four most-used pages, plus a center **+** button:

  | Tab | Page |
  |---|---|
  | 🏠 Home | Dashboard |
  | 💳 Txns | Transactions |
  | **+** (center) | Opens Add Transaction |
  | 🎯 Goals | Savings Goals |
  | 📈 Stats | Analytics |

- **☰ hamburger** (top-left) — opens the full sidebar drawer for Budgets, Accounts, and Settings

---

## 3. Dashboard

Your monthly money at a glance:

- **Net Balance hero** — what actually moved in the selected month. With multiple currencies each one gets its **own labelled card** (`SGD`, `MYR`) carrying its own net, income and spending — never mixed together, and never lined up in a way you'd have to match by currency symbol
  - A **cross-currency transfer** is neither earning nor spending, but it *is* real movement: send `S$1,000` and receive `RM3,173.30` and the SGD card notes `🔄 −S$1,000.00 exchanged out` while the MYR card notes `🔄 +RM3,173.30 exchanged in`. Each currency's net includes its own side, so the figure agrees with your accounts
  - Income and spending stay clean — the exchange is never counted as either, so your savings rate isn't distorted by moving money between your own accounts
  - A same-currency transfer, and the funding side of an asset purchase, move nothing in or out of that currency, so they don't appear at all
- **KPI cards** — transaction count, average daily spend, savings rate, and budgets over limit
- **Recent Transactions** — the latest entries; tap **View all →** for the full list
- **Spending by Category** — bar chart of where the money went, grouped per currency

Use the month bar to review any past month.

---

## 4. Transactions

### Adding a transaction

1. Tap **+ Add Transaction** (top bar) or the **+** FAB (mobile bottom bar)
2. Choose the type: **Expense**, **Income**, **Transfer**, or **Asset**
3. Enter the **amount** and pick the **currency** (SGD / USD / AUD / MYR)
4. Enter a **description** (required), pick a **category**, an **account** (optional), and the **date**
   - Picking an account sets the currency to that account's. Saving a row whose currency differs from its account is refused — such a row would sit in the list without changing any balance.
5. Add **notes** if you like, then tap **Save**

### The four types

| Type | What it does to the account | Counted as income/spending? |
|---|---|---|
| **Expense** | Decreases it | Yes — spending, and uses up a budget |
| **Income** | Increases it | Yes — earnings |
| **Asset** | Increases it | **No** — value you hold, not money you earned |
| **Transfer** | Moves it between two accounts | **No** — your own money changing pockets |

### Asset

Use **Asset** to record value going into a holding — a brokerage top-up, gold, property, a vehicle. It raises the account's balance and feeds any goal linked to that account, but is deliberately kept out of your income figure and savings rate, because it isn't earnings.

Categories: Investment 📈, Property 🏘️, Gold 🥇, Vehicle 🚗, Other 💰.

**Where did the money come from?** Pick a **Funded From** account and the amount is deducted there and added to the holding — the money moves rather than appearing from nowhere. Your net worth is unchanged by the purchase itself, which is correct: you swapped cash for an asset.

Leave **Funded From** blank only when you're recording something you *already owned* (an existing holding you're adding to the app for the first time). In that case the holding goes up with nothing deducted anywhere.

Only same-currency accounts are offered as a funding source, and the holding can't fund itself. Deleting a funded asset removes both sides and restores both balances.

### Transfer

Pick a **From Account** and a **To Account**. The money leaves one and arrives in the other, and the list shows it as a single `🔄 DBS Saving → KenTrade` row.

The **currency follows the From Account** — pick UOB (SGD) and you're sending SGD; pick Maybank (MYR) and you're sending MYR. It's locked to the account on purpose, because a transaction whose currency doesn't match its account moves no money at all.

**Different currencies?** If the destination uses another currency, a second field appears: **Amount Received**. Enter what actually landed — e.g. send `S$100`, receive `RM340`. The app never guesses an exchange rate, so both figures stay true to your bank statement.

To send the other way, just swap the accounts: put Maybank in **From** and DBS in **To**, and the labels flip to *Amount Sent (MYR)* / *Amount Received (SGD)*.

Transfers don't count as income or spending, and don't consume a budget.

The **category is set to Transfer automatically** — there's nothing to pick. Older transfers made before this existed kept whatever category was chosen at the time (usually *Other*), which made them look like ordinary spending in the category breakdown. **Settings → Data → Retag Transfers** fixes those in one go; it also runs by itself the next time your data syncs. Asset purchases keep their real category, since *Investment* or *Gold* is meaningful there.

### Payback — money someone returns to you

You pay for the group on Friday; two of them settle up on Monday. That money is **not income** — it's part of your own spending coming back.

Pick the **Payback** type, enter the amount, and choose the category it relates to (Sport, for the badminton court). Then:

- Your account goes **up** — the money really did arrive
- **Income is untouched** — counting it would inflate both your earnings and your savings rate
- That category's spending goes **down** — pay S$20 and get S$8.40 back and Sport reads S$11.60, which is what the evening actually cost you
- A category repaid in full drops out of the breakdown entirely rather than sitting at zero

Paybacks have their own row style (↩️ with a PAYBACK badge) and their own filter, so they're never mistaken for income at a glance.

One thing to know: a payback counts in the month it **arrives**. Pay in one month and get repaid in the next, and the first month shows the full cost while the next shows the credit. Within one month — the usual case — it nets out exactly.

Transactions are listed in one run, newest first, whatever the currency — an MYR row on the 17th sits between the SGD rows of the 17th rather than in a separate block further down. Each row states its own currency, and a day's total shows one figure per currency, never added together. Use the currency filter to see just one.

Budgets with more than one currency get **tabs** instead of stacked sections, so the second currency is one tap away rather than a screen of scrolling.

### Seeing what makes up a budget

Click any budget card (or focus it and press Enter) to open the transaction list filtered to that category — the real list, with its usual edit and delete, so the rows always agree with the figure on the card. Budgets track spending, so income and transfers are left out. A category-and-currency pair drills in exactly: an MYR *Food & Drink* budget shows only the MYR rows, never the SGD ones.

If nothing has been spent yet, you get an empty list rather than the whole month.

### Editing & deleting

Each row has **✏️ edit** and **🗑️ delete** buttons. Deleting asks for confirmation first.

Transfers can be edited like anything else — including swapping the direction if you picked From and To the wrong way round. Deleting one removes **both** sides together, so an account is never left with a half-transfer.

### Finding transactions

- **Search box** — filters by description as you type
- **Type filter** — Expenses, Income, Assets, or Transfers
- **Period** — *This Month* (the default, following the month bar) or *All Time*. Pick All Time to see every transaction you've ever recorded in one list; the month bar dims, since it no longer applies
- **Currency filter** — only appears when you actually hold more than one currency
- **Category filter** — show one category
- **Month bar** — step to any month
- **Clear** — reset all filters at once

Each date header shows that **day's net total** on the right — green when you took in more than you spent, red when you spent more. Transfers are left out, since moving your own money between accounts is neither a gain nor a loss.

When you use more than one currency, the list groups under **SGD / MYR / …** section headers, with a small currency badge on every row. Account dropdowns are grouped the same way, so you're picking from a labelled SGD or MYR block rather than one long mixed list. Single-currency users see no grouping at all. Day totals stay inside their own currency section, so amounts in different currencies are never added together.

---

## 5. Budgets

Set a monthly spending limit per category — the app tracks progress automatically from your expense transactions.

### Creating a budget

1. Go to **Budgets** → **+ Add Budget**
2. Pick a **category**, set the **monthly limit**, choose the **currency**, and set the **alert threshold** (default 80%)
3. Tap **Save**

You can hold the **same category in different currencies** (e.g. Food & Drink at S$500 *and* RM400) — each budget only counts transactions in **its own currency**. Creating a second budget for the same category + currency is blocked.

### Reading the budget card

- Progress bar: **green** (healthy) → **amber** with a *NEAR* badge (past your alert threshold) → **red** with an *OVER* badge (limit exceeded)
- Shows spent vs. limit and how much is left, in the budget's currency

Budgets follow the month bar — check last month's performance any time.

### Plan from Salary

At the top of Budgets, tap **💼 Plan from Salary** to set your whole month's budgets by percentage instead of one category at a time:

1. Pick a **currency** — salary auto-fills from that currency's income this month (edit it if it's not your actual take-home pay)
2. Type a **%** next to each category — the donut and dollar amount update live as you type
3. If you already have budgets in that currency, they're pre-filled as their current % of salary, so opening it the first time shows where your money already goes, not a blank form
   - Percentages only pre-fill when your existing budgets actually fit the salary shown. Open the planner early in the month and the auto-filled salary is only the income received *so far* — measuring a full month's budgets against that would produce nonsense figures, so it starts blank and tells you why. Set the salary to your real monthly take-home and enter the percentages yourself
4. **Apply to Budgets** writes the amounts in — updating any category you already had a budget for, creating one for any you didn't

Percentages don't need to add up to 100 — anything left over is shown as unallocated, and going over 100% is allowed (flagged in red) in case that's genuinely what you mean to do. Currency is never mixed: switching to MYR shows MYR income and MYR budgets only, completely separate from SGD.

---

## 6. Savings Goals

### Creating a goal

1. Go to **Goals** → **+ Add Goal**
2. Give it a **name** and **icon**, set the **target amount** and **currency**
3. Optionally set the **amount saved so far**, a **monthly contribution**, a **target date**, and **remarks**

### Tracking progress

- Each card shows a progress bar, percent complete, amount to go, and (if you set a monthly contribution or date) an estimated **months left**
- **Quick contribution buttons** in the edit modal add money in one tap
- When savings reach the target, the goal shows a green **Achieved** badge 🎉

Goals in different currencies appear under their own currency section headers.

### Linking a goal to an account

Instead of typing your saved amount by hand, you can link a goal to one of your **Accounts**:

1. Open the goal (or start a new one) and pick an account from **Linked Account**
2. Only accounts in the goal's own currency are offered
3. Once linked, the goal's **saved amount** follows that account's balance automatically — add, edit, or delete a transaction on the account and the goal updates on its own
4. The goal card shows a 🔗 badge with the linked account's name, and the Quick Contribution buttons are hidden (add a transaction on the account instead)
5. To go back to manual entry, edit the goal and set Linked Account back to **None**

---

## 7. Analytics

Deeper insight into the selected month:

- **Stat cards** — total income, total expenses, savings rate, and largest expense. With mixed currencies, each stat breaks out per currency
- **Category chart** — spending distribution per currency
The four cards at the top — Total Income, Total Expenses, Largest Expense, Savings Rate — all count the same way: genuine earning and spending only. Transfers between your own accounts, asset purchases and currency exchanges are excluded, so the savings rate always follows from the two figures above it.

If a currency received more through exchange than it earned, its savings rate reads **N/A** rather than a number. Dividing RM3,026 of spending by RM522 of actual MYR income gives −479%, which is arithmetically correct and completely useless — that currency is funded by transfers, not earnings. Hover the N/A for both real figures.

- **Spending Trend** — a bar per month for your last 3/6/9/12 months (pick the range with the **3M / 6M / 9M / 12M** tabs), so you can spot a rising or falling pattern without paging back through the month bar one month at a time. Tap any bar to see its exact figure. Transfers aren't counted — moving your own money between accounts isn't spending. Mixed currencies get their own section each, never added together
- **Monthly In & Out** — a month-by-month table of **money in**, **money out**, and **net**, with a total row. Each currency gets its own table; figures are never combined across currencies. It follows the same 3/6/9/12 range picker as the trend chart, and **⬇ CSV** downloads exactly what you see
  - **Income** and **Spending** are only what you truly earned and spent
  - Same-currency transfers and asset purchases are excluded entirely — inside one currency they net to zero
  - A **cross-currency** transfer did move money, so it gets its own **Exchanged In / Exchanged Out** columns rather than being added to income or spending. Send `S$1,000` and receive `RM3,173.30` and you'll see `-S$1,000.00` under SGD Exchanged Out and `+RM3,173.30` under MYR Exchanged In — with MYR income showing a dash, because nothing was earned in MYR
  - These columns only appear for a currency that actually saw an exchange
  - **Net** is everything together, and always matches the change in that currency's accounts — and the figure on the dashboard
- **📊 Generate Full Report** — an AI-written summary of your month (see [AI Insights](#10-ai-insights))

---

## 8. Accounts

Track where your money lives.

### Adding an account

1. Go to **Accounts** → **+ Add Account**
2. Enter the **name** (e.g. "DBS Savings"), pick a **type** (bank / cash / credit card / other), the **institution**, **balance**, and **currency**

Credit cards can have negative balances — shown in red.

### Hiding balances

The 🙈 button next to **+ Add Account** hides every figure on the page — the summary totals, each currency's net, and every account balance — behind `••••••`. It's **on by default**: opening the app for the first time, or on a device that's never set a preference, balances start hidden until you tap 🙈 to reveal them (it becomes 👁️). Your choice is then remembered on that device for next time.

This is scoped to the Accounts page only — the Dashboard and Transactions list are unaffected. It also covers the **Account Insights** panel's Asset Allocation figures below the list; the Debt Ratio percentage and account count stay visible either way, since a ratio or a count doesn't reveal an actual balance.

### Account Insights

Below the list, the Insights panel shows **per currency**:

- **Asset allocation** — how balances split across account types
- **Debt ratio** — debt vs. assets, so a MYR credit card never distorts your SGD picture

---

## 9. Multi-Currency

PFMT supports **SGD, USD, AUD, and MYR** side by side, with one golden rule:

> **Currencies never mix.** An SGD budget only counts SGD spending; MYR income never inflates your SGD savings rate; each currency gets its own totals everywhere.

How it looks in practice:

- Every transaction, budget, goal, and account carries its own currency
- Symbols: `S$` (SGD), `$` (USD), `A$` (AUD), `RM` (MYR)
- When you hold more than one currency, every page groups items under blue **SGD / MYR / …** section headers, and rows show a small currency badge
- Dashboard hero, KPIs, analytics stats, and charts all split per currency automatically
- With a single currency, the interface stays clean and simple — no headers or badges

Your **default currency** (Settings → Preferences) is what new transactions pre-select.

---

## 10. AI Insights

Get personalised, AI-written analysis of your finances — free.

### One-time setup

1. Get a free API key at [console.groq.com](https://console.groq.com)
2. Go to **Settings → AI Configuration**, paste the key, tap **Save**

You only need to do this **once per account, not once per device**. The key is saved to your account, so signing in on your phone picks it up automatically. If a device already has its own key saved, that one is kept — the account's key never silently replaces it.

Saving while signed out keeps the key on that device only, and the app tells you so.

**Getting "invalid API key" on one device?** That device is holding an older key. It fixes itself the next time you use an AI button — the app notices the rejection and switches to your account's key. To force it immediately, tap **use the key from my account ↻** under Settings → AI Configuration.

### Using it

| Where | Button | What you get |
|---|---|---|
| Top bar / Dashboard | ✨ AI Insights | Overall monthly summary and tips |
| Budgets | 🎯 Analyse My Budgets | Which budgets are at risk and why |
| Goals | 🎯 Coach My Goals | Feasibility and pacing advice |
| Analytics | 📊 Generate Full Report | Full written monthly report |
| Accounts | 💰 Analyse My Accounts | Emergency fund, debt, and allocation tips |

The **Now Assist** toggle in Settings turns AI features on/off. Your financial summary is sent to Groq only when you tap an AI button.

---

## 11. Settings & Profile

**Settings** (⚙️ in the sidebar / hamburger drawer) contains everything else:

- **Profile card** — your avatar, display name, username, email, and member-since date, plus live stats (transactions, accounts, active goals)
- **Edit Profile** — change display name, email, and monthly income target
- **Change Password** — enter current + new password
- **Preferences**
  - **Currency** — default currency for new entries
  - **Language** — English or 中文 (the whole interface switches instantly)
  - **Budget Alerts** — toggle threshold notifications
  - **Now Assist** — toggle AI features
- **ServiceNow Connection** — instance, connected user, connection test, and **Sign Out**
- **Data tools**
  - **Load Sample Data** — fill the app with demo data to explore
  - **Retag Transfers** — sets older transfer rows to the **Transfer** category so they stop showing up as ordinary spending. Safe to run twice; it reports how many it changed
- **Clear All Data** — wipe everything local (asks for confirmation; does not delete ServiceNow records)

---

## 12. Data, Sync & Export

### How your data is stored

| Layer | What | When |
|---|---|---|
| Browser localStorage | Full app state | Instantly, on every change |
| ServiceNow | Transactions, budgets, goals, accounts, profile | Pushed automatically in the background when connected |

On page load the app pulls fresh data from ServiceNow, so you can switch devices freely — just log in with the same account.

Rows display a small badge showing their sync state: **SN** (synced to ServiceNow) or **local** (not yet pushed).

### Exporting

- **⬇ CSV** — download all transactions as a spreadsheet-friendly CSV
- **⬇ SN JSON** — download a ServiceNow-format JSON backup of everything

### Automatic weekly backups

Three backups run on their own once set up, and they cover each other's gaps:

- **Emailed CSVs** — lands in your inbox weekly
- **Stored in ServiceNow** — a dated backup record with a full JSON plus CSVs attached, keeping the last 12 weeks. Runs server-side, so it happens whether or not any of your devices are on
- **A folder on your Mac** — `~/Documents/PFMT_Backups/2026-08-17/`, real files you own outright. Only runs while the Mac is awake; if it's asleep at the scheduled time the backup happens on the next wake rather than being skipped

The JSON is the restore file — it keeps every field, including the `transferGroup` that pairs the two legs of a transfer. Restore accounts before transactions, since transactions refer to accounts by name.

An empty or failed pull will never overwrite a good backup: the job stops and leaves the previous one in place, because a network glitch shouldn't be indistinguishable from having deleted everything.

Setup is a one-time job, documented in `backup/README.md`.

---

## 13. Troubleshooting

| Problem | Fix |
|---|---|
| **"Invalid or expired session"** | Sessions last 7 days. The app usually re-logs you in automatically; if not, sign in again. |
| **Can't log in** | Check the instance URL has no `https://` prefix and no trailing slash (e.g. `dev405150.service-now.com`). Verify username/password. If your ServiceNow PDI was hibernating, wake it at developer.servicenow.com and retry. |
| **"Budget for this category and currency already exists"** | You already have a budget for that category in that currency. Edit the existing one, or pick a different currency. |
| **Changes not appearing on another device** | Reload the page — data is pulled from ServiceNow on load. Check the sidebar connection dot is green. |
| **Old version showing after an update** | Hard-refresh: `Cmd/Ctrl+Shift+R` on desktop; on mobile, clear the site from browser cache. |
| **Numbers look mixed between currencies** | They never are — check the blue currency section headers; each section's totals are independent. |
| **AI buttons say a key is needed** | Add your free Groq API key under **Settings → AI Configuration**. |
| **"Your API key was rejected" on one device** | That device holds an older key. Use an AI button once and it switches to your account's key automatically, or tap **use the key from my account ↻** in Settings to force it. |
| **Started fresh by accident (sample data everywhere)** | Sample data loads only when no saved data exists. Log in to restore your real data from ServiceNow, or use **Clear All Data** then reload. |

---

*PFMT — Personal Finance Money Tracker · For setup, API, and developer documentation see [README.md](README.md)*
