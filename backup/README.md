# PFMT Weekly Backup

Two backups run every week, and they cover each other's weak spot:

| | Where | Runs when |
|---|---|---|
| **ServiceNow** | Dated backup records with files attached | Always — server-side, nothing of yours needs to be on |
| **Your Mac** | `~/Documents/PFMT_Backups/2026-08-17/` | Only while your Mac is awake |
| **Email** *(already set up)* | CSVs in your inbox | Always |

The Mac one gives you real files you own outright. The ServiceNow one keeps running when your laptop is shut. Neither replaces the other, which is the point.

---

## Part 1 — ServiceNow (do this first)

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

## Part 2 — Your Mac

### 1. Store your credentials

```bash
cd backup
./setup_keychain.sh
```

Asks for your instance, username and password, and puts them in the **macOS Keychain**. Nothing is written to any file, the password prompt doesn't echo, and neither the password nor the session token ever reaches a log.

### 2. Try it once, by hand

```bash
./pfmt_backup.sh
```

You should get:

```
~/Documents/PFMT_Backups/2026-08-17/
    accounts.csv
    transactions.csv
    budgets.csv
    goals.csv
    full_backup.json
```

`full_backup.json` is the restore file — it holds every field including `transferGroup`, which is what pairs the two legs of a transfer. The CSVs are for reading in a spreadsheet.

### 3. Make it weekly

```bash
./install_schedule.sh
```

Installs a launchd agent that runs every **Sunday at 09:00**. If your Mac is asleep at that moment the run happens on the next wake, so a closed lid delays the week's backup rather than skipping it.

```bash
launchctl list | grep pfmt          # confirm it's registered
./install_schedule.sh --remove      # stop the schedule (keeps existing backups)
```

Keeps the last **12** runs. Override either setting:

```bash
export PFMT_BACKUP_DIR="$HOME/Dropbox/PFMT_Backups"   # somewhere else
export PFMT_KEEP_RUNS=26                              # keep half a year
```

Set them in `~/.zshrc` so the scheduled run sees them too.

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
| Table error in the SN log | The `x_887486_0_backup` table hasn't been created — see Part 1 |
