#!/bin/bash
# ============================================================
# PFMT — pull a full backup from ServiceNow into a local folder
#
# Writes one dated folder per run:
#   ~/Documents/PFMT_Backups/2026-08-17/
#       accounts.csv  transactions.csv  budgets.csv  goals.csv
#       full_backup.json
#
# Credentials are read from the macOS Keychain — never stored in this file.
# Run ./setup_keychain.sh once before the first backup.
#
# Manual run:   ./pfmt_backup.sh
# Weekly run:   see com.pfmt.weeklybackup.plist
# ============================================================

set -uo pipefail

BACKUP_ROOT="${PFMT_BACKUP_DIR:-$HOME/Documents/PFMT_Backups}"
KEEP_RUNS="${PFMT_KEEP_RUNS:-12}"
SERVICE="pfmt-backup"
LOG_DIR="$BACKUP_ROOT/.logs"

mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/backup_$(date +%Y-%m-%d).log"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }
die() { log "ERROR: $*"; exit 1; }

# ── credentials from Keychain ──────────────────────────────
kc() { security find-generic-password -s "$SERVICE" -a "$1" -w 2>/dev/null; }

INSTANCE=$(kc instance)
USERNAME=$(kc username)
PASSWORD=$(kc password)

[ -n "$INSTANCE" ] || die "no credentials in Keychain — run ./setup_keychain.sh first"
[ -n "$USERNAME" ] || die "username missing from Keychain — re-run ./setup_keychain.sh"
[ -n "$PASSWORD" ] || die "password missing from Keychain — re-run ./setup_keychain.sh"

INSTANCE="${INSTANCE#https://}"; INSTANCE="${INSTANCE%/}"
BASE="https://$INSTANCE/api/x_887486_0/pfmt"

command -v python3 >/dev/null || die "python3 not found (needed to parse JSON)"

log "Backing up from $INSTANCE as $USERNAME"

# ── log in ─────────────────────────────────────────────────
LOGIN_BODY=$(python3 -c '
import json,sys
print(json.dumps({"username":sys.argv[1],"password":sys.argv[2],"device":"mac-weekly-backup"}))' \
  "$USERNAME" "$PASSWORD")

LOGIN_RES=$(curl -sS --max-time 60 -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' -d "$LOGIN_BODY" 2>>"$LOG")

TOKEN=$(printf '%s' "$LOGIN_RES" | python3 -c '
import json,sys
try:
    d=json.load(sys.stdin)
except Exception:
    sys.exit(0)
# ServiceNow double-nests: {"result":{"result":{...}}}
while isinstance(d,dict) and "result" in d:
    d=d["result"]
print((d or {}).get("token","") if isinstance(d,dict) else "")')

[ -n "$TOKEN" ] || die "login failed — check the credentials in Keychain (response: $(printf '%s' "$LOGIN_RES" | head -c 200))"
log "Authenticated."

# ── fetch each dataset ─────────────────────────────────────
STAMP=$(date +%Y-%m-%d)
DEST="$BACKUP_ROOT/$STAMP"
TMP=$(mktemp -d) || die "cannot create temp dir"
trap 'rm -rf "$TMP"' EXIT

fetch() { # $1 = endpoint path
  curl -sS --max-time 120 "$BASE/$1" \
    -H "X-PFMT-Token: $TOKEN" -H 'X-HTTP-Method: GET' -H 'Accept: application/json' 2>>"$LOG"
}

for ep in accounts transactions budgets goals; do
  fetch "$ep" > "$TMP/$ep.json" || die "request for $ep failed"
  if [ ! -s "$TMP/$ep.json" ]; then die "empty response for $ep"; fi
done

# ── convert to CSV + one combined JSON, and verify before publishing ──
python3 - "$TMP" "$STAMP" <<'PY' || die "backup did not pass its own checks — nothing written"
import csv, json, os, sys

tmp, stamp = sys.argv[1], sys.argv[2]

def unwrap(v):
    # ServiceNow nests results; peel until we reach the payload.
    while isinstance(v, dict) and "result" in v:
        v = v["result"]
    if isinstance(v, dict):
        for k in ("records", "data", "items"):
            if isinstance(v.get(k), list):
                return v[k]
        return []
    return v if isinstance(v, list) else []

data, counts = {}, {}
for name in ("accounts", "transactions", "budgets", "goals"):
    with open(os.path.join(tmp, name + ".json")) as fh:
        rows = unwrap(json.load(fh))
    data[name] = rows
    counts[name] = len(rows)

total = sum(counts.values())
if total == 0:
    # Never overwrite a good backup history with an empty one — an auth or
    # network failure that still returns 200 would otherwise look like
    # "the user deleted everything".
    sys.stderr.write("refusing to write an empty backup (0 records across all datasets)\n")
    sys.exit(1)

for name, rows in data.items():
    path = os.path.join(tmp, name + ".csv")
    if not rows:
        open(path, "w").close()
        continue
    cols = []
    for r in rows:                       # union of keys, first-seen order
        for k in r:
            if k not in cols:
                cols.append(k)
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in cols})

with open(os.path.join(tmp, "full_backup.json"), "w") as fh:
    json.dump({"exportedOn": stamp, "counts": counts, **data}, fh, indent=2)

print("  ".join(f"{k}={v}" for k, v in counts.items()) + f"  total={total}")
PY

# ── publish atomically: a half-written folder is never left behind ──
mkdir -p "$BACKUP_ROOT"
rm -rf "$DEST.partial"
mkdir -p "$DEST.partial"
cp "$TMP"/*.csv "$TMP/full_backup.json" "$DEST.partial/" || die "could not stage backup files"
rm -rf "$DEST"
mv "$DEST.partial" "$DEST" || die "could not publish backup folder"

SIZE=$(du -sh "$DEST" | cut -f1)
log "Wrote $DEST ($SIZE)"

# ── retention: keep the most recent runs ───────────────────
cd "$BACKUP_ROOT" || exit 0
COUNT=$(ls -1d 20*-*-*/ 2>/dev/null | wc -l | tr -d ' ')
if [ "$COUNT" -gt "$KEEP_RUNS" ]; then
  ls -1d 20*-*-*/ | sort | head -n $((COUNT - KEEP_RUNS)) | while read -r old; do
    rm -rf "$old" && log "Pruned old backup $old"
  done
fi

# keep the log directory tidy too
find "$LOG_DIR" -name 'backup_*.log' -mtime +90 -delete 2>/dev/null

log "Done."
