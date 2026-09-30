-- PFMT migration 004 — every row belongs to exactly one account, and only that
-- account can see or touch it.
--
-- The app filters every query by user_id, but that is a courtesy, not a lock:
-- the publishable key sits in index.html for anyone to read, so the database
-- itself has to refuse. Migration 002 did this for bills and notifications_sent;
-- the five original tables were set up by hand in the dashboard and their
-- policies were never written down. This writes them down, and makes them so.
--
-- Safe to run against a live book, and safe to run twice: it only enables RLS,
-- replaces the own-row policies, and withdraws access from signed-out callers.
-- No data is touched. The pfmt-notify Edge Function uses the service role,
-- which bypasses RLS, so the nightly alerts are unaffected.
--
-- Run it in the Supabase dashboard → SQL Editor, against project
-- oqsqfrpblinvsizitmgl.

do $$
declare
  t text;
begin
  foreach t in array array['transactions', 'accounts', 'budgets', 'goals',
                           'preferences', 'bills'] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);

    execute format('create policy %I on public.%I for select to authenticated using (auth.uid() = user_id)',
                   t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (auth.uid() = user_id)',
                   t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)',
                   t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (auth.uid() = user_id)',
                   t || '_delete_own', t);

    -- A signed-out caller has no rows of its own, so it gets no access at all.
    execute format('revoke all on table public.%I from anon', t);
  end loop;

  -- The app only reads and deletes these; the Edge Function writes them.
  alter table public.notifications_sent enable row level security;
  revoke all on table public.notifications_sent from anon;
end $$;

-- ═══════════════════════════════════════════════════════════════════
-- CHECK — run after the block above.
--
-- 1. Every table in public must show rowsecurity = true.
-- 2. Any policy NOT named *_own is one somebody added by hand in the
--    dashboard. An old "allow all" or "using (true)" policy would still let
--    one account read another's rows (policies are OR-ed together), so drop
--    it:  drop policy "<name>" on public.<table>;
-- ═══════════════════════════════════════════════════════════════════
select tablename, rowsecurity
  from pg_tables where schemaname = 'public' order by tablename;

select tablename, policyname, cmd, roles, qual, with_check
  from pg_policies where schemaname = 'public' order by tablename, policyname;
