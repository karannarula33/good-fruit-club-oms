-- Slice 5: procurement_marks. The base-vs-extras split itself is derived
-- (see src/lib/procurement/aggregate.ts), not stored -- this table only
-- records the one timestamp that split pivots on. RLS mirrors the
-- has_role()/is_admin() pattern from earlier migrations. No update/delete:
-- a mark is a one-time, immutable snapshot (same rationale as
-- price_versions) -- the unique constraint on delivery_date is the
-- "already marked" guard.

create table public.procurement_marks (
  id uuid primary key default gen_random_uuid(),
  delivery_date date not null unique,
  list_sent_at timestamptz not null,
  sent_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.procurement_marks enable row level security;

create policy "procurement_marks_select_any_role"
  on public.procurement_marks for select
  using (public.has_role());

create policy "procurement_marks_insert_admin"
  on public.procurement_marks for insert
  with check (public.is_admin());
