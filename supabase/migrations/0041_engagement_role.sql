-- Engagement role (admin, 2026-11-03): the community manager's login (Navya
-- first). Screens: Learn GFC (onboarding, 0042), Order Entry WITH prices,
-- Engagement (work the nudge queue) and the delivery Route as read-only.
-- Not: Packing, Dispatch, Procurement, Prices/Catalog editing, Ledger,
-- Manage, Dashboard, Overheads.
--
-- Additive only: the existing admin / packer / delivery policies are
-- unchanged. Mirrors 0035_packer_order_entry.sql for order entry, plus read
-- access to the price tables (this role quotes prices to members) and the
-- nudge-queue updates behind Relay / Skip / Snooze.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'packer', 'delivery', 'engagement'));

create function public.is_engagement()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'engagement'
  );
$$;

-- Prices: read-only.
create policy "price_versions_select_engagement"
  on public.price_versions for select
  using (public.is_engagement());

create policy "price_items_select_engagement"
  on public.price_items for select
  using (public.is_engagement());

create policy "price_tiers_select_engagement"
  on public.price_tiers for select
  using (public.is_engagement());

-- Order entry: new customer inline, new order or same-day merge, new alias.
create policy "customers_insert_engagement"
  on public.customers for insert
  with check (public.is_engagement());

create policy "orders_insert_engagement"
  on public.orders for insert
  with check (public.is_engagement());

-- Only still-open (recorded) orders: order entry merges a same-day paste
-- into one, and nothing else. Packed, billed or delivered orders stay out of
-- reach, so the read-only Route is read-only in the database too.
create policy "orders_update_engagement"
  on public.orders for update
  using (public.is_engagement() and status = 'recorded')
  with check (public.is_engagement() and status = 'recorded');

create policy "order_lines_insert_engagement"
  on public.order_lines for insert
  with check (
    public.is_engagement()
    and exists (select 1 from public.orders o where o.id = order_id and o.status = 'recorded')
  );

create policy "product_aliases_insert_engagement"
  on public.product_aliases for insert
  with check (public.is_engagement());

-- Engagement: Relay / Skip / Snooze a nudge.
create policy "eng_nudge_queue_update_engagement"
  on public.eng_nudge_queue for update
  using (public.is_engagement())
  with check (public.is_engagement());
