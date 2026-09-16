# Feature Ideas

Undeveloped ideas for PFMT, logged as they come up. Not a commitment or a schedule — see [README.md](README.md) for what's actually built, and [BACKUP_STEPS.md](BACKUP_STEPS.md) / [USER_GUIDE.md](USER_GUIDE.md) for what's live today.

---

## ✅ Monthly bills checklist — **shipped 2026-09-16**

**Logged 2026-09-15**

A page where the user keys in their recurring bills/expenses once (name, amount, due day, category/account). Each month, the app checks actual transactions and auto-checks off any bill that already has a matching transaction for that month — so the page reads as "what's paid vs. still outstanding," not a second ledger to maintain by hand.

**How this differs from `transaction.is_recurring`**: that flag auto-*clones* a transaction on a schedule — still dormant, no frontend UI. This idea runs the other way: the bill is a manually-entered expectation, and the app watches for a real transaction to satisfy it, rather than generating the transaction itself. The two could eventually share a table, but they're solving different problems.

**Built as leaned:** matching is computed client-side at render time, not stored. `pfmtMatchBills()` in `index.html` checks each bill against `state.transactions` for the month being viewed. No `paid` flag anywhere in the schema — recomputed on every load, same as budgets and savings rate.

**How the open questions were answered:**

- **Tolerance on the amount match** — `max(1.00, 2% of the bill)`, so rounding and small fee drift still match. A bill can be marked **"amount changes each month"**, which drops the amount test entirely and matches on category and account alone; that's the answer for utilities, whose figure is never the same twice. The row then displays the *real* amount paid, not the estimate.
- **Two bills sharing a category cross-matching** — solved rather than deferred: one transaction can only ever satisfy one bill. Bills are matched fewest-candidates-first, so a bill whose only possible payment is a single row is never robbed of it by a looser bill that had other options. Manual linking turned out not to be needed; the residual risk is two *varying* bills in one category, which tying one to an account fixes. `test/bills-and-alerts.test.js` covers it.
- **A bill with no matching transaction by month-end** — shown as **"missed"** when you page back to that month; the current month always starts clean. Costs no state, since nothing about a bill is carried forward.
- **Where it lives in the nav** — its own page, between Budgets and Goals, with a badge counting what's still unpaid this month (red once anything is late). A tab inside Budgets would have buried it, and it's a page you open deliberately.
- **New table** — `public.bills`, in `supabase/migrations/002_bills_and_notifications.sql`.

See [README § Bills](README.md#bills) and [USER_GUIDE § 6](USER_GUIDE.md#6-monthly-bills).

---

## ✅ Budget threshold alerts via Telegram — **shipped 2026-09-16**

**Logged 2026-09-15**

When an expense pushes a budget past its alert %, notify the user outside the app — instead of (or alongside) whatever in-app indicator exists today.

**The half-built ServiceNow version is gone.** `BR_UpdateBudgetSpent.js` used to fire `gs.eventQueue('x_pfmt.budget.threshold_reached', ...)` into the void, with nothing listening. That file was deleted along with the rest of the ServiceNow scripts when the backend was retired; the Supabase version was built from scratch.

**Built as leaned — Telegram, not WhatsApp.** One HTTPS POST, free, no approval process. WhatsApp's official API needs Meta business verification and pre-approved templates; the Twilio sandbox route needs re-opt-in every 72 hours, which is exactly the wrong property for something whose job is to reach you unprompted. Only `sendTelegram()` would have to change to add WhatsApp later — nothing that decides *what* to say.

**How it's wired:**

1. One Edge Function, `pfmt-notify`, reached two ways: the app calls it with the user's JWT right after an expense is recorded, and `pg_cron` calls it nightly with a shared secret header for the bills that nobody has the app open to notice.
2. The alert text is built server-side from the same money rules the page uses — the `PFMT SHARED MONEY RULES` block is copied verbatim into the function by `tools/sync-shared-rules.js`, and a test fails if the two copies drift. An alert can't contradict the budget card.

**How the open questions were answered:**

- **Bot token storage** — a shared secret, so it lives only in the Edge Function's environment (`TELEGRAM_BOT_TOKEN`), never per-user, never in the database, never in a backup. Only the per-user `telegram_chat_id` is stored, on `preferences` — and a chat id is an address, not a credential.
- **Re-alert behaviour** — first built as once per month per level, then changed at the owner's request: **budget alerts fire on every expense that hits**, with the new total, checking only the category just spent in. Bill reminders keep a limit (once as due, once if late), enforced by the primary key on `notifications_sent`, so the daily run can't repeat a bill.

See [TELEGRAM_SETUP.md](TELEGRAM_SETUP.md) for the one-time setup, and [README § Telegram alerts](README.md#telegram-alerts).

---

## Still unbuilt

### Recurring transactions

`is_recurring`, `recurring_frequency` and `next_run_date` survive a round trip and appear in backups, but nothing generates from them — the ServiceNow flow that would have is gone. Bills solved the adjacent problem from the other direction (watch for a transaction rather than create one), so this is only worth building for things you genuinely want *created* without being paid — an accrual, a standing estimate.

### Rewrite the `backup/` scripts for Supabase

Every script in `backup/` authenticates against ServiceNow and is dead. [BACKUP_STEPS.md](BACKUP_STEPS.md) now documents the `pg_dump` route by hand; turning that into the scheduled job the old `admin_backup.sh` was would be a contained piece of work.

### Custom SMTP

Supabase's built-in auth email is capped at **2 messages an hour**, which makes a password reset slow at the worst possible moment. Pointing Auth at a real SMTP provider removes the cap.
