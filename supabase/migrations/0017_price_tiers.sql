-- Quantity-tiered pricing, single unit per product. A tier is a per-unit
-- rate that applies once a line's quantity meets a threshold -- e.g.
-- Alphonso Mango at ₹990/kg normally, ₹900/kg at 5kg+. price_items.price_per_unit
-- remains the base/first rate; price_tiers layers optional higher-qty
-- breakpoints on top of a specific price_items row. Same immutability
-- philosophy as price_items: no update/delete, corrections happen via a
-- new version (and a new set of tiers).

create table public.price_tiers (
  id uuid primary key default gen_random_uuid(),
  price_item_id uuid not null references public.price_items (id),
  min_qty numeric(8, 3) not null check (min_qty > 0),
  price_per_unit numeric(10, 2) not null check (price_per_unit > 0),
  unique (price_item_id, min_qty)
);

alter table public.price_tiers enable row level security;

create policy "price_tiers_select_admin"
  on public.price_tiers for select
  using (public.is_admin());

create policy "price_tiers_insert_admin"
  on public.price_tiers for insert
  with check (public.is_admin());

-- Replaces the Slice 2 body (0002_catalog_prices.sql) of the same function.
-- p_items gains two optional per-item keys:
--   "tiers": [{ "min_qty": numeric, "price_per_unit": numeric }, ...]
--   "replace_tiers": boolean
-- Every publish creates a brand-new price_items row, so a plain single-price
-- edit (PriceQuickEdit, or the paste-list flow) that never touches tiers
-- would otherwise silently drop a product's existing bulk-pricing schedule
-- the moment its base price is next republished. To prevent that: when
-- replace_tiers is true, the given tiers (including an empty list, which
-- intentionally clears bulk pricing) are inserted as-is. Otherwise, the
-- tiers attached to the product's previously-winning price_items row as of
-- p_effective_from are copied forward onto the new row -- same resolution
-- tie-break resolve.ts uses (latest effective_from, then latest version
-- created_at), just expressed in SQL.
create or replace function public.publish_price_version(
  p_effective_from timestamptz,
  p_note text,
  p_items jsonb,
  p_new_aliases jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_version_id uuid;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'no priced items to publish';
  end if;

  insert into public.price_versions (effective_from, published_by, note)
  values (p_effective_from, auth.uid(), p_note)
  returning id into v_version_id;

  insert into public.price_items (version_id, product_id, price_per_unit)
  select v_version_id, (item ->> 'product_id')::uuid, (item ->> 'price_per_unit')::numeric
  from jsonb_array_elements(p_items) as item;

  -- Explicit tiers (replace_tiers = true): insert exactly what was given.
  insert into public.price_tiers (price_item_id, min_qty, price_per_unit)
  select pi.id, (t ->> 'min_qty')::numeric, (t ->> 'price_per_unit')::numeric
  from jsonb_array_elements(p_items) as item
  join public.price_items pi
    on pi.version_id = v_version_id and pi.product_id = (item ->> 'product_id')::uuid
  cross join lateral jsonb_array_elements(coalesce(item -> 'tiers', '[]'::jsonb)) as t
  where coalesce((item ->> 'replace_tiers')::boolean, false) = true;

  -- Carry forward (replace_tiers false/absent): copy the tiers from the
  -- product's previously-winning price_items row as of p_effective_from.
  insert into public.price_tiers (price_item_id, min_qty, price_per_unit)
  select new_pi.id, prev_tier.min_qty, prev_tier.price_per_unit
  from jsonb_array_elements(p_items) as item
  join public.price_items new_pi
    on new_pi.version_id = v_version_id and new_pi.product_id = (item ->> 'product_id')::uuid
  cross join lateral (
    select pi2.id
    from public.price_items pi2
    join public.price_versions pv2 on pv2.id = pi2.version_id
    where pi2.product_id = (item ->> 'product_id')::uuid
      and pi2.id <> new_pi.id
      and pv2.effective_from <= p_effective_from
    order by pv2.effective_from desc, pv2.created_at desc
    limit 1
  ) as prev_pi
  join public.price_tiers prev_tier on prev_tier.price_item_id = prev_pi.id
  where coalesce((item ->> 'replace_tiers')::boolean, false) = false;

  insert into public.product_aliases (product_id, alias)
  select (a ->> 'product_id')::uuid, trim(a ->> 'alias')
  from jsonb_array_elements(coalesce(p_new_aliases, '[]'::jsonb)) as a
  on conflict (alias) do nothing;

  return v_version_id;
end;
$$;
