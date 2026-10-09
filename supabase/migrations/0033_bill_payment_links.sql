-- Razorpay payment links on bills (admin, 2026-10-09).
--
-- When a bill is generated and the order still has something unpaid, the OMS
-- creates a Razorpay payment link for THIS ORDER's unpaid amount (the bill
-- total less any advance already allocated to it -- never the carried
-- balance) and adds it to the WhatsApp bill text. When the customer pays,
-- Razorpay's webhook (/api/razorpay/webhook) posts a credit to the ledger
-- and allocates it to the order.
--
-- Purely additive: existing bills keep null link columns.

alter table public.bills
  add column payment_link_id text,
  add column payment_link_url text,
  add column payment_link_amount numeric(10, 2),
  add column payment_link_status text check (payment_link_status in ('created', 'paid', 'cancelled', 'expired'));

create unique index bills_payment_link_id_key on public.bills (payment_link_id) where payment_link_id is not null;

-- The gateway's payment id for credits posted automatically, so a webhook
-- Razorpay retries can never post the same payment twice.
alter table public.ledger_entries
  add column external_ref text;

create unique index ledger_entries_external_ref_key on public.ledger_entries (external_ref) where external_ref is not null;
