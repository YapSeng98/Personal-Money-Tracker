-- PFMT migration 001 — the five original tables, written down.
--
-- transactions, accounts, budgets, goals and preferences were created by hand
-- in the Supabase dashboard and never recorded, so the repo could not rebuild
-- the database. This is their shape as the live project reports it (read
-- from its REST schema on 23 Oct 2026), so a new project can be set up from
-- the migrations alone: run 001, then 002 to 006 in order.
--
-- Safe on the existing project: every statement is "create ... if not
-- exists", so it changes nothing there. What the REST schema doesn't show,
-- and so isn't here: CHECK constraints (006 covers the currency case) and
-- the user_id foreign key, written below as a reference to auth.users the
-- way Supabase sets it up.
--
-- Row-level security for these tables is migration 004.

create table if not exists public.transactions (
  id                     uuid not null default gen_random_uuid() primary key,
  user_id                uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type                   text not null,
  amount                 numeric not null,
  description            text not null default '',
  category               text,
  account                text,
  date                   date not null,
  notes                  text not null default '',
  currency               text not null default 'SGD',
  transfer_group         text,
  transfer_peer          text,
  is_recurring           boolean not null default false,
  recurring_frequency    text,
  next_run_date          date,
  created_at             timestamp with time zone not null default now(),
  recurring_source       uuid
);

create table if not exists public.accounts (
  id                     uuid not null default gen_random_uuid() primary key,
  user_id                uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name                   text not null,
  type                   text not null default 'Checking',
  institution            text not null default '',
  currency               text not null default 'SGD',
  starting_balance       numeric not null default 0,
  is_active              boolean not null default true,
  icon                   text not null default '',
  created_at             timestamp with time zone not null default now()
);

create table if not exists public.budgets (
  id                     uuid not null default gen_random_uuid() primary key,
  user_id                uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category               text not null,
  amount                 numeric not null,
  spent                  numeric not null default 0,
  alert_amount           numeric not null default 0,
  currency               text not null default 'SGD',
  rollover               boolean not null default false,
  period_start           date,
  period_end             date,
  created_at             timestamp with time zone not null default now()
);

create table if not exists public.goals (
  id                     uuid not null default gen_random_uuid() primary key,
  user_id                uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name                   text not null,
  icon                   text not null default '🎯',
  target                 numeric not null,
  current                numeric not null default 0,
  monthly                numeric not null default 0,
  target_date            date,
  remarks                text not null default '',
  currency               text not null default 'SGD',
  linked_account         text,
  created_at             timestamp with time zone not null default now()
);

create table if not exists public.preferences (
  user_id                uuid not null default auth.uid() primary key references auth.users (id) on delete cascade,
  currency               text not null default 'SGD',
  language               text not null default 'en',
  theme                  text not null default 'auto',
  budget_alerts          boolean not null default true,
  now_assist             boolean not null default true,
  balances_masked        boolean not null default true,
  trend_months           integer not null default 6,
  trend_metric           text not null default 'expense',
  updated_at             timestamp with time zone not null default now(),
  display_name           text,
  avatar_color           text default '#8B5CF6',
  monthly_income_target  numeric default 0,
  ai_api_key             text,
  telegram_chat_id       text not null default '',
  notify_budget          boolean not null default false,
  notify_bills           boolean not null default false,
  bill_lead_days         integer not null default 3
);
