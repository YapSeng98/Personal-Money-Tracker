# Telegram alerts — one-time setup

PFMT can message you when a budget crosses its alert threshold and when a bill is
coming due. This page covers the five steps, three of which only you can do
because they involve your Telegram account and a secret.

**Already done for you** — the `pfmt-notify` Edge Function is deployed, and the
`bills` / `notifications_sent` tables and the four `preferences` columns exist.
What's left is a bot, two secrets, your chat id, and the nightly schedule.

Total time: about ten minutes.

---

## Why Telegram and not WhatsApp

Telegram's Bot API is a single HTTPS POST, free, with no approval process — you
create a bot once and it can message you immediately.

WhatsApp's official API needs Meta business verification and pre-approved message
templates before it will send anything outside a sandbox. The unofficial route
(Twilio's WhatsApp sandbox) is free but makes you re-opt-in every 72 hours, which
is exactly the wrong property for something whose whole job is to reach you
without being asked.

If you later want WhatsApp anyway, only one function in `index.ts` changes —
`sendTelegram()`. Everything that decides *what* to say stays as it is.

---

## Step 1 — Create the bot (2 min)

1. Open Telegram and message **[@BotFather](https://t.me/BotFather)**.
2. Send `/newbot`.
3. Give it a name (shown in chats) — e.g. `PFMT`.
4. Give it a username, which must end in `bot` — e.g. `yc_pfmt_bot`.
5. BotFather replies with a token that looks like
   `1234567890:AAH...`. **That token is a password — treat it like one.**
   Anyone holding it can send messages as your bot.

Then **send your new bot any message** (just `hi`). Telegram does not let a bot
write to someone who has never written to it; skipping this is the single most
common reason the first test fails with `chat not found`.

## Step 2 — Find your chat id (1 min)

Message **[@userinfobot](https://t.me/userinfobot)** on Telegram. It replies with
your `Id` — a number like `123456789`.

This is an address, not a credential. On its own it lets nobody send you
anything; it only says where your alerts should go.

## Step 3 — Store the two secrets (3 min)

Open **[Edge Function secrets](https://supabase.com/dashboard/project/oqsqfrpblinvsizitmgl/functions/secrets)**
and add:

| Name | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | the token from Step 1 |
| `PFMT_CRON_SECRET` | any long random string you invent — see below |

For the cron secret, generate one in a terminal:

```bash
openssl rand -hex 32
```

Keep that value; Step 5 needs it. It is what lets the nightly schedule call the
function without a signed-in user, and nothing else.

> These live only in the Edge Function's environment. The app never receives
> them, they are not in the database, and they are not in your backups.

## Step 4 — Switch alerts on in the app (1 min)

In PFMT → **Settings → Alerts on Telegram**:

1. Paste your chat id, press **Save**.
2. Turn on **Budget threshold alerts** and/or **Bill reminders**.
3. Set how many days ahead you want bill reminders (default 3).
4. Press **Send test message**.

A message should arrive within a second or two. If it doesn't, see
Troubleshooting below.

**Budget alerts work from this point on** — the app calls the function itself
each time you record an expense, so a budget crossing its threshold reaches you
straight away. Only bill reminders need Step 5, because nobody is holding the app
open on the morning a bill falls due.

## Step 5 — Schedule the daily bill check (3 min)

In the **[SQL Editor](https://supabase.com/dashboard/project/oqsqfrpblinvsizitmgl/sql)**,
replace `PASTE_YOUR_CRON_SECRET_HERE` with the value from Step 3 and run:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'pfmt-daily-bill-check',
  '0 1 * * *',                          -- 01:00 UTC = 09:00 Singapore
  $$
  select net.http_post(
    url     := 'https://oqsqfrpblinvsizitmgl.supabase.co/functions/v1/pfmt-notify',
    headers := jsonb_build_object(
      'Content-Type',       'application/json',
      'x-pfmt-cron-secret', 'PASTE_YOUR_CRON_SECRET_HERE'
    ),
    body    := '{}'::jsonb
  );
  $$
);
```

Check it registered:

```sql
select jobid, jobname, schedule, active from cron.job;
```

To change the time, re-run `cron.schedule` with the same job name — it replaces
the existing one. To stop it: `select cron.unschedule('pfmt-daily-bill-check');`

> **On storing the secret in the job:** the line above puts the cron secret in the
> `cron.job` table, readable only by the `postgres` role. That is fine for a
> personal project. If you would rather it were encrypted, put it in Supabase
> Vault (`select vault.create_secret('...', 'pfmt_cron_secret');`) and replace the
> literal with
> `(select decrypted_secret from vault.decrypted_secrets where name = 'pfmt_cron_secret')`.

---

## What actually gets sent

One message per run, with everything pending in it — not one message per item:

```
PFMT — 2026-09
🟠 Food & Drink is at 86% — S$430.00 of S$500.00, S$70.00 left
🔴 Shopping is over budget — S$520.00 of S$200.00 (S$320.00 over)
📅 Singtel mobile S$42.90 — due in 2 days (2026-09-12)
🔴 Rent S$1,800.00 — 3 days late (2026-09-01)
```

**Each alert is sent at most once a month, per thing, per level.** A budget
notifies once when it crosses your alert threshold and once more if it goes over;
a bill notifies once as it approaches and once more if it actually goes unpaid.
Crossing a threshold does not produce a message for every expense after it.

That is enforced by the `notifications_sent` table, whose primary key *is* the
rule — so two runs overlapping cannot double-send. If you ever want to force a
re-send, delete the row:

```sql
delete from public.notifications_sent where dedupe_key like '%2026-09%';
```

---

## Troubleshooting

| What you see | What it means |
|---|---|
| `chat not found` | You never messaged the bot. Send it `hi` (Step 1) and retry. |
| `TELEGRAM_BOT_TOKEN is not set on this function` | Step 3 was skipped, or the secret name is misspelled. |
| `Unauthorized` / `401` | Your app session expired — sign out and back in. |
| Test works, but nothing arrives on its own | Budget alerts fire on saving an expense; bill reminders need the Step 5 schedule. Check `select * from cron.job;`. |
| Nothing at all, no error | Both toggles may be off, or nothing is actually pending. Press **Check my alerts now** in Settings — it says plainly when there's nothing to report. |

Function logs are at
**[Edge Functions → pfmt-notify → Logs](https://supabase.com/dashboard/project/oqsqfrpblinvsizitmgl/functions/pfmt-notify/logs)**.

---

## If you ever need to redeploy the function

The source is in `supabase/functions/pfmt-notify/`. Two files:

- `index.ts` — the request handling, the Telegram call, the de-duplication
- `shared-money-rules.js` — **generated**; the money maths, copied verbatim out of
  `index.html` by `node tools/sync-shared-rules.js`

Never edit `shared-money-rules.js` by hand. Edit the block in `index.html`, run
the sync tool, then run `node test/run-all.js` — one of the tests compares the two
copies character for character and fails if they have drifted.

With the Supabase CLI:

```bash
supabase functions deploy pfmt-notify --no-verify-jwt
```

Or paste both files into
**[Edge Functions → Deploy a new function → Via Editor](https://supabase.com/dashboard/project/oqsqfrpblinvsizitmgl/functions)**.

`--no-verify-jwt` is required: the nightly cron call carries no user token, it
authenticates with `x-pfmt-cron-secret` instead. The function still verifies the
user's JWT by hand on the path the app uses — see the `Deno.serve` block at the
bottom of `index.ts`. In the dashboard this is the **Verify JWT with legacy
secret** toggle, which must stay **off**.
