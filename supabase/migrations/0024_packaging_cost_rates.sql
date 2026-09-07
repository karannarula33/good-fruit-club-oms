-- Daily order -> Google Sheets sync: packaging cost is a flat rate per
-- physical box/packet type (src/lib/delivery/packaging-cost.ts), not the
-- Master Dashboard sheet's old weight-tier Config (stale, per the
-- business). Adds 'medium_packet' as a new packaging_type -- it doesn't
-- exist in the OMS yet, but has its own rate from the delivery partner.

alter table public.order_packages
  drop constraint order_packages_packaging_type_check;

alter table public.order_packages
  add constraint order_packages_packaging_type_check check (packaging_type in (
    'big_box', 'medium_box', 'small_box', 'small_packet', 'medium_packet', 'big_packet', 'tiny_box'
  ));

create table public.packaging_cost_rates (
  packaging_type text primary key check (packaging_type in (
    'big_box', 'medium_box', 'small_box', 'small_packet', 'medium_packet', 'big_packet', 'tiny_box'
  )),
  cost_per_unit numeric(10, 2) not null,
  updated_at timestamptz default now()
);

alter table public.packaging_cost_rates enable row level security;

create policy "packaging_cost_rates_select_any_role"
  on public.packaging_cost_rates for select
  using (public.has_role());
create policy "packaging_cost_rates_write_admin"
  on public.packaging_cost_rates for all
  using (public.is_admin())
  with check (public.is_admin());

insert into public.packaging_cost_rates (packaging_type, cost_per_unit) values
  ('tiny_box', 9),
  ('small_box', 9),
  ('medium_box', 11),
  ('big_box', 13),
  ('small_packet', 6),
  ('medium_packet', 7),
  ('big_packet', 8)
on conflict (packaging_type) do nothing;
