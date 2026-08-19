# PFMT Weekly Backup

## Which backup do you want?

| | Covers | Reads via | Setup |
|---|---|---|---|
| **System backup** | **Every user's data** | ServiceNow Table API, admin login | `setup_admin_keychain.sh` → `install_schedule.sh --admin` |
| Personal backup | One account — yours | PFMT API, your PFMT login | `setup_keychain.sh` → `install_schedule.sh` |

**As the system owner, you want the system backup.** The personal one authenticates as a single PFMT user, so the API only ever returns that user's records — it cannot see anyone else's. The system backup reads the tables directly, so it captures everybody in one folder.

Both can run side by side; they use separate credentials, labels and folders.

---

# System backup — every user, one folder

```bash
cd backup
./setup_admin_keychain.sh          # instance + a ServiceNow login that can read x_887486_0_*
./admin_backup.sh                  # try it once
./install_schedule.sh --admin      # weekly, Sunday 09:00
```

Produces:

```
~/Documents/PFMT_System_Backups/2026-08-19/
    user_profile.json      account.json     transaction.json
    budget.json            savings_goal.json category.json
    manifest.json
```

`manifest.json` is the summary you'd check first — row counts per table and **per user**:

```json
{
  "exportedOn": "2026-08-19",
  "totalRows": 1511,
  "tables": { "user_profile": 2, "account": 3, "transaction": 1503, ... },
  "perUser": [
    { "username": "ycs",   "account": 2, "transaction": 1500, "budget": 1, "savings_goal": 0 },
    { "username": "wendy", "account": 1, "transaction": 3,    "budget": 0, "savings_goal": 1 }
  ],
  "secretsIncluded": false,
  "redactedFields": ["ai_api_key", "password_hash", "token"]
}
```

### What it deliberately leaves out

- **Password hashes and AI API keys are redacted by default**, replaced with `__REDACTED__`. A folder of user password hashes is a liability, and you rarely need them. Pass `--include-secrets` if you are taking a true disaster-recovery copy — it warns in the log and records the choice in the manifest.
- **`x_887486_0_session` is never backed up.** It holds live auth tokens, is rebuilt on login, and restoring it would archive credentials for no benefit.
- **`x_887486_0_backup` is never backed up** — it holds copies of the other tables, so including it would nest backups inside backups.

### Requirements

The ServiceNow account needs **read access to the `x_887486_0_*` tables**. A `403` fails loudly and names the table, rather than writing a partial folder. Rows are paged 1,000 at a time, so table size is not a limit.

---

**The personal backup below is optional if you are taking the system backup.**

The Mac job pulls everything through the PFMT API and writes real files you own outright — that is a complete backup by itself. The ServiceNow job exists only so a backup still happens on a week your laptop never wakes up. Set up Part 1 and stop there if that is enough.

| | Where | Runs when |
|---|---|---|
| **Your Mac** *(all you need)* | `~/Documents/PFMT_Backups/2026-08-19/` | Whenever the Mac is awake; a missed slot runs on the next wake |
| **ServiceNow** *(optional)* | Dated records with files attached | Always — server-side, nothing of yours needs to be on |
| **Email** *(already set up)* | CSVs in your inbox | Always |

---

# Personal backup — your account only

## Part 1 — Your Mac

### 1. Store your credentials

```bash
cd backup
./setup_keychain.sh
```

Asks for your instance, username and password and puts them in the **macOS Keychain**. Nothing is written to any file, the password prompt does not echo, and neither the password nor the session token ever reaches a log.

### 2. Install the weekly run

```bash
./install_schedule.sh
```

This registers a launchd agent and then **fires one run immediately**, so a broken setup shows up in seconds instead of next Sunday. You should see:

```
Installed: weekly backup every Sunday 09:00
Running it once now to check the setup...
  ✅ wrote /Users/you/Documents/PFMT_Backups/2026-08-19/
```

Which gives you:

```
~/Documents/PFMT_Backups/2026-08-19/
    accounts.csv  transactions.csv  budgets.csv  goals.csv
    full_backup.json
```

`full_backup.json` is the restore file — every field, including the `transferGroup` that pairs the two legs of a transfer. The CSVs are for reading in a spreadsheet.

### 3. Check on it later

