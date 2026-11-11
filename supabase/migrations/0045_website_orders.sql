-- Website orders straight to packing (admin, 2026-11-11). Confirmed orders
-- from goodfruit.club -- cash on delivery as soon as they're placed, online
-- orders once Razorpay confirms payment -- are POSTed by the site to
-- /api/website/orders and land as normal 'recorded' orders in To Pack, with
-- no paste. Rules: src/lib/website/ingest.ts.
--
-- These columns were first added on the live database on 2026-09-30 (an
-- earlier, unfinished version of this flow) without a migration in the repo;
-- this file declares them idempotently so the schema is reproducible.
--
--   source            'website' for an order the site sent; 'manual' (default)
--                     for everything entered in the OMS. A website order is
--                     never merged into by a paste.
--   external_ref      the site's order number (GFC-1234). Unique, so a
--                     repeated call never creates the order twice.
--   delivery_charge   the site's delivery fee; billed as a "Delivery" line.
--   prepaid_amount    what the customer paid online on the site.
--   prepaid_credit_id the ledger credit posted for that payment; the order's
--                     bill uses it first, and no other bill can use it while
--                     this order is unbilled.

alter table public.orders
  add column if not exists source text not null default 'manual',
  add column if not exists external_ref text,
  add column if not exists delivery_charge numeric(10,2) not null default 0,
  add column if not exists prepaid_amount numeric(10,2),
  add column if not exists prepaid_credit_id uuid references public.ledger_entries (id);

alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders add constraint orders_source_check check (source in ('manual', 'website'));

create unique index if not exists orders_external_ref_uniq
  on public.orders (external_ref) where external_ref is not null;
