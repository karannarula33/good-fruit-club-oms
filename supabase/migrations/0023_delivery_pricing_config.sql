-- Daily order -> Google Sheets sync (Master Dashboard "Orders" tab): the
-- constants behind the per-order delivery-cost formula, agreed with the
-- business directly (not read from the sheet's own Config tab, which is
-- stale). Key/value shape mirrors eng_config (0013_engagement_engine.sql)
-- so every tunable-without-code-change constant in this codebase follows
-- one convention.
--
-- Formula (src/lib/delivery/delivery-cost.ts): (HUB_DAILY_FEE / that day's
-- order count) + (BASE_FEE for <= BASE_KM, + PER_KM_RATE per km beyond,
-- using real driving distance from HUB_ORIGIN) + (COD_FEE_PCT of the bill
-- total, only when paid cash) + (PER_KG_RATE per kg of the order's actual
-- weight above WEIGHT_THRESHOLD_KG) -- the total split evenly across the
-- order's lines. HUB_ORIGIN is the Gurgaon delivery hub (a Plus Code) the
-- distance leg is measured from -- distinct from the flat HUB_DAILY_FEE,
-- which covers the separate Paschim Vihar -> Gurgaon-hub leg and isn't
-- distance-based at all.

create table public.delivery_pricing_config (
  key        text primary key,
  value      numeric not null,
  updated_at timestamptz default now()
);

create table public.delivery_pricing_text_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz default now()
);

alter table public.delivery_pricing_config enable row level security;
alter table public.delivery_pricing_text_config enable row level security;

create policy "delivery_pricing_config_select_any_role"
  on public.delivery_pricing_config for select
  using (public.has_role());
create policy "delivery_pricing_config_write_admin"
  on public.delivery_pricing_config for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "delivery_pricing_text_config_select_any_role"
  on public.delivery_pricing_text_config for select
  using (public.has_role());
create policy "delivery_pricing_text_config_write_admin"
  on public.delivery_pricing_text_config for all
  using (public.is_admin())
  with check (public.is_admin());

insert into public.delivery_pricing_config (key, value) values
  ('HUB_DAILY_FEE', 600),
  ('BASE_FEE', 50),
  ('BASE_KM', 3),
  ('PER_KM_RATE', 9),
  ('COD_FEE_PCT', 0.007),
  ('WEIGHT_THRESHOLD_KG', 2),
  ('PER_KG_RATE', 10),
  ('MISC_COST_PER_PACKAGE', 2)
on conflict (key) do nothing;

insert into public.delivery_pricing_text_config (key, value) values
  ('HUB_ORIGIN', 'F3MM+2G9 Gurugram, Haryana')
on conflict (key) do nothing;
