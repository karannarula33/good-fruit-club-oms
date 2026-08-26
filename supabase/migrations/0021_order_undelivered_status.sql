-- Last-mile screen restructure: a delivery person needs a way to mark a
-- stop as not delivered (customer refused, not home, route skipped, etc.)
-- without it silently vanishing into 'cancelled' -- 'cancelled' is
-- documented (CLAUDE.md §3.5) as only reachable pre-pack. 'undelivered' is
-- a new terminal state reachable from 'out_for_delivery', alongside
-- 'delivered'. Deliberately a single status, not separate
-- returned/unfulfilled values -- the reason (if any) is just free text.
--
-- No ledger action accompanies this: the bill's debit (if any) is left
-- standing for the admin to resolve manually via the existing ledger
-- tools -- no automatic reversal.

alter table public.orders
  drop constraint orders_status_check;

alter table public.orders
  add constraint orders_status_check check (status in (
    'recorded', 'packed', 'dispatched', 'out_for_delivery', 'delivered', 'undelivered', 'cancelled'
  ));

alter table public.orders
  add column undelivered_reason text;

-- No RLS change needed: orders_update_delivery (0010_delivery_status_rls.sql)
-- already grants delivery role a full-row, column-agnostic update via
-- is_delivery() -- the same policy that lets deliverOrder write
-- status/status_timestamps today covers status='undelivered' and the new
-- undelivered_reason column.