```bash
launchctl list | grep pfmt                    # is it scheduled?
ls ~/Documents/PFMT_Backups/                  # dated folders
tail ~/Documents/PFMT_Backups/.logs/*.log     # what the last run did
./install_schedule.sh --remove                # stop it (keeps existing backups)
```

Keeps the last **12** runs. Override either setting in `~/.zshrc` so the scheduled run sees it too:

```bash
export PFMT_BACKUP_DIR="$HOME/Dropbox/PFMT_Backups"
export PFMT_KEEP_RUNS=26
```

### Why Sunday 09:00 and not "every 7 days"

`StartCalendarInterval` is used rather than `StartInterval`, which matters for a laptop. From `man launchd.plist`:

> **StartCalendarInterval** — "Unlike cron which skips job invocations when the computer is asleep, launchd will start the job the next time the computer wakes up."
>
> **StartInterval** — "If the system is asleep during the time of the next scheduled interval firing, that interval will be missed due to shortcomings in kqueue(3)."

So a closed lid delays the backup to the next wake; it does not skip the week. An elapsed-time interval would drop it. A fixed time also makes "did Sunday's backup run?" a question you can actually answer.

`RunAtLoad` is deliberately off: it fires on every login, not just at install, which would mean a backup every time you log in. The installer triggers one run with `launchctl kickstart` instead — same immediate feedback, no repetition.

---

## Part 2 — ServiceNow (optional)

Skip this unless you want a backup on weeks your Mac never wakes.

### 1. Create the backup table

This table does **not** exist yet. Without it the job logs an error and stops.

**System Definition → Tables → New**

- Label: `PFMT Backup`
- Name: `x_887486_0_backup`

Add these columns:

| Column label | Type | Notes |
|---|---|---|
| Run on | Date/Time | `run_on` |
| User profile | Reference | `user_profile` → `x_887486_0_user_profile` |
| Record count | Integer | `record_count` |
| Summary | String, 1000 | `summary` |
| Status | String, 40 | `status` |

The backup files themselves ride along as attachments on each record.

### 2. Schedule the job

**System Definition → Scheduled Jobs → New → "Automatically run a script of your choosing"**

- Name: `PFMT Weekly Full Backup`
- Run: `Weekly`, Sunday, `02:00`
- Script: paste all of [`../SCHED_WeeklyFullBackup.js`](../SCHED_WeeklyFullBackup.js)

Pushing to GitHub does **not** update ServiceNow — this paste is the only way the script gets there.

### 3. Check it

Hit **Execute Now**, then look at the `x_887486_0_backup` list. You should see one record per user with five attachments: `pfmt_full_<date>.json` plus four CSVs. The system log line starts with `PFMT Full Backup`.

Keeps the last **12** weekly backups per user and prunes older ones — change `KEEP_WEEKS` at the top of the script.

---

## What it refuses to do

The backup deliberately fails rather than writing something misleading:

- **An empty pull never overwrites good history.** If every dataset comes back with zero rows — an expired session, a network fault that still returns `200` — it exits non-zero and leaves the previous backup alone. Otherwise a transient failure would look exactly like "you deleted everything".
- **A folder is published atomically.** Files are staged in a `.partial` folder and only moved into place once complete, so an interrupted run can't leave a half-written backup that looks valid.
- **A failed login changes nothing** and says so in the log.

Logs: `~/Documents/PFMT_Backups/.logs/backup_<date>.log`, kept 90 days.

---

## Restoring

`full_backup.json` holds everything. Accounts must be recreated before transactions, since transactions reference accounts by name:

1. Accounts
2. Categories (if any are missing)
3. Transactions — keep `transferGroup` intact or paired transfers will restore as two unrelated rows
4. Budgets and goals

The ServiceNow copy of the same file is attached to its backup record if you'd rather pull it from there.

## If something breaks

| Symptom | Cause |
|---|---|
| `no credentials in Keychain` | `./setup_keychain.sh` hasn't been run |
| `login failed` | Password changed, or wrong instance — re-run `./setup_keychain.sh` |
| `refusing to write an empty backup` | Working as intended; check the instance is reachable and the account still has data |
| Scheduled run never fires | `launchctl list \| grep pfmt`; if absent, re-run `./install_schedule.sh` |
| `refused the request ... HTTP 403` | The ServiceNow account cannot read that table — grant read on `x_887486_0_*` |
| Table error in the SN log | The `x_887486_0_backup` table hasn't been created — see Part 2 (or skip ServiceNow entirely) |
