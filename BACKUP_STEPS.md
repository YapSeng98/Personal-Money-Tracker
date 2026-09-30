# PFMT Backup — what to do

Your book lives in Supabase. There are three ways to back it up.

> **Scheduled backup:** `backup/supabase_backup.py` backs up every user from
> Supabase. Run `backup/setup_supabase_keychain.sh` once (it stores the
> service-role key in the Keychain), then `backup/install_schedule.sh` for a
> weekly run.

---

## Take one right now — 10 seconds

1. Open the app → **Settings → Export & Backup**
2. Click **Complete backup ⬇ JSON**
3. A file lands in `~/Downloads/pfmt_backup_<date>.json`

That single file holds every table: accounts, transactions, budgets, bills,
goals, categories and your profile. It is the restore file.

**What it deliberately leaves out:** your password, your AI key, your app-lock
PIN and the Telegram bot token. A backup gets copied to places a credential
should never follow, and reissuing a login costs far less than containing a
leaked one.

**It is always the whole book.** The app pages in every transaction on load,
so there is no fetch limit for a backup to fall short of.

The Dashboard shows a reminder when it has been too long since your last one.

---

## The three layers you actually have

| Layer | Covers | Effort | Gets you back from |
|---|---|---|---|
| **App JSON export** | your whole book | one click | deleting a row, a bad edit, wanting the data elsewhere |
| **Supabase platform backups** | the whole database | already on | the database being lost |
| **`pg_dump`** | the whole database, as SQL | one command | anything, including the project being deleted |

They cover different failures, which is the point. Supabase's own backups will
not help you if you delete a transaction and notice three weeks later — but a
JSON export from before then will.

---

## Layer 2 — Supabase's own backups

Already running; nothing to set up. Check what exists at
**[Database → Backups](https://supabase.com/dashboard/project/oqsqfrpblinvsizitmgl/database/backups)**.

On the free plan these are daily and retained for a short window, restorable from
that page. They protect against the database failing, not against you.

---

## Layer 3 — `pg_dump` to your own disk

A real, complete, restorable copy of the database on hardware you own.

### One-off

1. Get your connection string: **[Project Settings → Database →
   Connection string → URI](https://supabase.com/dashboard/project/oqsqfrpblinvsizitmgl/settings/database)**,
   and reveal the password.
2. Then:

```bash
mkdir -p ~/PFMT_Backups
pg_dump "postgresql://postgres.oqsqfrpblinvsizitmgl:<PASSWORD>@<HOST>:5432/postgres" \
  --schema=public --no-owner --no-privileges \
  -f ~/PFMT_Backups/pfmt_$(date +%F).sql
```

`pg_dump` comes with the Postgres client tools — `brew install libpq` if you
don't have it.

### Keep the password out of the command

Putting it on the command line leaves it in your shell history. Use a `.pgpass`
file instead:

```bash
printf '%s\n' '<HOST>:5432:postgres:postgres.oqsqfrpblinvsizitmgl:<PASSWORD>' >> ~/.pgpass
chmod 600 ~/.pgpass
```

Then drop the password from the URI and `pg_dump` picks it up.

### Weekly, automatically

Save as `~/bin/pfmt_backup.sh`:

```bash
#!/bin/bash
set -euo pipefail
OUT=~/PFMT_Backups
mkdir -p "$OUT"
TMP=$(mktemp)
# Write to a temp file first: a failed dump must never replace a good backup.
pg_dump "postgresql://postgres.oqsqfrpblinvsizitmgl@<HOST>:5432/postgres" \
  --schema=public --no-owner --no-privileges -f "$TMP"
# A dump with no transactions in it is a failure wearing a success costume.
grep -q 'COPY public.transactions' "$TMP" || { echo "dump looks empty — keeping previous"; exit 1; }
mv "$TMP" "$OUT/pfmt_$(date +%F).sql"
# Keep a year, drop the rest.
ls -1t "$OUT"/pfmt_*.sql | tail -n +53 | xargs -r rm --
echo "backed up to $OUT/pfmt_$(date +%F).sql"
```

```bash
chmod +x ~/bin/pfmt_backup.sh
```

Schedule it with `launchd` — `backup/com.pfmt.weeklybackup.plist` is a working
example of the plist shape; point its `ProgramArguments` at the script above.
`launchd` runs a missed job on the next wake rather than skipping it, which
`cron` does not.

---

## Restoring

### From the JSON export

There is no import button in the app. Restore is a SQL job:

1. Open the JSON and confirm `"pfmt_backup": { "complete": true }`.
2. **Accounts first, then transactions** — transactions refer to accounts by
   name, so accounts have to exist first.
3. Keep `transfer_group` intact. It is what pairs the two legs of a transfer or a
   funded asset purchase; split them and balances stop reconciling and an asset
   purchase comes back as a stray expense and income.
4. Insert with your own `user_id`, or let the column default to `auth.uid()` when
   running as yourself.

### From a `pg_dump`

```bash
psql "postgresql://postgres.oqsqfrpblinvsizitmgl@<HOST>:5432/postgres" \
  -f ~/PFMT_Backups/pfmt_2026-09-16.sql
```

Restore into a **fresh or empty** project unless you intend to overwrite what is
there. Check `supabase/migrations/` has been applied first if the target is new.

### From Supabase's platform backups

Dashboard → Database → Backups → Restore. This replaces the whole database.

---

## What a backup can't save you from

**Losing your password.** Supabase's free email allowance is 2 messages an hour,
so a reset can be slow to arrive; nothing in a backup file will sign you in.
Configure custom SMTP under Auth settings if that matters to you.

**The Telegram bot token.** Not in any backup, by design. If you lose it, make a
new bot with @BotFather and update the Edge Function secret —
[TELEGRAM_SETUP.md](TELEGRAM_SETUP.md).
