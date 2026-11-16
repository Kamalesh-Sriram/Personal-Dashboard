-- ══════════════════════════════════════════════════════════════════════
-- Personal Dashboard v5: database schema (optional; only for sync and
-- closed-app notifications).
--
-- Run once: Supabase dashboard > SQL Editor > New query > paste > Run.
-- Safe to run again.
--
-- Security model
--   Every row belongs to one signed-in user. Row Level Security makes the
--   database itself refuse any request for someone else's rows, whatever
--   the browser sends. The publishable ("anon") key in the page grants
--   nothing on its own.
-- ══════════════════════════════════════════════════════════════════════

-- ── coming from version 4 ─────────────────────────────────────────────
-- Version 4 had push tables with the same names but no owner column. They
-- only ever held short-lived notification data, so they are replaced.
-- Tables that already have the new shape are left alone.
do $$
begin
  if to_regclass('public.push_queue') is not null and not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'push_queue' and column_name = 'user_id') then
    drop table public.push_queue;
  end if;
  if to_regclass('public.push_subscriptions') is not null and not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'push_subscriptions' and column_name = 'user_id') then
    drop table public.push_subscriptions;
  end if;
end $$;

-- ── the dashboard document: one row per user ──────────────────────────
create table if not exists public.dashboards (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  state      jsonb not null,
  rev        bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.dashboards enable row level security;

drop policy if exists "dashboards: owner reads"   on public.dashboards;
drop policy if exists "dashboards: owner inserts" on public.dashboards;
drop policy if exists "dashboards: owner updates" on public.dashboards;
drop policy if exists "dashboards: owner deletes" on public.dashboards;

create policy "dashboards: owner reads"   on public.dashboards for select to authenticated using (auth.uid() = user_id);
create policy "dashboards: owner inserts" on public.dashboards for insert to authenticated with check (auth.uid() = user_id);
create policy "dashboards: owner updates" on public.dashboards for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "dashboards: owner deletes" on public.dashboards for delete to authenticated using (auth.uid() = user_id);

-- ── devices that may receive push ─────────────────────────────────────
-- A row here is effectively "permission to send to this phone", so the
-- browser gets NO access at all: RLS is on and there are no policies.
-- Only the site's own functions (service role) read or write it.
create table if not exists public.push_subscriptions (
  device_id  text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;

-- ── the notification plan ─────────────────────────────────────────────
-- A browser cannot schedule a notification for later. The app writes the
-- times here; a scheduled function sends whatever has come due.
create table if not exists public.push_queue (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  dedupe_key  text not null,                 -- stable per notification, so replanning overwrites
  send_at     timestamptz not null,
  expires_at  timestamptz,                   -- past this, drop instead of sending
  repeat_sec  integer,                       -- the running-timer row rolls forward by this
  kind        text not null default 'nudge', -- nudge | timer | timer_clear
  title       text not null,
  body        text not null default '',
  tag         text not null default 'hq',
  ongoing     boolean not null default false,
  silent      boolean not null default false,
  data        jsonb not null default '{}'::jsonb,
  sent_at     timestamptz,
  attempts    integer not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  unique (user_id, dedupe_key),
  constraint push_queue_title_len check (char_length(title) <= 200),
  constraint push_queue_body_len  check (char_length(body) <= 600)
);
create index if not exists push_queue_due_idx on public.push_queue (send_at) where sent_at is null;

alter table public.push_queue enable row level security;

drop policy if exists "queue: owner reads"     on public.push_queue;
drop policy if exists "queue: owner enqueues"  on public.push_queue;
drop policy if exists "queue: owner replans"   on public.push_queue;
drop policy if exists "queue: owner withdraws" on public.push_queue;

create policy "queue: owner reads"     on public.push_queue for select to authenticated using (auth.uid() = user_id);
create policy "queue: owner enqueues"  on public.push_queue for insert to authenticated with check (auth.uid() = user_id);
create policy "queue: owner replans"   on public.push_queue for update to authenticated using (auth.uid() = user_id and sent_at is null) with check (auth.uid() = user_id);
create policy "queue: owner withdraws" on public.push_queue for delete to authenticated using (auth.uid() = user_id and sent_at is null);

-- ── finance: your transactions (optional; only for the Finance tab) ───
-- One row per transaction, readable and writable only by its owner. Rows
-- arrive from statement files you import and, if you link a bank, from the
-- site's own bank function.
create table if not exists public.transactions (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null,                    -- a hash of the content, so importing twice adds nothing
  booked     date not null,
  amount     numeric(14, 2) not null,          -- money out is negative
  currency   text not null default 'EUR',
  name       text not null default '',
  memo       text not null default '',
  account    text not null default '',
  category   text not null default '',
  manual     boolean not null default false,   -- true once you chose the category yourself
  source     text not null default 'file',     -- file | bank
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint transactions_id_len   check (char_length(id) <= 80),
  constraint transactions_name_len check (char_length(name) <= 200),
  constraint transactions_memo_len check (char_length(memo) <= 500)
);
create index if not exists transactions_user_updated_idx on public.transactions (user_id, updated_at);

alter table public.transactions enable row level security;

drop policy if exists "transactions: owner reads"   on public.transactions;
drop policy if exists "transactions: owner inserts" on public.transactions;
drop policy if exists "transactions: owner updates" on public.transactions;
drop policy if exists "transactions: owner deletes" on public.transactions;

create policy "transactions: owner reads"   on public.transactions for select to authenticated using (auth.uid() = user_id);
create policy "transactions: owner inserts" on public.transactions for insert to authenticated with check (auth.uid() = user_id);
create policy "transactions: owner updates" on public.transactions for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "transactions: owner deletes" on public.transactions for delete to authenticated using (auth.uid() = user_id);

-- ── finance: linked banks ─────────────────────────────────────────────
-- A row here holds a read-only session with your bank. Like the push
-- subscriptions, the browser gets NO access: RLS is on with no policies,
-- and only the site's own bank function (service role) touches it.
create table if not exists public.bank_links (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  aspsp       text not null,                   -- the bank's name
  country     text not null,
  status      text not null default 'pending', -- pending | active | expired
  state       text,                            -- one-time value that ties the bank's answer to this attempt
  session_id  text,
  accounts    jsonb not null default '[]'::jsonb,
  valid_until timestamptz,
  last_sync   timestamptz,
  last_error  text,
  created_at  timestamptz not null default now()
);
create index if not exists bank_links_user_idx on public.bank_links (user_id);
alter table public.bank_links enable row level security;

-- ── nothing for visitors who are not signed in ────────────────────────
revoke all on public.dashboards, public.push_subscriptions, public.push_queue, public.transactions, public.bank_links from anon;
grant select, insert, update, delete on public.dashboards, public.push_queue, public.transactions to authenticated;
revoke all on public.push_subscriptions, public.bank_links from authenticated;
