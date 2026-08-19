#!/bin/bash
# ============================================================
# Install (or reinstall) the weekly PFMT backup as a launchd job.
# Safe to re-run — it unloads any previous copy first.
#
#   ./install_schedule.sh            install / reinstall
#   ./install_schedule.sh --remove   uninstall
# ============================================================

set -uo pipefail

LABEL="com.pfmt.weeklybackup"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/pfmt_backup.sh"
PLIST_SRC="$HERE/$LABEL.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="${PFMT_BACKUP_DIR:-$HOME/Documents/PFMT_Backups}/.logs"

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

if ! security find-generic-password -s pfmt-backup -a instance -w >/dev/null 2>&1; then
  echo "ERROR: no credentials in the Keychain yet."
  echo "Run ./setup_keychain.sh first."
  exit 1
fi

chmod +x "$SCRIPT" "$HERE/setup_keychain.sh" 2>/dev/null
mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

# Fill the placeholders with real absolute paths — launchd does not expand ~.
sed -e "s|__SCRIPT_PATH__|$SCRIPT|g" -e "s|__LOG_DIR__|$LOG_DIR|g" \
    "$PLIST_SRC" > "$PLIST_DEST" || { echo "ERROR: could not write $PLIST_DEST"; exit 1; }

unload
if launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST" 2>/dev/null \
   || launchctl load -w "$PLIST_DEST" 2>/dev/null; then
  echo "Installed: weekly backup every Sunday 09:00"
else
  echo "ERROR: launchctl refused to load $PLIST_DEST"
  exit 1
fi

echo "  script : $SCRIPT"
echo "  folder : ${PFMT_BACKUP_DIR:-$HOME/Documents/PFMT_Backups}"
echo "  logs   : $LOG_DIR"
echo

# Fire it once now through launchd itself, so a broken setup surfaces in
# seconds rather than next Sunday. Deliberately not RunAtLoad, which would
# repeat this on every login rather than only at install.
echo "Running it once now to check the setup..."
if launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null; then
  sleep 6
  LATEST=$(ls -1dt "${PFMT_BACKUP_DIR:-$HOME/Documents/PFMT_Backups}"/20*-*-*/ 2>/dev/null | head -1)
  if [ -n "$LATEST" ] && [ -s "$LATEST/full_backup.json" ]; then
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
echo "Remove the schedule:    ./install_schedule.sh --remove"
