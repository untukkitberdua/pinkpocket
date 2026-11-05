-- PinkPocket shared database
-- Run this script once in Supabase Dashboard > SQL Editor.

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('income','expense','transfer')),
  amount numeric(18,2) not null check (amount > 0),
  description text not null check (length(trim(description)) between 1 and 100),
  category text not null default '',
  wallet text not null check (wallet in ('cash','bank','savings')),
  to_wallet text null check (to_wallet is null or to_wallet in ('cash','bank','savings')),
  date date not null check (date >= date '2026-11-01'),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_transfer_wallets check (
    (type = 'transfer' and to_wallet is not null and wallet <> to_wallet)
    or (type <> 'transfer' and to_wallet is null)
  )
);

create index if not exists transactions_user_date_idx
  on public.transactions (user_id, date desc, created_at desc);

alter table public.transactions enable row level security;
alter table public.transactions replica identity full;

drop policy if exists "Users can read their own transactions" on public.transactions;
drop policy if exists "Users can insert their own transactions" on public.transactions;
drop policy if exists "Users can update their own transactions" on public.transactions;
drop policy if exists "Users can delete their own transactions" on public.transactions;

create policy "Users can read their own transactions"
on public.transactions for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert their own transactions"
on public.transactions for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own transactions"
on public.transactions for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own transactions"
on public.transactions for delete
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_transactions_updated_at on public.transactions;
create trigger set_transactions_updated_at
before update on public.transactions
for each row execute function public.set_updated_at();

-- Add the table to Supabase Realtime only if it is not already published.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'transactions'
  ) then
    alter publication supabase_realtime add table public.transactions;
  end if;
end;
$$;
