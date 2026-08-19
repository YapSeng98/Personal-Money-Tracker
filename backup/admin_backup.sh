#!/bin/bash
# ============================================================
# PFMT — system-owner backup: every table, every user, one folder
#
# Reads the application tables directly through ServiceNow's Table API, so it
# captures all users' data rather than one account's. The per-user backup
# (pfmt_backup.sh) authenticates as a single PFMT user and only ever sees that
# user's records — this one is the whole system.
#
#   ~/Documents/PFMT_System_Backups/2026-08-19/
#       user_profile.json  account.json  transaction.json
#       budget.json  savings_goal.json  category.json
#       manifest.json          <- row counts, per-user totals, what was skipped
#
# Credentials come from the macOS Keychain — run ./setup_admin_keychain.sh once.
# Needs a ServiceNow account that can read the x_887486_0_* tables.
#
#   ./admin_backup.sh                    redacts secrets (default)
#   ./admin_backup.sh --include-secrets  keeps password hashes and API keys
# ============================================================

set -uo pipefail

BACKUP_ROOT="${PFMT_ADMIN_BACKUP_DIR:-$HOME/Documents/PFMT_System_Backups}"
KEEP_RUNS="${PFMT_KEEP_RUNS:-12}"
SERVICE="pfmt-admin-backup"
PAGE=1000
LOG_DIR="$BACKUP_ROOT/.logs"

INCLUDE_SECRETS=0
[ "${1:-}" = "--include-secrets" ] && INCLUDE_SECRETS=1

mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/admin_backup_$(date +%Y-%m-%d).log"
log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }
die() { log "ERROR: $*"; exit 1; }

kc() { security find-generic-password -s "$SERVICE" -a "$1" -w 2>/dev/null; }
INSTANCE=$(kc instance); USERNAME=$(kc username); PASSWORD=$(kc password)
[ -n "$INSTANCE" ] || die "no admin credentials in Keychain — run ./setup_admin_keychain.sh first"
[ -n "$USERNAME" ] || die "admin username missing — re-run ./setup_admin_keychain.sh"
[ -n "$PASSWORD" ] || die "admin password missing — re-run ./setup_admin_keychain.sh"

INSTANCE="${INSTANCE#https://}"; INSTANCE="${INSTANCE%/}"
BASE="https://$INSTANCE/api/now/table"
command -v python3 >/dev/null || die "python3 not found (needed to parse JSON)"

# x_887486_0_session holds live auth tokens and is rebuilt on login, so backing
# it up would archive credentials for no restore benefit. x_887486_0_backup
# holds copies of the other tables and would nest backups inside backups.
TABLES="user_profile account transaction budget savings_goal category"

log "System backup from $INSTANCE as $USERNAME"
[ $INCLUDE_SECRETS -eq 1 ] && log "WARNING: --include-secrets — password hashes and API keys will be written to disk"

STAMP=$(date +%Y-%m-%d)
DEST="$BACKUP_ROOT/$STAMP"
TMP=$(mktemp -d) || die "cannot create temp dir"
trap 'rm -rf "$TMP"' EXIT

