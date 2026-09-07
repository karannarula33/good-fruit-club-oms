-- Daily order -> Google Sheets sync: caches each customer's real driving
-- distance from the Gurgaon hub (Google Distance Matrix API), so a repeat
-- customer doesn't trigger a fresh (paid) API call on every sync run.
-- address_snapshot lets the sync job detect a stale cache -- if it no
-- longer matches customers.address, the distance is recomputed.

create table public.customer_hub_distances (
  customer_id      uuid primary key references public.customers (id),
  address_snapshot text not null,
  distance_km      numeric(6, 2) not null,
  computed_at      timestamptz not null default now()
);

alter table public.customer_hub_distances enable row level security;

create policy "customer_hub_distances_select_any_role"
  on public.customer_hub_distances for select
  using (public.has_role());
create policy "customer_hub_distances_write_admin"
  on public.customer_hub_distances for all
  using (public.is_admin())
  with check (public.is_admin());
