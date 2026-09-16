-- PFMT migration 003 — a budget's alert threshold is an AMOUNT, not a percentage.
--
-- WHY
--
-- The column was called alert_pct and the app read it as a percentage of the
-- budget's limit. That was wrong about how people actually decide to be warned:
-- nobody thinks "tell me at 79%", they think "tell me when I've spent $380 of
-- my $400."
--
-- The stored values had been amounts all along —
--
--     category        limit    alert_pct        as a % ?        as an amount ?
--     Health           480        400        never reachable   warn at 480−80
--     Food & Drink     450        400        never reachable   warn at 450−50
--     Education        200        150        never reachable   warn at 200−50
--     Transport        160        100        only when over    warn at 160−60
--
-- — read as percentages they were nonsense, and every budget alert was silently
-- dead. Read as amounts every one of them is a sensible "warn me near the end"
-- setting. So this migration renames the column to match what the data has
-- always meant, and converts nothing: the numbers are already correct.
--
-- Run in the Supabase dashboard → SQL Editor. Safe to re-run.

-- The rename is the whole migration. numeric, not int, so a threshold can carry
-- cents like any other money column in this schema.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='budgets' and column_name='alert_pct')
  then
    alter table public.budgets rename column alert_pct to alert_amount;
  end if;
end $$;

alter table public.budgets alter column alert_amount type numeric using alert_amount::numeric;
alter table public.budgets alter column alert_amount set default 0;

-- A threshold of zero means "not set", and the app falls back to 80% of the
-- limit. Anything negative is meaningless.
alter table public.budgets drop constraint if exists budgets_alert_amount_nonneg;
alter table public.budgets add constraint budgets_alert_amount_nonneg check (alert_amount >= 0);

-- Verify: every budget, its limit, and the amount it now warns at.
select category, currency, amount as limit_amt, alert_amount,
       case when alert_amount <= 0        then 'not set — falls back to 80% of limit'
            when alert_amount > amount    then 'above the limit — over-budget fires first'
            else 'warns at ' || alert_amount::text
       end as reads_as
from public.budgets
order by category;
