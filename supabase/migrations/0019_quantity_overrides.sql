-- Admin quantity override at billing time -- sibling to price_overrides
-- (0016_price_overrides.sql), same shape and same reasoning: a packer's
-- actual_qty entry can be wrong, and this is a deliberate, audited
-- correction scoped to a single line on a single not-yet-billed order (see
-- validateQuantityOverride in src/lib/billing/override.ts for the
-- eligibility guards). It writes the new value onto order_lines.actual_qty
-- and keeps an immutable audit row here. Note this does NOT also lock a
-- price: a line whose price hasn't been separately overridden keeps
-- resolving live against whatever qty is currently on the line (see
-- src/lib/billing/resolve-line-prices.ts), so a qty correction alone
-- naturally re-prices at the correct tier.

create table public.quantity_overrides (
  id uuid primary key default gen_random_uuid(),
  order_line_id uuid not null references public.order_lines (id),
  previous_qty numeric(8, 3),
  new_qty numeric(8, 3) not null,
  reason text not null,
  overridden_by uuid references public.profiles (id),
  overridden_at timestamptz not null default now()
);

alter table public.quantity_overrides enable row level security;

create policy "quantity_overrides_select_any_role"
  on public.quantity_overrides for select
  using (public.has_role());

create policy "quantity_overrides_insert_admin"
  on public.quantity_overrides for insert
  with check (public.is_admin());
