-- PFMT migration 002 — monthly bills, and outbound alerts on Telegram.
--
-- Additive only: it creates two tables and adds four nullable-with-default
-- columns to preferences. Nothing existing is dropped or rewritten, so it is
-- safe to run against a live book, and safe to run twice.
--
-- Run it in the Supabase dashboard → SQL Editor, against project
-- oqsqfrpblinvsizitmgl.

-- ═══════════════════════════════════════════════════════════════════
-- BILLS — the standing monthly commitments
--
-- A bill is an *expectation*, never a record of payment. Whether this month's
-- bill is settled is worked out by matching it against the transactions table
-- at render time (see pfmtMatchBills in index.html), so there is deliberately
-- no `paid` column here: a stored flag is one more thing that can fall out of
-- step with the ledger, and the ledger is the truth.
-- ═══════════════════════════════════════════════════════════════════
create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  amount numeric not null default 0,
  currency text not null default 'SGD',
  category text not null default 'Bills',
  -- null means "any account" — the bill matches wherever it was paid from.
  account text,
  due_day int not null default 1 check (due_day between 1 and 31),
  -- Utilities and phone bills are never the same twice, so they match on
  -- category and account alone and their amount is only an estimate.
  amount_varies boolean not null default false,
  is_active boolean not null default true,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists bills_user_id_idx on public.bills(user_id);
alter table public.bills enable row level security;

drop policy if exists bills_select_own on public.bills;
drop policy if exists bills_insert_own on public.bills;
drop policy if exists bills_update_own on public.bills;
drop policy if exists bills_delete_own on public.bills;
create policy bills_select_own on public.bills for select using (auth.uid() = user_id);
create policy bills_insert_own on public.bills for insert with check (auth.uid() = user_id);
create policy bills_update_own on public.bills for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy bills_delete_own on public.bills for delete using (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════
-- NOTIFICATIONS_SENT — what has already been said
--
-- The primary key IS the de-duplication rule: one row per user, per kind, per
-- dedupe_key, and the key carries the month. So crossing a budget's threshold
-- sends one message for that month rather than one per expense afterwards, and
-- going over sends exactly one more.
-- ═══════════════════════════════════════════════════════════════════
create table if not exists public.notifications_sent (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  kind text not null check (kind in ('budget','bill','test')),
  dedupe_key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, dedupe_key)
);
alter table public.notifications_sent enable row level security;

-- Readable and clearable by the owner. The Edge Function writes these rows with
-- the service role, which bypasses RLS — the user's own access exists so the app
-- can show what was sent, and so re-sending can be forced by deleting a row.
drop policy if exists notifications_select_own on public.notifications_sent;
drop policy if exists notifications_delete_own on public.notifications_sent;
create policy notifications_select_own on public.notifications_sent for select using (auth.uid() = user_id);
create policy notifications_delete_own on public.notifications_sent for delete using (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════
-- PREFERENCES — where alerts go, and which ones
--
-- The chat id is an address, not a credential: on its own it lets nobody send
-- anything. The bot token is the secret, and it lives only in the Edge
-- Function's environment — never in this table, never in a backup, never on a
-- device.
-- ═══════════════════════════════════════════════════════════════════
alter table public.preferences
  add column if not exists telegram_chat_id text not null default '',
  add column if not exists notify_budget boolean not null default false,
  add column if not exists notify_bills boolean not null default false,
  add column if not exists bill_lead_days int not null default 3;

-- ═══════════════════════════════════════════════════════════════════
-- Verify
-- ═══════════════════════════════════════════════════════════════════
select 'bills' as table_name, count(*) as rows from public.bills
union all
select 'notifications_sent', count(*) from public.notifications_sent;
