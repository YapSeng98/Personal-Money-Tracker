-- PFMT migration 005 — a record of every backup a user takes, and the link
-- from an auto-added recurring transaction back to its schedule.
--
-- The backup reminder used to know only about backups taken in the same
-- browser: the date lived in localStorage. A backup on the laptop still nagged
-- on the phone, and clearing site data made the app say "never". One row per
-- backup, on the account, fixes both and shows what each file held.
--
-- Additive only, safe to run against a live book, and safe to run twice.
-- Run it in the Supabase dashboard → SQL Editor, against project
-- oqsqfrpblinvsizitmgl.

create table if not exists public.backups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  taken_at timestamptz not null default now(),
  file_name text not null default '',
  -- Row counts the file held, e.g. {"transactions": 312, "accounts": 10, ...}
  counts jsonb not null default '{}'::jsonb,
  -- Which browser/device took it — enough to tell "laptop" from "phone".
  device text not null default ''
);
create index if not exists backups_user_taken_idx on public.backups(user_id, taken_at desc);
alter table public.backups enable row level security;

-- A log: the owner can add to it and read it, never rewrite it.
drop policy if exists backups_select_own on public.backups;
drop policy if exists backups_insert_own on public.backups;
create policy backups_select_own on public.backups for select to authenticated using (auth.uid() = user_id);
create policy backups_insert_own on public.backups for insert to authenticated with check (auth.uid() = user_id);
revoke all on table public.backups from anon;

-- ═══════════════════════════════════════════════════════════════════
-- RECURRING TRANSACTIONS
--
-- A row with is_recurring = true is a schedule; each occurrence the app adds
-- for it carries recurring_source = that row's id. The tag is what keeps an
-- auto-added row from marking a bill as paid, and what the 🔁 AUTO badge reads.
-- If the schedule row is deleted, the rows it already added stay — they are
-- real history, and still count as auto-added. No foreign key, so this runs
-- whatever type the original id column was created with.
-- ═══════════════════════════════════════════════════════════════════
alter table public.transactions
  add column if not exists recurring_source uuid;

-- Switching a schedule off writes null here; make sure both columns take it.
alter table public.transactions alter column recurring_frequency drop not null;
alter table public.transactions alter column next_run_date drop not null;
