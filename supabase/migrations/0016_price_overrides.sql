-- Admin price override at billing time. CLAUDE.md §3.1 locks an order
-- line's price at order/substitution time and says it's "never
-- recomputed... even if prices change later" -- this is a deliberate,
-- audited exception to that rule, scoped to a single line on a single
-- not-yet-billed order (see validatePriceOverride in
-- src/lib/billing/override.ts for the eligibility guards). It writes the
-- new value onto order_lines.locked_price_per_unit, the same column
-- generateBill() already reads, and keeps an immutable audit row here so
-- there's a paper trail if a customer questions their bill later.

create table public.price_overrides (
  id uuid primary key default gen_random_uuid(),
  order_line_id uuid not null references public.order_lines (id),
  previous_price numeric(10, 2),
  new_price numeric(10, 2) not null,
  reason text not null,
  overridden_by uuid references public.profiles (id),
  overridden_at timestamptz not null default now()
);

alter table public.price_overrides enable row level security;

create policy "price_overrides_select_any_role"
  on public.price_overrides for select
  using (public.has_role());

create policy "price_overrides_insert_admin"
  on public.price_overrides for insert
  with check (public.is_admin());
