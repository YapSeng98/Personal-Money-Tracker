#!/bin/bash
# ============================================================
# Install (or reinstall) the PFMT backup as a launchd job.
# Safe to re-run — it unloads any previous copy first.
#
#   ./install_schedule.sh                       weekly, Sunday 09:00
#   ./install_schedule.sh --monthly             monthly, 1st at 09:00
#   ./install_schedule.sh --to ~/Downloads/PFMT_Backups
#   ./install_schedule.sh --admin               every user, not just yours
#   ./install_schedule.sh --remove              uninstall
#
# Flags combine, e.g.
#   ./install_schedule.sh --monthly --to ~/Downloads/PFMT_Backups
# ============================================================

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --admin schedules the system-wide backup (every user, via the ServiceNow
# Table API) instead of the single-account one. They get separate labels and
# folders so both can be scheduled at once.
MODE="user"
PERIOD="weekly"
DEST_OVERRIDE=""
REMOVE="no"
while [ $# -gt 0 ]; do
  case "$1" in
    --admin)   MODE="admin" ;;
    --monthly) PERIOD="monthly" ;;
    --weekly)  PERIOD="weekly" ;;
    --remove)  REMOVE="yes" ;;
    --to)      shift; DEST_OVERRIDE="${1:-}"
               [ -n "$DEST_OVERRIDE" ] || { echo "ERROR: --to needs a folder"; exit 1; } ;;
    *)         echo "ERROR: unknown option '$1'"; exit 1 ;;
  esac
  shift
done

# The period is part of the label so a monthly job replaces the monthly one
# rather than silently colliding with a weekly job you still want.
if [ "$MODE" = "admin" ]; then
  SCRIPT="$HERE/admin_backup.sh"
  KC_SERVICE="pfmt-admin-backup"
  SETUP_HINT="./setup_admin_keychain.sh"
  ENV_KEY="PFMT_ADMIN_BACKUP_DIR"
  DEFAULT_DIR="$HOME/Documents/PFMT_System_Backups"
  [ "$PERIOD" = "monthly" ] && LABEL="com.pfmt.systembackup.monthly" || LABEL="com.pfmt.systembackup"
  BACKUP_DIR="${DEST_OVERRIDE:-${PFMT_ADMIN_BACKUP_DIR:-$DEFAULT_DIR}}"
else
  SCRIPT="$HERE/pfmt_backup.sh"
  KC_SERVICE="pfmt-backup"
  SETUP_HINT="./setup_keychain.sh"
  ENV_KEY="PFMT_BACKUP_DIR"
  DEFAULT_DIR="$HOME/Documents/PFMT_Backups"
  [ "$PERIOD" = "monthly" ] && LABEL="com.pfmt.monthlybackup" || LABEL="com.pfmt.weeklybackup"
  BACKUP_DIR="${DEST_OVERRIDE:-${PFMT_BACKUP_DIR:-$DEFAULT_DIR}}"
fi

# Expand a leading ~ and make it absolute — launchd does not expand either.
case "$BACKUP_DIR" in
  "~"|"~/"*) BACKUP_DIR="$HOME${BACKUP_DIR#\~}" ;;
esac
[ "${BACKUP_DIR#/}" != "$BACKUP_DIR" ] || BACKUP_DIR="$PWD/$BACKUP_DIR"

if [ "$PERIOD" = "monthly" ]; then
  PERIOD_KEY="Day";     PERIOD_VAL="1";  WHEN="the 1st of each month at 09:00"
else
  PERIOD_KEY="Weekday"; PERIOD_VAL="0";  WHEN="every Sunday 09:00"
fi

PLIST_SRC="$HERE/com.pfmt.weeklybackup.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$BACKUP_DIR/.logs"

unload() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null \
    || launchctl unload "$PLIST_DEST" 2>/dev/null
  return 0
}

if [ "$REMOVE" = "yes" ]; then
  if [ -f "$PLIST_DEST" ]; then
    unload
    rm -f "$PLIST_DEST"
    echo "Removed the $PERIOD backup schedule ($LABEL)."
    echo "Backups already written are untouched."
  else
    echo "Nothing to remove — no $PERIOD backup schedule is installed ($LABEL)."
  fi
  echo "To also forget the credentials: security delete-generic-password -s $KC_SERVICE"
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
# __BACKUP_DIR__ is what makes the destination actually apply: the job runs
# without your shell environment, so this is the only way it learns the folder.
sed -e "s|__SCRIPT_PATH__|$SCRIPT|g" -e "s|__LOG_DIR__|$LOG_DIR|g" \
    -e "s|__ENV_KEY__|$ENV_KEY|g" -e "s|__BACKUP_DIR__|$BACKUP_DIR|g" \
    -e "s|__PERIOD_KEY__|$PERIOD_KEY|g" -e "s|__PERIOD_VAL__|$PERIOD_VAL|g" \
    -e "s|com.pfmt.weeklybackup|$LABEL|g" \
    "$PLIST_SRC" > "$PLIST_DEST" || { echo "ERROR: could not write $PLIST_DEST"; exit 1; }

unload
if launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST" 2>/dev/null \
   || launchctl load -w "$PLIST_DEST" 2>/dev/null; then
  echo "Installed: ${MODE} backup ${WHEN} ($LABEL)"
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
REMOVE_HINT="./install_schedule.sh"
[ "$MODE"   = "admin"   ] && REMOVE_HINT="$REMOVE_HINT --admin"
[ "$PERIOD" = "monthly" ] && REMOVE_HINT="$REMOVE_HINT --monthly"
echo "Check it is scheduled:  launchctl list | grep pfmt"
echo "Remove the schedule:    $REMOVE_HINT --remove"
