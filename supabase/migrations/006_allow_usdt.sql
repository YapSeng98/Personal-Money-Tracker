-- PFMT migration 006 — let every currency column accept USDT.
--
-- The app now offers USDT alongside SGD, USD, AUD and MYR. The currency
-- columns are plain text, so nothing should stop it — unless a CHECK
-- constraint was added by hand in the dashboard when the first tables were
-- set up (they were never written down; see migration 004). If one exists,
-- a USDT row is refused, and the app shows it under "⚠ change not saved" in
-- the top bar instead of losing it.
--
-- Run the SELECT first. If it returns nothing, there is nothing to do.
-- Safe to run twice; touches no data.

select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where contype = 'c' and connamespace = 'public'::regnamespace
   and pg_get_constraintdef(oid) ilike '%currency%';

do $$
declare
  c record;
begin
  for c in
    select conrelid::regclass as tbl, conname
      from pg_constraint
     where contype = 'c' and connamespace = 'public'::regnamespace
       and pg_get_constraintdef(oid) ilike '%currency%'
       and conrelid::regclass::text in ('transactions', 'accounts', 'budgets', 'goals', 'bills', 'preferences')
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
    raise notice 'dropped % on %', c.conname, c.tbl;
  end loop;
end $$;
