-- WhatsApp bill greeting ("Hello Sir," / "Hello Ma'am,") needs a per-customer
-- salutation. Classified once via LLM (src/lib/parser/classify-salutation.ts)
-- the first time a bill is generated for that customer, cached here so it's
-- never re-classified. Nullable: not yet classified, or the name was too
-- ambiguous to guess (business name, couple, initials-only) -- generateBill
-- blocks and prompts the admin to set it manually in that case (see
-- src/app/actions/customers.ts updateCustomerSalutation), same escape hatch
-- used for price/quantity corrections.

alter table public.customers
  add column salutation text check (salutation in ('Sir', 'Ma''am'));
