-- Zones keep their original names (admin 2026-10-31). 0039 made zone a copy
-- of area via a trigger; that is reversed: customers in an original zone
-- ("DLF Phase 2", "Sushant Lok", "Phase 3"...) keep it, and only customers
-- with no zone get one from their area -- set by the app
-- (src/lib/customers/zone.ts zoneForArea, applied in fill-areas.ts), not by
-- the database. The zone check constraint stays dropped so new area-based
-- zones ("Paschim Vihar", "Sector 65") are allowed. Zones overwritten by
-- 0039 are restored by scripts/restore_customer_zones.ts.

drop trigger if exists customers_sync_zone on public.customers;
drop function if exists public.sync_customer_zone();
