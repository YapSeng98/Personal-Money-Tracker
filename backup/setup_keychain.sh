#!/bin/bash
# ============================================================
# Store PFMT credentials in the macOS Keychain.
# Run this once before the first backup.
#
# Nothing is written to disk or logged — the values go straight into the
# Keychain, and the password prompt does not echo. Re-run any time to update.
# ============================================================

set -uo pipefail
SERVICE="pfmt-backup"

echo "PFMT backup — Keychain setup"
echo "These are stored in your login Keychain, not in any file."
echo

read -r -p "ServiceNow instance (e.g. dev405150.service-now.com): " INSTANCE
[ -n "$INSTANCE" ] || { echo "Instance is required."; exit 1; }

read -r -p "PFMT username: " USERNAME
[ -n "$USERNAME" ] || { echo "Username is required."; exit 1; }

read -r -s -p "PFMT password: " PASSWORD; echo
[ -n "$PASSWORD" ] || { echo "Password is required."; exit 1; }

put() { # $1 account, $2 value
  security add-generic-password -U -s "$SERVICE" -a "$1" -w "$2" >/dev/null \
    && echo "  stored $1" \
    || { echo "  FAILED to store $1"; exit 1; }
}

put instance "$INSTANCE"
put username "$USERNAME"
put password "$PASSWORD"

unset PASSWORD

echo
echo "Done. Test it now with:  ./pfmt_backup.sh"
echo "To remove later:         security delete-generic-password -s $SERVICE"
