# PFMT Backup — Setup Steps

For the **system owner**: a complete backup of every user's data, weekly, automatically.

There are three ways to get one. Do **Method A** — it needs no credentials stored anywhere and nothing installed on any machine.

---

## Before anything: take a backup right now

You currently have none. This takes one click and removes the risk while you set up the automation.

1. Open the app
2. Click **⬇ SN JSON** in the top bar
3. A file lands in `~/Downloads/pfmt_sn_export_all_<date>.json`

That is a complete restore point for **your own account**. It does not include other users — for that, continue below.

---

# Method A — Emailed system backup *(recommended)*

Runs inside ServiceNow with system rights, so it already sees every user. No password stored anywhere, nothing installed on your Mac, no new table.

### Step 1 — Check ServiceNow can send email

**Personal Developer Instances have outbound email switched off by default.** If it is off, the job runs, reports success, and delivers nothing.

1. In ServiceNow, navigate to **System Properties → Email**
   *(or type `email_properties.do` in the filter navigator)*
2. Confirm **Email sending enabled** is ticked
3. Under **Outbound Email Configuration**, the SMTP account should show as connected
4. If sending was off, tick it and **Save**

> If you cannot enable email, skip to **Method B**.

### Step 2 — Put your address in the script

Open `SCHED_SystemBackupEmail.js` and edit the setting near the top:

```js
var OWNER_EMAIL     = 'you@example.com';   // was ''
var INCLUDE_SECRETS = false;               // leave false
```

`INCLUDE_SECRETS` controls whether password hashes and AI API keys are written into the backup. Leave it `false` unless you specifically need a disaster-recovery copy — a leaked file of password hashes is far more expensive to deal with than reissuing a login.

### Step 3 — Create the scheduled job

**System Definition → Scheduled Jobs → New**, then choose **"Automatically run a script of your choosing"**.

| Field | Value |
|---|---|
| Name | `PFMT System Backup Email` |
| Active | ✔ ticked |
| Run | `Weekly` |
| Day | `Sunday` |
| Time | `02:00:00` |
| Script | paste the **entire** contents of `SCHED_SystemBackupEmail.js` |

**Submit.**

> Pushing to GitHub does **not** update ServiceNow. Pasting is the only way the script gets there — and the only way any later change to it does.

### Step 4 — Test it immediately

Open the job you just created and click **Execute Now**. Then check all three:

1. **System Logs → All**, filter the message on `PFMT System Backup`. You want:
   ```
   PFMT System Backup 2026-08-20: 1511 rows across 2 user(s) sent to you@example.com [secrets redacted]
   ```
2. **System Mailboxes → Outbound → Sent** — the message with two attachments
3. Your inbox

### What arrives, every week

```
Subject: PFMT System Backup — 2026-08-20 (1511 rows, 2 users)

  ycs:   2 accounts, 1500 transactions, 1 budgets, 0 goals
  wendy: 1 accounts, 3 transactions, 0 budgets, 1 goals

Attached:
  pfmt_system_2026-08-20.json    ← the restore file: every table, every user
  pfmt_system_transactions_2026-08-20.csv
```

The per-user breakdown in the body is your proof it captured everybody, not just one account.

---

# Method B — System backup to a folder on your Mac

Use this if email cannot be enabled, or you want the files on your own disk. Reads the ServiceNow tables directly, so it still covers every user — but it needs a ServiceNow login stored in your Keychain.

### Step 1 — Store the credentials

```bash
cd /Users/ycs/Downloads/PFMT_ServiceNow/backup
./setup_admin_keychain.sh
```

You will be asked for three things:

| Prompt | What to enter |
|---|---|
| ServiceNow instance | e.g. `dev405150.service-now.com` |
| ServiceNow username | an account that can **read** the `x_887486_0_*` tables |
| ServiceNow password | will not echo as you type — that is normal |

They go straight into the macOS Keychain. Nothing is written to any file, and neither the password nor any session token ever reaches a log.

> This must be run in a real terminal — Terminal.app, iTerm, or VS Code's integrated terminal (`` Ctrl+` ``). It cannot be run from a chat session, because the password prompt needs a keyboard.

### Step 2 — Install the weekly run

```bash
./install_schedule.sh --admin
```

This registers a launchd agent **and runs one backup immediately**, so a broken setup shows up in seconds rather than next Sunday:

```
Installed: admin backup every Sunday 09:00 (com.pfmt.systembackup)
Running it once now to check the setup...
  ✅ wrote /Users/ycs/Documents/PFMT_System_Backups/2026-08-20/
```

### Step 3 — Confirm what you got

```bash
cat ~/Documents/PFMT_System_Backups/2026-08-20/manifest.json
```

`perUser` lists every user and their row counts — that is the proof it captured everyone.

### Checking on it later

```bash
launchctl list | grep pfmt                              # is it scheduled?
ls ~/Documents/PFMT_System_Backups/                     # dated folders
tail ~/Documents/PFMT_System_Backups/.logs/*.log        # what the last run did
./install_schedule.sh --admin --remove                  # stop it
```

Keeps the last 12 runs. Change with `export PFMT_KEEP_RUNS=26` in `~/.zshrc`.

---

# Method C — Personal backup *(your account only)*

Only backs up the account you log in as. Documented in `backup/README.md`. **Not sufficient for a system owner** — the PFMT REST API resolves your token to one profile and filters every query on it, so it cannot return anyone else's records regardless of credentials.

---

## Why not just use the app's API for everything?

Every PFMT endpoint does this:

```js
var profileSysId = helper.validateToken(token);   // token → exactly one profile
gr.addQuery('user_profile', profileSysId);        // every query filtered to it
```

There is no parameter that widens it, and that is correct — one user's token must never return another's finances. It does mean a system-wide backup has to come from either inside ServiceNow (Method A) or the Table API (Method B).

---

## What the backups refuse to do

Both stored backups fail loudly rather than writing something misleading:

- **An empty result never overwrites good history.** If every table returns zero rows — an expired session, a fault that still returns `200` — it exits non-zero and leaves the previous backup alone. Otherwise a transient failure would look identical to "everything was deleted".
- **A truncated result is refused.** The transactions endpoint caps at 500 rows unless asked otherwise; if a dataset comes back exactly on the requested limit, the backup stops rather than quietly replacing a complete copy with a partial one.
- **Folders are published atomically.** Files are staged and then moved, so an interrupted run cannot leave a half-written backup that looks valid.
- **Secrets are redacted by default** — password hashes, API keys and session tokens.

---

## Restoring

`pfmt_system_<date>.json` holds everything. Order matters, because rows reference each other by name:

1. `user_profile`
2. `category`
3. `account`
4. `transaction` — **keep `transfer_group` intact**, or paired transfers and asset purchases restore as unrelated rows and the balances stop reconciling
5. `budget` and `savings_goal`

The `transfer_group` prefix tells you which kind of pair each is: `tg_` a transfer, `ag_` an asset purchase.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| No log line after **Execute Now** | Job is not Active, or the script was pasted into the wrong scope |
| `no recipient` in the log | `OWNER_EMAIL` is still blank in the script |
| Log says sent, nothing arrives | Email sending disabled — see Method A Step 1 |
| `nothing to back up` | The job found zero rows; check the scope is `x_887486_0` |
| `no credentials in Keychain` | `setup_admin_keychain.sh` has not been run |
| `refused the request … HTTP 403` | That ServiceNow account cannot read the table named in the message |
| `refusing to write an empty backup` | Working as intended — the instance was unreachable or returned nothing |
| Scheduled Mac run never fires | `launchctl list \| grep pfmt`; if absent, re-run `install_schedule.sh --admin` |
