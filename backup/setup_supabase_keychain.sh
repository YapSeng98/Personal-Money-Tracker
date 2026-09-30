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

# The prompt doesn't echo, so pasting twice is easy and invisible — and two
# keys glued together is just an "Invalid API key" at the first backup.
N=$(printf '%s' "$KEY" | grep -o 'sb_secret_' | wc -l | tr -d ' ')
if [ "${N:-0}" -gt 1 ]; then
  echo "That looks like the key pasted $N times. Run this again and paste it once."; exit 1
fi

# Try it before storing it, so a wrong key fails here rather than on Sunday.
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $KEY" \
  "https://oqsqfrpblinvsizitmgl.supabase.co/rest/v1/accounts?select=id&limit=1")
if [ "$CODE" != "200" ]; then
  echo "Supabase rejected that key (HTTP $CODE). Copy the secret key again and re-run."; exit 1
fi
echo "  key works"

security add-generic-password -U -s "$SERVICE" -a service_role -w "$KEY" >/dev/null \
  && echo "  stored in the login Keychain as '$SERVICE'" \
  || { echo "  FAILED to store the key"; exit 1; }

echo
echo "Next: ./supabase_backup.py      (take one now)"
echo "      ./install_schedule.sh     (weekly, Sunday 09:00)"
