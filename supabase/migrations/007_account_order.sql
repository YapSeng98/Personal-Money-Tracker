-- PFMT migration 007 — remember the order you arrange your accounts in.
--
-- Accounts → Arrange moves an account up or down within its currency. The
-- order is stored here so every device shows the same one. Until this runs,
-- the app keeps the order on each device separately and never sends it, so
-- nothing is refused in the meantime.
--
-- Safe to run twice; touches no existing data (every account starts unplaced
-- and keeps its current position until you move one).

alter table public.accounts add column if not exists sort_order integer;
