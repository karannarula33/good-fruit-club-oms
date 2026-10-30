-- Customer location (admin 2026-10-28). The fixed list of 8 Gurgaon route
-- zones (half the customers fell in "Unassigned") is retired: these columns
-- record where the customer actually is, read from the address, and `zone`
-- now simply mirrors `area` (trigger below), so every screen that groups by
-- zone shows real neighbourhoods across Gurgaon and Delhi:
--
--   city      -- 'Gurgaon' | 'Delhi' | 'Noida' | 'Faridabad' | 'Ghaziabad' | 'Other'
--   area      -- the neighbourhood: 'DLF Phase 2', 'Sushant Lok 1',
--                'Golf Course Road', 'Sector 65', 'Paschim Vihar', 'Lodhi Road'...
--   locality  -- the society / building / block when the address names one:
--                'Heritage City', 'The Vilas', 'Emerald Hills'... (optional)
--
--   area_source       -- 'auto' (rules or Claude, src/lib/customers/area.ts)
--                        or 'manual' (set by the admin; never overwritten)
--   area_resolved_for -- the address text the auto area was read from, so a
--                        changed address gets re-read.
--
-- Additive; RLS on customers unchanged.

alter table public.customers
  add column if not exists city text
    check (city in ('Gurgaon', 'Delhi', 'Noida', 'Faridabad', 'Ghaziabad', 'Other')),
  add column if not exists area text,
  add column if not exists locality text,
  add column if not exists area_source text
    check (area_source in ('auto', 'manual')),
  add column if not exists area_resolved_for text;

create index if not exists customers_area_idx on public.customers (city, area);

-- zone = area. The old check constraint (8 fixed zones) goes; a trigger keeps
-- zone equal to area, 'Unassigned' while the area isn't known. Code that
-- still writes zone directly is harmless: the trigger overrides it.
alter table public.customers drop constraint if exists customers_zone_check;
alter table public.customers alter column zone set default 'Unassigned';

create or replace function public.sync_customer_zone()
returns trigger
language plpgsql
as $$
begin
  new.zone := coalesce(nullif(trim(new.area), ''), 'Unassigned');
  return new;
end;
$$;

drop trigger if exists customers_sync_zone on public.customers;
create trigger customers_sync_zone
  before insert or update on public.customers
  for each row execute function public.sync_customer_zone();

-- Areas are filled right after this by scripts/backfill_customer_areas.ts;
-- until then every zone reads 'Unassigned'.
update public.customers set zone = coalesce(nullif(trim(area), ''), 'Unassigned');