# ── page through a table until fewer than PAGE rows come back ──
fetch_table() {
  local table="$1" offset=0 total=0 page_file batch
  : > "$TMP/$table.ndjson"
  while : ; do
    page_file="$TMP/.page.json"
    local code
    code=$(curl -sS --max-time 180 -u "$USERNAME:$PASSWORD" \
      -H 'Accept: application/json' -o "$page_file" -w '%{http_code}' \
      "$BASE/x_887486_0_$table?sysparm_limit=$PAGE&sysparm_offset=$offset&sysparm_exclude_reference_link=true&sysparm_display_value=all" 2>>"$LOG")

    if [ "$code" = "401" ] || [ "$code" = "403" ]; then
      die "ServiceNow refused the request for $table (HTTP $code) — check the account can read x_887486_0_$table"
    fi
    if [ "$code" = "404" ]; then
      log "  $table: table not present on this instance, skipping"
      echo "SKIPPED" > "$TMP/$table.skipped"
      return 0
    fi
    [ "$code" = "200" ] || die "unexpected HTTP $code fetching $table"

    batch=$(python3 -c '
import json,sys
try:
    d=json.load(open(sys.argv[1]))
except Exception as e:
    sys.stderr.write("bad JSON: %s\n"%e); sys.exit(1)
rows=d.get("result",[])
with open(sys.argv[2],"a") as fh:
    for r in rows: fh.write(json.dumps(r)+"\n")
print(len(rows))' "$page_file" "$TMP/$table.ndjson") || die "could not parse the $table response"

    total=$((total+batch))
    [ "$batch" -lt "$PAGE" ] && break
    offset=$((offset+PAGE))
  done
  log "  $table: $total rows"
  echo "$total" > "$TMP/$table.count"
}

for t in $TABLES; do fetch_table "$t"; done

# ── shape it, redact by default, and refuse to publish an empty backup ──
python3 - "$TMP" "$STAMP" "$INCLUDE_SECRETS" "$TABLES" <<'PY' || die "backup did not pass its own checks — nothing written"
import json, os, sys

tmp, stamp, keep_secrets, tables = sys.argv[1], sys.argv[2], sys.argv[3] == "1", sys.argv[4].split()
SECRET_FIELDS = {"password_hash", "ai_api_key", "token"}

def flatten(v):
    # sysparm_display_value=all returns {"value": .., "display_value": ..}
    if isinstance(v, dict) and "value" in v:
        dv = v.get("display_value")
        return v["value"] if dv in (None, "", v["value"]) else {"value": v["value"], "display": dv}
    return v

manifest = {"exportedOn": stamp, "tables": {}, "secretsIncluded": keep_secrets,
            "skipped": [], "redactedFields": sorted(SECRET_FIELDS) if not keep_secrets else []}
grand = 0
redacted = 0

for t in tables:
    if os.path.exists(os.path.join(tmp, t + ".skipped")):
        manifest["skipped"].append(t)
        manifest["tables"][t] = 0
        continue
    rows = []
    path = os.path.join(tmp, t + ".ndjson")
    if os.path.exists(path):
        with open(path) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                r = {k: flatten(v) for k, v in json.loads(line).items()}
                if not keep_secrets:
                    for f in SECRET_FIELDS:
                        if r.get(f) not in (None, ""):
                            r[f] = "__REDACTED__"
                            globals()['redacted'] = redacted = redacted + 1
                rows.append(r)
    with open(os.path.join(tmp, t + ".json"), "w") as fh:
        json.dump(rows, fh, indent=2)
    manifest["tables"][t] = len(rows)
    grand += len(rows)

# Per-user totals, so a system owner can see at a glance whose data is in here.
profiles = json.load(open(os.path.join(tmp, "user_profile.json"))) if manifest["tables"].get("user_profile") else []
def sid(r):
    v = r.get("sys_id")
    return v.get("value") if isinstance(v, dict) else v
def owner(r):
    v = r.get("user_profile")
    return v.get("value") if isinstance(v, dict) else v

by_user = {}
for p in profiles:
    by_user[sid(p)] = {"username": p.get("username") or "(unnamed)", "account": 0,
                       "transaction": 0, "budget": 0, "savings_goal": 0}
for t in ("account", "transaction", "budget", "savings_goal"):
    if not manifest["tables"].get(t):
        continue
    for r in json.load(open(os.path.join(tmp, t + ".json"))):
        u = owner(r)
        if u in by_user:
            by_user[u][t] += 1
manifest["perUser"] = list(by_user.values())
manifest["totalRows"] = grand

if grand == 0:
    # An auth or permission fault that still returns 200 would otherwise
    # overwrite a good backup with an empty one.
    sys.stderr.write("refusing to write an empty backup (0 rows across every table)\n")
    sys.exit(1)

with open(os.path.join(tmp, "manifest.json"), "w") as fh:
    json.dump(manifest, fh, indent=2)

print("  users=%d  total rows=%d%s" % (len(by_user), grand,
      ("  redacted=%d" % redacted) if redacted else ""))
PY

# ── publish atomically ──
mkdir -p "$BACKUP_ROOT"
rm -rf "$DEST.partial"; mkdir -p "$DEST.partial"
cp "$TMP"/*.json "$DEST.partial/" 2>/dev/null || die "could not stage backup files"
rm -f "$DEST.partial/.page.json"
rm -rf "$DEST"; mv "$DEST.partial" "$DEST" || die "could not publish backup folder"

log "Wrote $DEST ($(du -sh "$DEST" | cut -f1))"

cd "$BACKUP_ROOT" || exit 0
COUNT=$(ls -1d 20*-*-*/ 2>/dev/null | wc -l | tr -d ' ')
if [ "$COUNT" -gt "$KEEP_RUNS" ]; then
  ls -1d 20*-*-*/ | sort | head -n $((COUNT - KEEP_RUNS)) | while read -r old; do
    rm -rf "$old" && log "Pruned $old"
  done
fi
find "$LOG_DIR" -name 'admin_backup_*.log' -mtime +90 -delete 2>/dev/null
log "Done."
