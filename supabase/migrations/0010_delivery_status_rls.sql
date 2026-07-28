-- Slice 9: delivery role write access + Realtime for the status board.
-- Mirrors is_admin()/is_packer() exactly. orders SELECT already works for
-- delivery via the existing has_role() policy from 0005_orders.sql --
-- this only adds the UPDATE (out_for_delivery/delivered transitions) and
-- the ledger/payment_allocations INSERT (payment collected on delivery,
-- mirroring the packer grants from 0008/0009).

create function public.is_delivery()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'delivery'
  );
$$;

create policy "orders_update_delivery"
  on public.orders for update
  using (public.is_delivery())
  with check (public.is_delivery());

create policy "ledger_entries_insert_delivery"
  on public.ledger_entries for insert
  with check (public.is_delivery());

create policy "payment_allocations_insert_delivery"
  on public.payment_allocations for insert
  with check (public.is_delivery());

-- Enable Realtime on orders for the status board (idempotent -- errors if
-- re-run against a publication that already includes the table).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;
