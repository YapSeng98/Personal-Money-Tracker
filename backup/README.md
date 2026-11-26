# PFMT Weekly Backup

Backs up **every user's data** straight from Supabase to a folder on this Mac,
once a week. The job checks every morning at 09:00 and backs up when the newest
backup is 7 days old, so a run that fails (the Mac woke with no network) is
retried the next morning, not a week later. Nothing to install — it uses the
Python and curl that come with macOS.

## Set it up once

1. **Copy the secret key.** Supabase dashboard →
   [Project Settings → API Keys](https://supabase.com/dashboard/project/oqsqfrpblinvsizitmgl/settings/api-keys)
   → the **secret** key (`sb_secret_…`, or `service_role` on older projects) →
   Reveal → Copy. Not the publishable key — that one only sees a signed-in
   user's own rows.

2. **In Terminal:**

   ```bash
   cd backup
   ./setup_supabase_keychain.sh   # paste the key; it goes into the Keychain only
   ./supabase_backup.py           # take one now
   ./install_schedule.sh          # weekly from here on, checked daily at 09:00
   ```

## What you get

```
~/PFMT_Backups/2026-09-30/
    accounts.json      transactions.json   budgets.json
    goals.json         bills.json          preferences.json
    notifications_sent.json                manifest.json
```

`manifest.json` is the one to check first — row counts per table and per user.

## What it refuses to do

- **Write an empty backup.** No transactions back — an expired key, a network
  fault — and it stops, leaving the previous backups alone.
- **Write a partial one.** Every table is paged 1,000 rows at a time and the
  total is checked against Supabase's own count before anything is saved.
- **Leave a half-written folder.** Files go into `<date>.partial` and are moved
  into place only once complete.
- **Keep credentials.** `preferences.ai_api_key` is replaced with
  `__REDACTED__`. The service-role key lives only in the Keychain.

## Settings

Add to `~/.zshrc`, then re-run `./install_schedule.sh` so the schedule picks up
the folder:

```bash
export PFMT_BACKUP_DIR="$HOME/Dropbox/PFMT_Backups"   # default ~/PFMT_Backups
export PFMT_KEEP_RUNS=26                              # default 12
```

`./install_schedule.sh --monthly` backs up every 4 weeks instead.
`./supabase_backup.py --if-due 7` backs up only if the newest backup is at
least 7 days old; it is what the schedule runs.

## Check on it

```bash
launchctl list | grep pfmt                          # is it scheduled?
ls ~/PFMT_Backups/                        # dated folders
tail ~/PFMT_Backups/.logs/launchd.*.log   # what the last run did
./install_schedule.sh --remove                      # stop it (keeps backups)
```

A closed lid only delays a run to the next wake. A run that fails anyway is
tried again the next morning, and each failure shows a "PFMT backup failed"
notification.

Keep the folder out of `~/Documents`, `~/Desktop` and `~/Downloads`. macOS
blocks background jobs from writing there, so the scheduled run fails even
though running the script by hand works.

## If something breaks

| Message | Fix |
|---|---|
| `no service-role key in the Keychain` | Run `./setup_supabase_keychain.sh` |
| `Supabase refused … (HTTP 401/403)` | Wrong key, or the publishable one — re-run the setup with the secret key |
| `refusing to write an empty backup` | Supabase unreachable or the key was rotated; previous backups are untouched |
| `read N rows but Supabase reports M` | Rows changed mid-run; just run it again |

Restoring, and the other backup options (one-click export in the app,
`pg_dump`), are in [../BACKUP_STEPS.md](../BACKUP_STEPS.md).
