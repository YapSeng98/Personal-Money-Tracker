# Personal Finance Money Tracker (PFMT)

A full-featured personal finance web app that syncs with ServiceNow as its cloud backend. Track transactions, manage budgets, set savings goals, and analyse spending — all from a single HTML file hosted on GitHub Pages.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Architecture Overview](#architecture-overview)
3. [ServiceNow Data Model](#servicenow-data-model)
4. [REST API Reference](#rest-api-reference)
5. [Authentication & Sessions](#authentication--sessions)
6. [Frontend Features](#frontend-features)
7. [ServiceNow Components](#servicenow-components)
8. [Deployment Guide](#deployment-guide)
9. [Error Reference](#error-reference)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS + HTML5 + CSS3 (single file) |
| Backend | ServiceNow PDI — Scripted REST APIs |
| Auth | Custom token-based (32-char hex, 7-day sessions) |
| Local storage | Browser `localStorage` (`pfmt_state_v2`) |
| AI insights | Groq API (optional) |
| Hosting | GitHub Pages |

---

## Architecture Overview

```
┌─────────────────────────────────────┐
│         GitHub Pages                │
│    index.html  (SPA)                │
│                                     │
│  ┌──────────┐   ┌────────────────┐  │
│  │  State   │   │   snAPI.call() │  │
│  │ (memory) │   │  fetch() CORS  │  │
│  └────┬─────┘   └───────┬────────┘  │
│       │                 │           │
│  localStorage        X-PFMT-Token   │
└───────┼─────────────────┼───────────┘
        │                 │
        ▼                 ▼
  pfmt_state_v2    ServiceNow PDI
  (offline cache)  /api/x_1472763_person_0/pfmt/v1
                   ├── /auth/{action}
                   ├── /transactions
                   ├── /budgets
                   ├── /goals
                   ├── /accounts
                   └── /profile
```

**Data sync model**: All changes update local state + localStorage immediately (optimistic). If a session token exists, changes are also pushed to ServiceNow asynchronously (fire-and-forget). On page load the app auto-connects with saved credentials and pulls fresh data from SN.

---

## ServiceNow Data Model

All tables share the prefix `x_1472763_person_0_`.

### `user_profile`

| Field | Type | Notes |
|---|---|---|
| `username` | String | Unique, lowercase |
| `password_hash` | String | SHA-256 hex |
| `display_name` | String | |
| `email` | String | |
| `currency_preference` | String | Default: `SGD` |
| `language_preference` | String | Default: `en` |
| `avatar_color` | String | Hex color, default `#8B5CF6` |
| `monthly_income_target` | Decimal | |
| `last_login` | DateTime | Bumped on every valid token use |

### `session`

| Field | Type | Notes |
|---|---|---|
| `user_profile` | Reference | Link to `user_profile` |
| `token` | String(40) | 32-char random hex |
| `expires_at` | DateTime | 7 days from creation |
| `device_hint` | String | First 100 chars of User-Agent |

### `account`

| Field | Type | Notes |
|---|---|---|
| `user_profile` | Reference | |
| `account_name` | String | |
| `account_type` | String | `checking`, `savings`, `credit_card`, etc. |
| `institution_name` | String | Bank / provider |
| `current_balance` | Decimal | Updated by BR_UpdateAccountBalance |
| `currency` | String | Default: `SGD` |
| `is_active` | Boolean | |

### `transaction`

| Field | Type | Notes |
|---|---|---|
| `account` | Reference | |
| `category` | Reference | |
| `transaction_type` | String | `expense`, `income`, `transfer` |
| `amount` | Decimal | Must be > 0 |
| `description` | String | Required |
| `transaction_date` | Date | |
| `notes` | String | Optional |
| `state` | String | `1`=Draft, `2`=Confirmed |
| `is_recurring` | Boolean | |
| `recurring_frequency` | String | `daily`, `weekly`, `monthly` |
| `next_run_date` | Date | Managed by FLOW_RecurringTransactions |

### `category`

| Field | Type | Notes |
|---|---|---|
| `category_name` | String | Unique |
| `category_type` | String | `expense`, `income` |
| `icon_emoji` | String | e.g. `🍜` |
| `color_hex` | String | e.g. `#8B5CF6` |
| `is_system_default` | Boolean | |

### `budget`

| Field | Type | Notes |
|---|---|---|
| `user_profile` | Reference | |
| `category` | Reference | |
| `budget_amount` | Decimal | |
| `spent_amount` | Decimal | Auto-updated by BR_UpdateBudgetSpent |
| `remaining_amount` | Decimal | Calculated: budget − spent |
| `alert_threshold` | Integer | Percent, default `80` |
| `period_start` | Date | |
| `period_end` | Date | |

### `savings_goal`

| Field | Type | Notes |
|---|---|---|
| `user_profile` | Reference | |
| `goal_name` | String | Required |
| `goal_icon` | String | Emoji, default `🎯` |
| `target_amount` | Decimal | Required |
| `current_amount` | Decimal | |
| `monthly_contribution` | Decimal | |
| `target_date` | Date | Optional |
| `goal_status` | String | `in_progress`, `achieved` — auto-managed |
| `account` | Reference | Optional linked account |

---

## REST API Reference

**Base URL**: `https://<instance>.service-now.com/api/x_1472763_person_0/pfmt/v1`

All endpoints except `/auth/*` require:
```
X-PFMT-Token: <token>
X-HTTP-Method: GET|POST|PUT|DELETE
Content-Type: application/json
```

---

### Auth — `/auth/{action}`

#### POST `/auth/login`

```json
// Request
{ "username": "john", "password": "secret123" }

// Response 200
{
  "result": {
    "token": "a1b2c3d4e5f6...",
    "user_profile_sys_id": "abc123...",
    "username": "john",
    "display_name": "John Doe",
    "email": "john@example.com",
    "currency": "SGD",
    "language": "en",
    "avatar_color": "#8B5CF6",
    "monthly_income_target": 5000
  }
}
```

#### POST `/auth/register`

```json
// Request
{
  "username": "john",
  "password": "secret123",
  "display_name": "John Doe",
  "email": "john@example.com",
  "currency": "SGD",
  "language": "en"
}

// Response 201
{ "result": { "token": "...", "user_profile_sys_id": "...", ... } }
```

#### POST `/auth/logout`

```json
// Request: token in X-PFMT-Token header or body
// Response 200
{ "result": { "status": "logged_out" } }
```

---

### Accounts — `/accounts`

#### GET `/accounts`

```json
// Response 200
{
  "result": [
    {
      "sys_id": "...",
      "account_name": "DBS Savings",
      "account_type": "savings",
      "institution_name": "DBS",
      "current_balance": 12500.00,
      "currency": "SGD"
    }
  ],
  "count": 1
}
```

#### POST `/accounts`

```json
// Request
{
  "account_name": "DBS Savings",
  "account_type": "savings",
  "institution_name": "DBS",
  "current_balance": 12500.00,
  "currency": "SGD"
}
// Response 201
{ "result": { "sys_id": "...", "status": "created" } }
```

#### PUT `/accounts`

```json
// Request — sys_id required, other fields optional
{ "sys_id": "...", "current_balance": 13000.00 }
// Response 200
{ "result": { "sys_id": "...", "status": "updated" } }
```

#### DELETE `/accounts`

```json
// Request body or ?sys_id= query param
{ "sys_id": "..." }
// Response 200
{ "result": { "sys_id": "...", "status": "deleted" } }
```

---

### Transactions — `/transactions`

#### GET `/transactions`

Query params: `limit` (default 500), `type` (expense|income), `month` (YYYY-MM)

```json
// Response 200
{
  "result": [
    {
      "sys_id": "...",
      "type": "expense",
      "amount": 12.50,
      "description": "Kopi at Ya Kun",
      "category": "Food & Drink",
      "account": "DBS Checking",
      "date": "2024-06-15",
      "notes": ""
    }
  ],
  "count": 1
}
```

#### POST `/transactions`

```json
// Request
{
  "type": "expense",
  "amount": 12.50,
  "description": "Kopi at Ya Kun",
  "date": "2024-06-15",
  "account_name": "DBS Checking",
  "category_name": "Food & Drink",
  "notes": ""
}
// Response 201
{ "result": { "sys_id": "...", "status": "created" } }
```

#### PUT `/transactions`

```json
// Request
{ "sys_id": "...", "amount": 13.00, "description": "Kopi + Toast" }
// Response 200
{ "result": { "sys_id": "...", "status": "updated" } }
```

#### DELETE `/transactions`

```json
{ "sys_id": "..." }
// Response 200
{ "result": { "sys_id": "...", "status": "deleted" } }
```

---

### Budgets — `/budgets`

#### GET `/budgets`

```json
// Response 200
{
  "result": [
    {
      "sys_id": "...",
      "category": "Food & Drink",
      "category_icon": "🍜",
      "category_color": "#8B5CF6",
      "budget_amount": 500.00,
      "spent_amount": 325.00,
      "remaining_amount": 175.00,
      "alert_threshold": 80,
      "period_start": "2024-06-01",
      "period_end": "2024-06-30"
    }
  ],
  "count": 1
}
```

#### POST `/budgets`

```json
// Request
{
  "category_name": "Food & Drink",
  "budget_amount": 500.00,
  "alert_threshold": 80,
  "period_start": "2024-06-01",
  "period_end": "2024-06-30"
}
// Response 201
{ "result": { "sys_id": "...", "status": "created" } }
// Error 409 if budget for this category already exists
```

#### PUT `/budgets`

```json
{ "sys_id": "...", "budget_amount": 600.00, "alert_threshold": 75 }
// Response 200
{ "result": { "sys_id": "...", "status": "updated" } }
```

#### DELETE `/budgets`

```json
{ "sys_id": "..." }
// Response 200
{ "result": { "sys_id": "...", "status": "deleted" } }
```

---

### Goals — `/goals`

#### GET `/goals`

```json
// Response 200
{
  "result": [
    {
      "sys_id": "...",
      "goal_name": "Japan Trip",
      "goal_icon": "✈️",
      "target_amount": 5000.00,
      "current_amount": 2500.00,
      "monthly_contribution": 500.00,
      "target_date": "2024-12-31",
      "goal_status": "in_progress",
      "progress_pct": 50.0,
      "account_sys_id": "...",
      "account_name": "Savings"
    }
  ],
  "count": 1
}
```

#### POST `/goals`

```json
// Request
{
  "goal_name": "Japan Trip",
  "goal_icon": "✈️",
  "target_amount": 5000.00,
  "current_amount": 0,
  "monthly_contribution": 500.00,
  "target_date": "2024-12-31",
  "account_name": "Savings"
}
// Response 201
{ "result": { "sys_id": "...", "status": "created" } }
// goal_status auto-set to 'achieved' if current >= target
```

#### PUT `/goals`

```json
{ "sys_id": "...", "current_amount": 3000.00 }
// Response 200 — goal_status auto-updated
{ "result": { "sys_id": "...", "status": "updated" } }
```

#### DELETE `/goals`

```json
{ "sys_id": "..." }
// Response 200
{ "result": { "sys_id": "...", "status": "deleted" } }
```

---

### Profile — `/profile`

#### GET `/profile`

```json
// Response 200
{
  "result": {
    "sys_id": "...",
    "username": "john",
    "display_name": "John Doe",
    "email": "john@example.com",
    "currency": "SGD",
    "language": "en",
    "avatar_color": "#8B5CF6",
    "monthly_income_target": 5000,
    "last_login": "2024-06-15 10:30:00",
    "sys_created_on": "2024-01-01 08:00:00",
    "stats": {
      "transaction_count": 45,
      "account_count": 3,
      "active_goal_count": 2
    }
  }
}
```

#### PUT `/profile`

```json
// Request — all fields optional
{
  "display_name": "John Doe",
  "email": "john@example.com",
  "currency": "SGD",
  "language": "en",
  "avatar_color": "#00C896",
  "monthly_income_target": 6000,
  "current_password": "oldpass",
  "new_password": "newpass123"
}
// Response 200
{ "result": { "status": "updated", "display_name": "...", ... } }
```

---

## Authentication & Sessions

### Flow

```
1. User enters instance + username + password
2. App POSTs to /auth/login
3. SN validates: username lookup → SHA-256 hash compare
4. On success: createSession() inserts into x_1472763_person_0_session
5. Token (32-char hex) returned → stored in state.snToken + localStorage
6. All subsequent API calls include X-PFMT-Token: <token>
7. validateToken() queries session table (token match + expires_at > NOW)
8. Expiry: 7 days from login — app auto-reconnects with saved credentials
```

### Auto-connect on page load

```
Page load
  ├── If saved token: verify with GET /profile
  │     ├── Valid → load data, skip login screen
  │     └── Expired → _tryAutoLogin() with saved credentials
  └── No token → _tryAutoLogin()
        ├── Credentials saved → silent POST /auth/login → load data
        └── No credentials → show login screen
```

### Security notes

- Passwords are SHA-256 hashed (no salt) before comparison
- Session tokens are 32-char random hex (fit in SN String(40) fields)
- Credentials (including password) are stored in browser `localStorage` to enable auto-connect — do not use on shared/public computers
- 4-digit PIN lock is available as an additional app-level guard (Settings → App Security)

---

## Frontend Features

### Navigation

| Page | Description |
|---|---|
| Dashboard | Monthly net balance, quick stats, recent transactions, spend breakdown |
| Transactions | Full list with month/type filter, add/edit/delete, SN sync |
| Budgets | Category budgets, spent vs. limit, alert threshold rings |
| Goals | Savings goals, progress bars, quick contribution buttons |
| Analytics | Charts — category breakdown, monthly trends, income vs. expenses |
| Accounts | Linked accounts, balances, institution |
| Profile | User info, account stats, edit display name / email / income target |
| Settings | SN connection card, PIN setup, currency/language, Groq AI key |

### State structure

```javascript
{
  transactions: [],   // [{id, sys_id, type, amount, description, category, account, date, notes}]
  budgets:      [],   // [{id, sys_id, category, amount, spent, alertPct}]
  goals:        [],   // [{id, sys_id, name, icon, target, current, monthly, date}]
  accounts:     [],   // [{id, sys_id, name, type, institution, balance}]

  snToken:         null,
  snProfileSysId:  null,
  snUserProfile:   {},
  snInstance:      'dev275144.service-now.com',
  snUsername:      '',
  snPassword:      '',

  currency:    'SGD',
  language:    'en',
  geminiKey:   '',
  lastSync:    null,
  filterMonth: 'YYYY-MM',
  nextId:      100
}
```

Persisted to `localStorage` key `pfmt_state_v2`.

### Lock / PIN feature

- Set a 4-digit PIN in Settings → App Security
- PIN hash stored in `localStorage` (PIN_KEY) — separate from app state
- Lock button in sidebar locks the app immediately
- Unlock via numpad overlay
- Forgot PIN: clears all localStorage and reloads

---

## ServiceNow Components

### Script Include: `PFMTAuthHelper`

| Method | Description |
|---|---|
| `validateToken(token)` | Returns `user_profile` sys_id or `null` |
| `hashPassword(plaintext)` | Returns SHA-256 hex string |
| `generateToken()` | Returns 32-char random hex (one GUID without hyphens) |
| `createSession(sysId, deviceHint)` | Inserts session record, returns token |
| `deleteSession(token)` | Removes session on logout |
| `pruneExpiredSessions()` | Cleanup — run as scheduled job |
| `errorResponse(response, status, msg)` | Standardised error format |

### Business Rules

| Name | Table | Trigger | Purpose |
|---|---|---|---|
| `BR_ValidateTransaction` | transaction | Before Insert+Update | Validate amount > 0, set recurring next_run_date |
| `BR_UpdateAccountBalance` | transaction | After Insert+Update (Confirmed) | Increment/decrement account balance |
| `BR_UpdateBudgetSpent` | transaction | After Insert (Expense) | Update budget spent_amount + fire alert event |
| `BR_BudgetCalculatedFields` | budget | Before Insert+Update | Calculate remaining_amount, default period dates |

### Flows

| Name | Schedule | Purpose |
|---|---|---|
| `FLOW_MonthlyBudgetReset` | 1st of month, 00:01 SGT | Reset spent_amount, apply rollover, update period dates |
| `FLOW_RecurringTransactions` | Daily 08:00 SGT | Clone recurring transactions, advance next_run_date |

### Client Scripts (form UI)

| Name | Event | Purpose |
|---|---|---|
| `CS_DefaultTransactionDate` | onLoad | Pre-fill today's date, set state to Confirmed |
| `CS_FilterCategoriesByType` | onChange (type) | Filter category dropdown by expense/income |
| `CS_RecurringToggleAndBudgetHint` | onChange | Show/hide recurring fields, show live budget hint |

### Utilities (`GR_Utilities`)

Run these once in **Scripts – Background** to seed initial data:

```javascript
// Seed 13 default categories
new GR_Utilities().seedCategories();
```

Default categories seeded:

**Expense**: Food & Drink 🍜, Transport 🚇, Groceries 🛒, Shopping 🛍️, Bills 🏠, Health 🏥, Entertainment 🎬, Education 📚, Travel ✈️, Other 💰

**Income**: Salary 💼, Freelance 💻, Investment 📈

---

## Deployment Guide

### Prerequisites

- ServiceNow Personal Developer Instance (PDI) — free at developer.servicenow.com
- GitHub account (for Pages hosting)

---

### Step 1 — ServiceNow tables

Create the following tables in Studio (prefix `x_1472763_person_0_`):
- `user_profile`
- `session`
- `account`
- `transaction`
- `category`
- `budget`
- `savings_goal`

Add fields as described in the [Data Model](#servicenow-data-model) section. Ensure the `session.token` field is at least **String(40)**.

---

### Step 2 — Script Include

Create **PFMTAuthHelper** (not client-callable). Paste contents of `SI_PFMTAuthHelper.js`.

---

### Step 3 — Scripted REST APIs

In Studio → Create File → Scripted REST API:
- **API Name**: `PFMT API`
- **Base path**: `pfmt/v1`
- **Scope**: your app scope

Add 6 resources and paste corresponding `REST_*.js` files:

| Resource | Methods | File |
|---|---|---|
| `/auth/{action}` | POST | `REST_AuthAPI.js` |
| `/transactions` | GET, POST, PUT, DELETE | `REST_TransactionsAPI.js` |
| `/budgets` | GET, POST, PUT, DELETE | `REST_BudgetsAPI.js` |
| `/goals` | GET, POST, PUT, DELETE | `REST_GoalsAPI.js` |
| `/accounts` | GET, POST, PUT, DELETE | `REST_AccountsAPI.js` |
| `/profile` | GET, PUT | `REST_ProfileAPI.js` |

> **Important**: Set **"Requires authentication" = false** on each resource (auth is handled by `X-PFMT-Token`).

---

### Step 4 — Business Rules & Client Scripts

Create each file listed in [ServiceNow Components](#servicenow-components). Paste contents from the corresponding `.js` files.

---

### Step 5 — Flows

Import `FLOW_MonthlyBudgetReset.js` and `FLOW_RecurringTransactions.js` in Flow Designer. Set the scheduled triggers as described.

---

### Step 6 — Seed categories

Open **Scripts – Background** in SN and run:

```javascript
new GR_Utilities().seedCategories();
```

---

### Step 7 — GitHub Pages

1. Push `index.html` to the `main` branch of your GitHub repo
2. Go to **Repo → Settings → Pages → Source: main branch / root**
3. Your app is live at `https://<username>.github.io/<repo-name>/`

---

### Step 8 — First login

1. Open the GitHub Pages URL
2. Enter your SN instance URL (e.g. `dev275144.service-now.com`)
3. Enter your PFMT username and password (created via Register if first time)
4. App auto-saves credentials — future visits connect automatically

---

## Error Reference

| HTTP Status | Meaning |
|---|---|
| 200 | Success |
| 201 | Record created |
| 400 | Bad request — missing required field or invalid value |
| 401 | Invalid or expired session token |
| 403 | Access denied — record belongs to another user |
| 404 | Record not found, or unknown endpoint action |
| 405 | HTTP method not allowed on this resource |
| 409 | Conflict — duplicate (e.g. budget for same category already exists) |
| 500 | Server error — check SN system logs |

All error responses follow the format:

```json
{ "error": "Human-readable message" }
```

---

*PFMT — Personal Finance Money Tracker | ServiceNow PDI + GitHub Pages*
