#!/bin/bash
# ============================================================
# Store ServiceNow ADMIN credentials for the system-wide backup.
#
# These are separate from the per-user PFMT credentials on purpose: this
# account reads every user's records, so it is the more powerful secret and is
# kept under its own Keychain service.
#
# Needs a ServiceNow account that can read the x_887486_0_* tables.
# ============================================================

set -uo pipefail
SERVICE="pfmt-admin-backup"

echo "PFMT system backup — Keychain setup"
echo "Stored in your login Keychain, not in any file."
echo

read -r -p "ServiceNow instance (e.g. dev405150.service-now.com): " INSTANCE
[ -n "$INSTANCE" ] || { echo "Instance is required."; exit 1; }

read -r -p "ServiceNow username (needs read on x_887486_0_*): " USERNAME
[ -n "$USERNAME" ] || { echo "Username is required."; exit 1; }

read -r -s -p "ServiceNow password: " PASSWORD; echo
[ -n "$PASSWORD" ] || { echo "Password is required."; exit 1; }

put() {
  security add-generic-password -U -s "$SERVICE" -a "$1" -w "$2" >/dev/null \
    && echo "  stored $1" || { echo "  FAILED to store $1"; exit 1; }
}
put instance "$INSTANCE"
put username "$USERNAME"
put password "$PASSWORD"
unset PASSWORD

echo
echo "Done. Test it now with:  ./admin_backup.sh"
echo "To remove later:         security delete-generic-password -s $SERVICE"
