#!/bin/bash
# ============================================================
# Install (or reinstall) the weekly PFMT backup as a launchd job.
# Safe to re-run — it unloads any previous copy first.
#
#   ./install_schedule.sh            install / reinstall
#   ./install_schedule.sh --remove   uninstall
# ============================================================

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --admin schedules the system-wide backup (every user, via the ServiceNow
# Table API) instead of the single-account one. They get separate labels and
# folders so both can be scheduled at once.
MODE="user"
for a in "$@"; do [ "$a" = "--admin" ] && MODE="admin"; done

if [ "$MODE" = "admin" ]; then
  LABEL="com.pfmt.systembackup"
  SCRIPT="$HERE/admin_backup.sh"
  KC_SERVICE="pfmt-admin-backup"
  SETUP_HINT="./setup_admin_keychain.sh"
  BACKUP_DIR="${PFMT_ADMIN_BACKUP_DIR:-$HOME/Documents/PFMT_System_Backups}"
else
  LABEL="com.pfmt.weeklybackup"
  SCRIPT="$HERE/pfmt_backup.sh"
  KC_SERVICE="pfmt-backup"
  SETUP_HINT="./setup_keychain.sh"
  BACKUP_DIR="${PFMT_BACKUP_DIR:-$HOME/Documents/PFMT_Backups}"
fi

PLIST_SRC="$HERE/com.pfmt.weeklybackup.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$BACKUP_DIR/.logs"

unload() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null \
    || launchctl unload "$PLIST_DEST" 2>/dev/null
  return 0
}

if [ "${1:-}" = "--remove" ]; then
  if [ -f "$PLIST_DEST" ]; then
    unload
    rm -f "$PLIST_DEST"
    echo "Removed the weekly backup schedule."
    echo "Backups already written are untouched."
  else
    echo "Nothing to remove — no weekly backup schedule is installed."
  fi
  echo "To also forget the credentials: security delete-generic-password -s pfmt-backup"
  exit 0
fi

[ -f "$SCRIPT" ]    || { echo "ERROR: $SCRIPT not found"; exit 1; }
[ -f "$PLIST_SRC" ] || { echo "ERROR: $PLIST_SRC not found"; exit 1; }

if ! security find-generic-password -s "$KC_SERVICE" -a instance -w >/dev/null 2>&1; then
  echo "ERROR: no credentials in the Keychain for $KC_SERVICE."
  echo "Run $SETUP_HINT first."
  exit 1
fi

chmod +x "$SCRIPT" "$HERE"/setup_*.sh 2>/dev/null
mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

# Fill the placeholders with real absolute paths — launchd does not expand ~.
sed -e "s|__SCRIPT_PATH__|$SCRIPT|g" -e "s|__LOG_DIR__|$LOG_DIR|g" \
    -e "s|com.pfmt.weeklybackup|$LABEL|g" \
    "$PLIST_SRC" > "$PLIST_DEST" || { echo "ERROR: could not write $PLIST_DEST"; exit 1; }

unload
if launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST" 2>/dev/null \
   || launchctl load -w "$PLIST_DEST" 2>/dev/null; then
  echo "Installed: ${MODE} backup every Sunday 09:00 ($LABEL)"
else
  echo "ERROR: launchctl refused to load $PLIST_DEST"
  exit 1
fi

echo "  script : $SCRIPT"
echo "  folder : $BACKUP_DIR"
echo "  logs   : $LOG_DIR"
echo

# Fire it once now through launchd itself, so a broken setup surfaces in
# seconds rather than next Sunday. Deliberately not RunAtLoad, which would
# repeat this on every login rather than only at install.
echo "Running it once now to check the setup..."
if launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null; then
  sleep 6
  LATEST=$(ls -1dt "$BACKUP_DIR"/20*-*-*/ 2>/dev/null | head -1)
  if [ -n "$LATEST" ] && { [ -s "$LATEST/full_backup.json" ] || [ -s "$LATEST/manifest.json" ]; }; then
    echo "  ✅ wrote $LATEST"
  else
    echo "  ⚠️  no backup folder appeared yet — check the log:"
    echo "     tail $LOG_DIR/../.logs/backup_\$(date +%Y-%m-%d).log"
  fi
else
  echo "  (could not trigger a test run; try it by hand: $SCRIPT)"
fi

echo
echo "Check it is scheduled:  launchctl list | grep pfmt"
echo "Remove the schedule:    ./install_schedule.sh${MODE:+ --admin} --remove"
