#!/usr/bin/python3
# ============================================================
# PFMT system backup — every user's rows, straight from Supabase.
#
#   ./setup_supabase_keychain.sh     once: stores the service-role key
#   ./supabase_backup.py             take one now
#   ./install_schedule.sh            weekly, Sunday 09:00
#
# Writes ~/Documents/PFMT_Backups/<date>/<table>.json plus manifest.json.
# Override the folder with PFMT_BACKUP_DIR and how many runs to keep with
# PFMT_KEEP_RUNS (default 12).
#
# Uses the service-role key because it is the only key that reads past row-level
# security, which is what lets one run see every user. The key lives only in the
# macOS Keychain; it is never written to a file or a log.
# ============================================================

import datetime
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

SUPABASE_URL = 'https://oqsqfrpblinvsizitmgl.supabase.co'
KC_SERVICE   = 'pfmt-supabase-backup'
KC_ACCOUNT   = 'service_role'
TABLES       = ['accounts', 'transactions', 'budgets', 'goals', 'bills',
                'preferences', 'notifications_sent']
PAGE         = 1000
# Columns that authenticate as someone. A backup gets copied to places a
# credential should never follow, so these are blanked like the app export does.
REDACT       = {'preferences': ['ai_api_key']}

BACKUP_DIR = os.path.expanduser(os.environ.get('PFMT_BACKUP_DIR', '~/Documents/PFMT_Backups'))
KEEP_RUNS  = int(os.environ.get('PFMT_KEEP_RUNS', '12'))


def log(msg):
    print(f'[{datetime.datetime.now():%H:%M:%S}] {msg}', flush=True)


def fail(msg):
    log('ERROR: ' + msg)
    sys.exit(1)


def service_key():
    r = subprocess.run(['security', 'find-generic-password', '-s', KC_SERVICE, '-a', KC_ACCOUNT, '-w'],
                       capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        fail('no service-role key in the Keychain — run ./setup_supabase_keychain.sh first')
    return r.stdout.strip()


def get(key, table, params):
    headers = {'apikey': key, 'Prefer': 'count=exact'}
    # A legacy service_role key is a JWT and must also go in Authorization; the
    # newer sb_secret_ keys are rejected there and only belong in apikey.
    if key.startswith('eyJ'):
        headers['Authorization'] = 'Bearer ' + key
    url = f'{SUPABASE_URL}/rest/v1/{table}?' + urllib.parse.urlencode(params)
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as r:
        total = r.headers.get('Content-Range', '*/*').split('/')[-1]
        return json.load(r), (int(total) if total.isdigit() else None)


def fetch_table(key, table):
    # Order by id so pages can't overlap or skip; a table without an id column
    # (notifications_sent) is read in insertion order and checked by count.
    order = [('order', 'id')]
    rows, total = [], None
    while True:
        params = [('select', '*')] + order + [('limit', PAGE), ('offset', len(rows))]
        try:
            page, total = get(key, table, params)
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors='replace')[:300]
            if e.code == 400 and order and 'id' in body:
                order = []
                continue
            if e.code == 404:
                log(f'  {table}: table not found — skipped')
                return None
            if e.code in (401, 403):
                fail(f'Supabase refused {table} (HTTP {e.code}) — the key is wrong or not the service-role key')
            fail(f'{table}: HTTP {e.code} {body}')
        except urllib.error.URLError as e:
            fail(f'could not reach Supabase: {e.reason}')
        if not page:
            break
        rows.extend(page)
    if total is not None and total != len(rows):
        fail(f'{table}: read {len(rows)} rows but Supabase reports {total} — refusing a partial copy')
    for col in REDACT.get(table, []):
        for row in rows:
            if row.get(col):
                row[col] = '__REDACTED__'
    return rows


def main():
    key = service_key()
    today = datetime.date.today().isoformat()
    final = os.path.join(BACKUP_DIR, today)
    stage = final + '.partial'
    shutil.rmtree(stage, ignore_errors=True)
    os.makedirs(stage)

    counts, per_user = {}, {}
    for table in TABLES:
        rows = fetch_table(key, table)
        if rows is None:
            continue
        with open(os.path.join(stage, table + '.json'), 'w') as f:
            json.dump(rows, f, indent=1, ensure_ascii=False)
        counts[table] = len(rows)
        for row in rows:
            uid = row.get('user_id')
            if uid:
                per_user.setdefault(uid, {}).setdefault(table, 0)
                per_user[uid][table] += 1
        log(f'  {table}: {len(rows)} rows')

    # An expired key or a network fault that still answers 200 looks exactly
    # like "everything was deleted". Never let that replace a good backup.
    if not counts.get('transactions'):
        shutil.rmtree(stage, ignore_errors=True)
        fail('no transactions came back — refusing to write an empty backup; previous ones are untouched')

    with open(os.path.join(stage, 'manifest.json'), 'w') as f:
        json.dump({'exported_on': today, 'source': SUPABASE_URL, 'tables': counts,
                   'total_rows': sum(counts.values()), 'per_user': per_user,
                   'redacted_fields': [f'{t}.{c}' for t, cols in REDACT.items() for c in cols]},
                  f, indent=2)

    # Publish the folder only once it is whole, so an interrupted run can never
    # leave something that looks like a finished backup.
    shutil.rmtree(final, ignore_errors=True)
    os.rename(stage, final)
    log(f'✅ wrote {final} — {sum(counts.values())} rows, {len(per_user)} users')

    runs = sorted(d for d in os.listdir(BACKUP_DIR)
                  if len(d) == 10 and d[4] == '-' and os.path.isdir(os.path.join(BACKUP_DIR, d)))
    for old in runs[:-KEEP_RUNS] if KEEP_RUNS > 0 else []:
        shutil.rmtree(os.path.join(BACKUP_DIR, old))
        log(f'  pruned {old}')


if __name__ == '__main__':
    main()
