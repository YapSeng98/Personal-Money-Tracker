#!/bin/bash
# ============================================================
# Store the Supabase service-role key in the macOS Keychain.
# Run this once before the first backup; re-run to replace the key.
#
# Find the key at Supabase dashboard → Project Settings → API Keys →
# the secret / service_role key. It reads every user's rows, so it goes
# only into the Keychain: the prompt does not echo and nothing is logged.
# ============================================================

set -uo pipefail
SERVICE="pfmt-supabase-backup"

echo "PFMT Supabase backup — Keychain setup"
echo "Dashboard: https://supabase.com/dashboard/project/oqsqfrpblinvsizitmgl/settings/api-keys"
echo

read -r -s -p "Service-role (secret) key: " KEY; echo
[ -n "$KEY" ] || { echo "A key is required."; exit 1; }
case "$KEY" in
  sb_publishable_*) echo "That is the publishable key — it can only see signed-in users' own rows. Use the secret one."; exit 1 ;;
esac

security add-generic-password -U -s "$SERVICE" -a service_role -w "$KEY" >/dev/null \
  && echo "  stored in the login Keychain as '$SERVICE'" \
  || { echo "  FAILED to store the key"; exit 1; }

echo
echo "Next: ./supabase_backup.py      (take one now)"
echo "      ./install_schedule.sh     (weekly, Sunday 09:00)"
