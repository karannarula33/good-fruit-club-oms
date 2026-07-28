-- Slice 7: bills, ledger_entries, payment_allocations per CLAUDE.md §4.
-- Created together as one coupled "ledger" schema unit -- payment_allocations
-- FKs into ledger_entries even though nothing writes to it until Slice 8
-- (ledger UI: recording payments/advances). RLS mirrors the
-- has_role()/is_admin()/is_packer() pattern; packer needs insert since
-- billing happens from the packer's screen (finalize -> bill auto-generates).
-- No update/delete anywhere -- immutable audit trail, same rationale as
-- price_versions/procurement_marks.

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id),
  total numeric(10, 2) not null,
  prev_balance numeric(10, 2) not null,
  net_due numeric(10, 2) not null,
  message_text text,
  finalized_at timestamptz,
  finalized_by uuid references public.profiles (id)
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  entry_type text not null check (entry_type in ('debit', 'credit')),
  amount numeric(10, 2) not null,
  mode text check (mode in ('cash', 'upi', 'other')),
  order_id uuid references public.orders (id),
  note text,
  entered_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- Defense-in-depth alongside generateBill's own "check for an existing
-- bill first" idempotency guard: a single order can never end up with two
-- debit entries no matter what races the app code.
create unique index ledger_entries_one_debit_per_order
  on public.ledger_entries (order_id) where entry_type = 'debit';

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  ledger_entry_id uuid not null references public.ledger_entries (id),
  order_id uuid not null references public.orders (id),
  amount numeric(10, 2) not null
);

alter table public.bills enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.payment_allocations enable row level security;

create policy "bills_select_any_role"
  on public.bills for select
  using (public.has_role());

create policy "bills_insert_admin"
  on public.bills for insert
  with check (public.is_admin());

create policy "bills_insert_packer"
  on public.bills for insert
  with check (public.is_packer());

create policy "ledger_entries_select_any_role"
  on public.ledger_entries for select
  using (public.has_role());

create policy "ledger_entries_insert_admin"
  on public.ledger_entries for insert
  with check (public.is_admin());

create policy "ledger_entries_insert_packer"
  on public.ledger_entries for insert
  with check (public.is_packer());

create policy "payment_allocations_select_any_role"
  on public.payment_allocations for select
  using (public.has_role());

create policy "payment_allocations_insert_admin"
  on public.payment_allocations for insert
  with check (public.is_admin());
