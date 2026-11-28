-- 009 — Running-high alerts on Telegram.
--
-- The nightly alert run now also says when a category is running well above
-- its usual, once a month per category. notifications_sent records each one
-- sent so it isn't repeated; it only allowed 'budget', 'bill' and 'test'.
-- Safe to run more than once.

alter table public.notifications_sent drop constraint if exists notifications_sent_kind_check;
alter table public.notifications_sent add constraint notifications_sent_kind_check
  check (kind in ('budget', 'bill', 'test', 'trend'));
