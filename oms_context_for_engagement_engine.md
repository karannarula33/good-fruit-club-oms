# Good Fruit Club OMS — context for the engagement engine

This is a context handoff, not a spec. It packages what an outside system needs to
understand and integrate with the existing Order Management System: the real
database schema for `customers`, `orders`, and `order_lines` (the actual table
names — there is no `order_items` table), the project's own source-of-truth
business-rules document (`CLAUDE.md`), a real order as it actually looks once
parsed and saved, and the address→zone mapping.

**Note on the example data below:** it comes from a real, live order in the
database. The customer's name, phone number, and exact address have been
replaced with fake-but-realistic placeholders before inclusion in this file —
everything else (IDs, statuses, quantities, prices, timestamps, the zone
resolution behavior) is real. If you need genuinely real PII for testing,
pull it from the database directly rather than from this file.

---

## 1. Database schema: `customers`, `orders`, `order_lines`

Source of truth = the Supabase SQL migrations in `supabase/migrations/` (not the
schema sketch in `CLAUDE.md` §4, which is design intent and has drifted slightly
— e.g. `orders.notes` below isn't in that sketch). This section is the actual
`create table` statements plus every RLS policy added against these three
tables across the migration history, in the order they were applied.

### 1.1 `customers` (from `0004_customers.sql`)

```sql
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  phone text,
  address text not null,
  zone text not null check (zone in (
    'DLF Phase 2',
    'Sushant Lok',
    'Near Hamilton Court',
    'DLF Phase 1',
    'Phase 3',
    'Phase 4',
    'Phase 5',
    'Outside Gurgaon',
    'Unassigned'
  )),
  notes text,
  created_at timestamptz not null default now()
);

alter table public.customers enable row level security;

create policy "customers_select_any_role"
  on public.customers for select
  using (public.has_role());

create policy "customers_insert_admin"
  on public.customers for insert
  with check (public.is_admin());

create policy "customers_update_admin"
  on public.customers for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "customers_delete_admin"
  on public.customers for delete
  using (public.is_admin());
```

`zone` is computed at customer-creation time from `address` via a fixed regex
mapping (see §4 below) — it is **not** a live geocode, and `'Unassigned'` is a
real, valid, frequently-occurring value (a sentinel for "address didn't match
any known zone pattern"), not an error state.

### 1.2 `orders` + `order_lines` (from `0005_orders.sql`)

```sql
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  placed_at timestamptz not null,
  delivery_date date not null,
  status text not null default 'recorded' check (status in (
    'recorded', 'packed', 'dispatched', 'out_for_delivery', 'delivered', 'cancelled'
  )),
  status_timestamps jsonb not null default '{}',
  raw_paste text,
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  product_id uuid references public.products (id),
  ordered_qty numeric(8, 3),
  ordered_unit text,
  locked_price_per_unit numeric(10, 2),
  actual_qty numeric(8, 3),
  line_status text not null default 'pending' check (line_status in ('pending', 'packed', 'unavailable')),
  is_substitution boolean not null default false,
  substituted_for_line_id uuid references public.order_lines (id),
  parse_confidence text check (parse_confidence in ('clean', 'flagged')),
  parse_note text
);

alter table public.orders enable row level security;
alter table public.order_lines enable row level security;

create policy "orders_select_any_role"
  on public.orders for select
  using (public.has_role());

create policy "orders_insert_admin"
  on public.orders for insert
  with check (public.is_admin());

create policy "orders_update_admin"
  on public.orders for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "order_lines_select_any_role"
  on public.order_lines for select
  using (public.has_role());

create policy "order_lines_insert_admin"
  on public.order_lines for insert
  with check (public.is_admin());

create policy "order_lines_update_admin"
  on public.order_lines for update
  using (public.is_admin())
  with check (public.is_admin());
```

Notable design decisions baked into these two tables:
- **`orders.raw_paste`** is the literal original WhatsApp text (audit trail), never
  reformatted. A merged (multi-paste-same-day) order concatenates pastes with a
  `\n\n---\n\n` separator.
- **`orders.notes`** is a catch-all for anything the parser couldn't map to a
  line item (delivery instructions, payment method, totals, greetings).
- **`order_lines.locked_price_per_unit`** is deliberately nullable — a line whose
  product has no resolvable price can still be saved as an order; it's blocked
  at *billing* time, not at order-entry time.
- **`order_lines.ordered_qty` vs `actual_qty`**: the order captures intent
  (`ordered_qty`, set at parse time); `actual_qty` is filled in later at
  packing and is what actually gets billed. They are frequently different.
- **Substitutions**: `is_substitution` + `substituted_for_line_id` let a packer
  swap in an item that wasn't on the original order; it prices at *that
  moment's* price version, not the order's locked price.

### 1.3 Later RLS grants against these tables (additive, admin policies above still apply)

```sql
-- 0007_packing_rls.sql (packer role, added for the packing screen)
create policy "orders_update_packer"
  on public.orders for update
  using (public.is_packer())
  with check (public.is_packer());

create policy "order_lines_update_packer"
  on public.order_lines for update
  using (public.is_packer())
  with check (public.is_packer());

create policy "order_lines_insert_packer"
  on public.order_lines for insert
  with check (public.is_packer());

-- 0010_delivery_status_rls.sql (delivery role, added for the delivery/status board)
create policy "orders_update_delivery"
  on public.orders for update
  using (public.is_delivery())
  with check (public.is_delivery());

-- also enables Supabase Realtime on public.orders for the live status board

-- 0012_order_delete_admin.sql (admin-only "Manage Orders" cleanup screen,
-- deliberately scoped to unbilled orders only — enforced in application code,
-- not by RLS)
create policy "order_lines_delete_admin"
  on public.order_lines for delete
  using (public.is_admin());

create policy "orders_delete_admin"
  on public.orders for delete
  using (public.is_admin());
```

Net effect: `admin` has full CRUD on both tables; `packer` can update
`orders`/`order_lines` and insert new `order_lines` (packing actuals,
substitutions); `delivery` can update `orders` (delivery status transitions);
every authenticated role can `select` both tables; only `admin` can delete.

### 1.4 Referenced tables not reproduced in full here

`order_lines.product_id` references `public.products` (catalog: name,
`unit_type` = `weight`|`count`, `unit_label`). Pricing is *not* stored inline —
`locked_price_per_unit` is a snapshot taken at order-save time from
`price_versions`/`price_items` (a versioned price list, resolved as "latest
price effective at `placed_at`"). Full definitions for these and every other
table (`bills`, `ledger_entries`, `payment_allocations`, `procurement_*`, etc.)
are in `CLAUDE.md` §4, embedded in full below.

---

## 2. Project source of truth: `CLAUDE.md`

This is the build spec for the whole system — business rules, full schema
sketch, the LLM parser contract, and the screen-by-screen feature list. It is
checked into the repo and is the authoritative reference for *why* the system
behaves the way it does. (The repo's `README.md` is unmodified `create-next-app`
boilerplate and has no project-specific content, so it's omitted here.)

<!-- BEGIN CLAUDE.md -->

# CLAUDE.md — Good Fruit Club Internal Order Management System (Phase 1)

This file is the source of truth for the build. Read it fully before writing any code. When a decision here conflicts with an assumption you'd otherwise make, this file wins. If a user instruction in-session conflicts with this file, ask before proceeding.

---

## 1. What this is

An internal web app (PWA) for Good Fruit Club, a premium hyperlocal fruit delivery business serving Gurgaon. It replaces a manual workflow of WhatsApp order collation, paper packing sheets, and manual billing. Users are a small internal team (~3–6 people): admin (owner + Sunita), a packer, and 2–3 delivery people.

The one primitive of this system is **"paste a WhatsApp message"** — orders, new customers, and daily price lists all enter the system as pasted text that is parsed by an LLM and confirmed by a human.

**Not in Phase 1 (do not build):** WhatsApp Business API (inbound or outbound), offline-first support, route optimization, forecasting/analytics, subscriptions/standing orders, customer-facing tracking pages, 3P delivery integrations.

---

## 2. Stack and conventions

- **Next.js (App Router) on Vercel** + **Supabase** (Postgres, Auth, Realtime, Storage).
- Responsive web app, installable as PWA (manifest + icons + add-to-home-screen). Mobile-first for the Packing and Delivery views; desktop-comfortable for Order Entry and Prices.
- **Auth:** Supabase phone + password login. Accounts are admin-provisioned (no self-serve signup) — the admin creates each staff login directly via the Supabase Admin API, so no SMS provider is required. Roles: `admin`, `packer`, `delivery`. Enforce with Postgres row-level security, not just UI hiding.
- **LLM parsing runs server-side only** (Next.js API route / server action calling the Anthropic API). Never expose the API key client-side.
- Schema changes only via version-controlled Supabase SQL migrations. Never mutate the schema ad hoc.
- Timezone: **Asia/Kolkata everywhere.** Store timestamps as timestamptz; all cutoff logic computes in IST.
- Money: store as `numeric(10,2)` rupees. Weights: `numeric(8,3)` kg. Never floats.
- Write tests for all "money logic": price resolution, delivery-date derivation, bill computation, ledger allocation. These must pass before a slice is considered done.

---

## 3. Core business rules (the logic that must never drift)

### 3.1 Two clocks from one timestamp
Every order has a `placed_at` timestamp (defaults to now at entry; admin can backdate). Two independent derivations from it:

1. **Delivery date:** placed before **10:00 IST** → same-day delivery; at/after 10:00 → next day. This is a *suggestion with human override* — the review screen shows the derived date and allows changing it. The final `delivery_date` is **stored** on the order and never recomputed.
2. **Price lock:** the order's prices come from the **price version active at `placed_at`** (see 3.2). Locked at creation, stored per line item, never recomputed — even if prices change later or the order is edited.

Example: an 11:00 order gets the morning price list and tomorrow's delivery date. A 05:00 order gets the previous evening's price list and today's delivery date.

### 3.2 Price versions
- Prices are published as **versions**: a set of `(product, price_per_unit)` rows with an `effective_from` timestamp. In practice there are two publishes per cycle (previous evening, and ~06:00), never intraday — but the model supports any number.
- A version **carries forward** unchanged items: publishing only needs the items that changed; resolution for any product = the most recent published price with `effective_from <= placed_at`.
- Price publishing is itself a paste-and-parse flow: admin pastes the vendor's price message, LLM parses to `(product, price)` rows, admin reviews and publishes.
- **Guard:** an order line whose product has no resolvable price is flagged at review and cannot proceed to billing until priced. Never silently bill at zero.

### 3.3 Order ≠ bill: weight closes at packing
- The order captures **intent**: product + ordered quantity.
- The bill is computed from **actuals** recorded at packing: actual weight (weight-based products) or actual count (count-based products) × the order's locked unit price.
- Packing must support, per line: enter actual weight/count; **mark unavailable** (drops line from bill); **substitute** (see 3.4); **short-fulfil** (actual < ordered is normal, no special handling — the actual is simply what's billed).

### 3.4 Substitutions
A substituted item was not on the original order, so it has no price lock. It prices at the price version active **at the time the substitution is recorded**, and is visually flagged in the packing review before finalizing. Store `is_substitution = true` and `substituted_for_line_id`.

### 3.5 Order lifecycle
Per-order status enum, in order:
`recorded → packed → dispatched → out_for_delivery → delivered`
plus `cancelled` (allowed until `packed`).

- `dispatched` = the packed order left Paschim Vihar for Gurgaon. It's flipped as a **batch action** ("dispatch today's packed orders") but stored per order, so a late-packed order can miss the batch.
- Procurement is a **day-level activity, not a per-order status.** Do not add a "procured" order status.

### 3.6 Procurement list
For a given delivery date, the procurement view aggregates ordered quantities by product across that day's orders into a **single checklist** — one row per product, with a subtext showing which customers make up that quantity (name + qty each).

Each row has a checkbox: the admin/procurement person checks it off once that item has been conveyed to the vendor. Checking a row snapshots the product's current total quantity; if more of that product gets ordered afterward, the row shows a "+N new" delta badge (still checked, just flagging what's changed since) rather than reverting to unchecked. Unchecking a row clears its snapshot. This is a per-item mechanism — there is no day-level "mark list sent" moment. (Superseded the original base/extras-by-timestamp split; `procurement_marks` is unused by the app but left in the schema.)

### 3.7 Ledger: order-level allocation, not a bare running balance
Customer accounts use a double-entry-lite ledger:
- Finalizing a bill posts a **debit** against that order.
- A payment posts a **credit** with `mode` (`cash` | `upi` | `other`), date, note, and an **allocation to one or more orders**.
- An **advance** is a credit with no allocation yet; it auto-allocates (oldest-unpaid-first) when the next bill finalizes, unless admin allocates manually.
- Every order derives a payment status: `unpaid` / `partial` / `paid` (from sum of allocations vs bill amount). The customer account shows the roll-up and full history.
- Delivery flow: marking an order `delivered` prompts for payment collected (amount + mode, skippable if "pay later"), which posts a credit allocated to that order.

### 3.8 The WhatsApp bill message
- Generated as plain text, sent via a **`wa.me` deep link** pre-filled to the customer's number. No API sending in Phase 1.
- **All customer-facing communication is from Sunita Kapoor's identity. Never any other name.**
- Format: greeting, delivery date, line items (name, actual qty/weight, rate, amount), order total, **previous balance / advance adjustment, net amount due** (carried balance is always shown and adjusted — this is not optional), payment options line. Keep alignment WhatsApp-friendly (short lines, no tables).

### 3.9 Order entry flow (mirror the current habit exactly)
Today the admin copies a customer's WhatsApp message and pastes it into a central chat prefixed with the customer's name. The app replaces that chat:
1. Admin pastes text (customer name prefix + message; for new customers, address/phone are pasted along).
2. Server-side LLM parses → structured draft (see §5 contract).
3. Review screen: customer match confirmed (or "create new customer" inline with parsed address/phone), lines shown with confidence flags — **only flagged lines demand attention**; clean lines pass through.
4. Same-customer pastes for the same delivery date **merge into the existing open order** (append lines), never create duplicates.
5. Save → order is `recorded`, prices locked, delivery date stored.
- Unknown product terms: reviewer maps them to a catalog product; the mapping is saved as an **alias** so it parses automatically next time.

---

## 4. Schema (Supabase migrations — build exactly this shape, extend only additively)

```sql
-- roles handled via profiles
profiles(id uuid pk refs auth.users, full_name text, phone text, role text check in ('admin','packer','delivery'))

customers(
  id uuid pk, display_name text not null,      -- name as used in pastes
  phone text, address text not null,
  zone text not null,                          -- see §6 zone list
  notes text, created_at timestamptz
)

products(
  id uuid pk, name text not null,              -- canonical, e.g. 'Alphonso Mango'
  unit_type text check in ('weight','count'),  -- drives packing input + billing math
  unit_label text,                             -- 'kg', 'dozen', 'piece'
  active boolean default true
)

product_aliases(id uuid pk, product_id refs products, alias text unique)  -- 'hapus' → Alphonso

price_versions(id uuid pk, effective_from timestamptz not null, published_by refs profiles, note text)
price_items(id uuid pk, version_id refs price_versions, product_id refs products,
  price_per_unit numeric(10,2) not null, unique(version_id, product_id))
-- resolution: latest price_item for product across versions where effective_from <= order.placed_at

orders(
  id uuid pk, customer_id refs customers,
  placed_at timestamptz not null, delivery_date date not null,   -- stored, never recomputed
  status text check in ('recorded','packed','dispatched','out_for_delivery','delivered','cancelled'),
  status_timestamps jsonb default '{}',       -- {"packed": "...", "dispatched": "..."}
  raw_paste text,                              -- original pasted message(s), audit trail
  created_by refs profiles, created_at timestamptz
)

order_lines(
  id uuid pk, order_id refs orders, product_id refs products,
  ordered_qty numeric(8,3), ordered_unit text,          -- as parsed
  locked_price_per_unit numeric(10,2),                  -- snapshot at placed_at (or substitution time)
  actual_qty numeric(8,3),                              -- weight or count, entered at packing
  line_status text check in ('pending','packed','unavailable') default 'pending',
  is_substitution boolean default false, substituted_for_line_id uuid null,
  parse_confidence text check in ('clean','flagged'), parse_note text
)

bills(
  id uuid pk, order_id unique refs orders,
  total numeric(10,2) not null,
  prev_balance numeric(10,2) not null,        -- + owed / − advance, snapshot at finalize
  net_due numeric(10,2) not null,
  message_text text,                           -- the exact WhatsApp text generated
  finalized_at timestamptz, finalized_by refs profiles
)

ledger_entries(
  id uuid pk, customer_id refs customers,
  entry_type text check in ('debit','credit'),
  amount numeric(10,2) not null,
  mode text null check in ('cash','upi','other'),   -- credits only
  order_id refs orders null,                        -- debits: always set. credits: null = advance
  note text, entered_by refs profiles, created_at timestamptz
)

payment_allocations(                                 -- splits one credit across orders
  id uuid pk, ledger_entry_id refs ledger_entries, order_id refs orders,
  amount numeric(10,2) not null
)

procurement_marks(id uuid pk, delivery_date date unique, list_sent_at timestamptz, sent_by refs profiles)
-- unused by the app (see §3.6) -- kept, not dropped

procurement_item_checks(                             -- per-item "sent to vendor" checklist state (§3.6)
  id uuid pk, delivery_date date, product_id refs products,
  checked_qty numeric(8,3) not null,                  -- product's total ordered qty snapshotted at check time
  checked_by refs profiles, checked_at timestamptz,
  unique(delivery_date, product_id)
)
```

Derived (queries/views, not stored): customer balance, order payment status, procurement aggregation (per-product totals + contributor breakdown, delta vs `procurement_item_checks.checked_qty`), delivery route list.

---

## 5. LLM parser contract (server-side)

One parsing endpoint, two modes. Prompt lives in a versioned file in the repo (e.g. `lib/prompts/order_parser.md`) — treat it as first-class code. Build a small eval set of real pastes → expected JSON in `tests/parser_cases/` and keep it green.

**Order parse — input:** raw paste + catalog (names + aliases) + customer display names.
**Output (strict JSON, no prose):**
```json
{
  "customer": {"matched_id": "uuid|null", "name_text": "Rita Parkash",
               "is_new": false, "parsed_phone": null, "parsed_address": null,
               "confidence": "clean|flagged"},
  "lines": [
    {"product_id": "uuid|null", "raw_text": "2 dozen kela",
     "qty": 2, "unit": "dozen",
     "confidence": "clean|flagged", "flag_reason": "unknown_product|vague_qty|ambiguous_unit|null"}
  ],
  "notes": "anything unparseable, delivery instructions, etc."
}
```
Rules: never invent products — unknown terms return `product_id: null` + `flagged`. Vague quantities ("some", "thoda") → `flagged` with the raw text preserved. Multiple items in one message → multiple lines. Never drop text: anything not mapped to a line goes to `notes`.

**Price parse — input:** raw vendor price message + catalog. **Output:** `{"items": [{"product_id": "uuid|null", "raw_text": "...", "price": 120, "confidence": "..."}]}` — same flagging rules.

---

## 6. Fixed reference data

**Delivery zone priority (route order, hard-coded):**
DLF Phase 2 (incl. Heritage City, The Vilas) → Sushant Lok → Near Hamilton Court → DLF Phase 1 → Phase 3 → Phase 4 → Phase 5 → Outside Gurgaon.

**Seed data at setup:** the real customer directory (provided separately as CSV), a starter catalog (mango varieties incl. Alphonso/Hapus, Kesar, Dasheri, Langra, Chausa, Safeda; banana by dozen; papaya; kiwi by piece; seasonal others), and 5–6 real order pastes as parser test cases.

---

## 7. Screens (by role)

- **Admin — Order Entry:** paste box → parse → review/confirm (the core screen; optimize ruthlessly for speed).
- **Admin — Prices:** paste vendor list → review → publish version; view active prices.
- **Admin — Procurement:** per delivery date, base list vs extras, "mark list sent to vendor".
- **Packer — Packing queue (mobile-first, shared with Admin):** persistent queue sectioned by status — To Pack / Packed · Ready to Bill / Dropped. Per line on a to-pack order: big numeric input for weight/count, unavailable, substitute → "Pack & Close Order" finalizes the order (`packed`, or auto-`cancelled` if every line ended up unavailable with no substitute). Packing and billing are two separately-triggered steps, not one auto-chain: a packed order sits in "Ready to Bill" until an **admin** opens it, reviews the priced line items (packers never see prices), and taps "Generate Bill →" → bill generates → "Send bill" wa.me button.
- **Admin/all — Status board:** live (Supabase Realtime) list of today's orders with status chips; batch "Dispatch packed orders".
- **Delivery — Route (mobile-first):** today's `dispatched`+ orders in zone-priority order; per stop: address, phone (tap-to-call), bill amount + net due; mark `out_for_delivery` (batch) and `delivered` → payment collected prompt.
- **Admin — Customers & Ledger:** account view per customer: orders, bills, payments, balance; record payment with allocation; record advance.

---

## 8. Build order (vertical slices — deploy each live before the next)

1. Scaffold: Next.js + Supabase + phone+password auth + roles + RLS + Vercel deploy + PWA shell.
2. Catalog + price versions (paste-publish flow). *Pricing gates billing — build first.*
3. Customers (import directory CSV, zones).
4. Order entry: paste → parse → review → save (delivery-date derivation + price lock + merge rule). Parser eval cases green.
5. Procurement view (base vs extras, mark-sent).
6. Packing screen (actuals, unavailable, substitution) → finalize.
7. Bill generation + wa.me send (Sunita identity, carried balance).
8. Ledger (debits on finalize, credits with allocation, advances, payment statuses).
9. Status board (Realtime) + batch dispatch + delivery route view with payment-on-delivery capture.

Definition of done per slice: deployed to Vercel, opened on a phone, exercised with real seed data, money-logic tests passing, committed.

<!-- END CLAUDE.md -->

**Where the actual build currently stands** (as of this writing): slices 1–5 are shipped and deployed; slice 6 (packing) has UI in place; order entry has since been extended beyond the original spec with two admin-side conveniences — batch-pasting multiple customers' messages in one go (split and reviewed as a list), and creating a missing catalog product inline from the review screen instead of requiring an out-of-band fix. Treat this paragraph as a snapshot, not a guarantee — confirm current slice status from `git log` if it matters for your integration.

---

## 3. A real parsed order, as it actually landed in the database

This is an actual saved order (customer PII replaced — see the note at the top
of this document). It shows the full chain: raw WhatsApp text → parser output
→ what's persisted across `customers`, `orders`, and `order_lines`.

**What the admin pasted** (this exact string is what the LLM parser saw, and
is also what's stored verbatim in `orders.raw_paste` for audit):

```
Order 2: Priya

Banarsi Langda Mango: 2074g

Chausa Mango: 1065g
```

**`customers` row** (matched by the parser to an existing customer — this
person had ordered before, so no new-customer creation happened on this
paste):

```json
{
  "id": "d8bf4046-0363-4174-8786-da1d58d9b49c",
  "display_name": "Priya Anand",
  "phone": "9800000001",
  "address": "H-45 Sector 42, Gurugram",
  "zone": "Unassigned",
  "notes": null,
  "created_at": "2026-07-27T19:46:59.671351+00:00"
}
```

Note `zone: "Unassigned"` — this is real, current behavior, not a bug: "Sector
42" doesn't match any of the fixed zone regex patterns (see §4 below), so the
customer correctly falls back to the `'Unassigned'` sentinel rather than being
mis-assigned to a real route zone.

**`orders` row:**

```json
{
  "id": "fb92474f-75ea-4da3-b5be-16416dc637bb",
  "customer_id": "d8bf4046-0363-4174-8786-da1d58d9b49c",
  "placed_at": "2026-08-05T14:09:00+00:00",
  "delivery_date": "2026-08-06",
  "status": "recorded",
  "status_timestamps": {},
  "raw_paste": "Order 2: Priya\n\nBanarsi Langda Mango: 2074g\n\nChausa Mango: 1065g",
  "notes": "Order 2",
  "created_by": "62b83fe8-fdc5-4327-925d-4a26bb480069",
  "created_at": "2026-08-05T14:10:09.48051+00:00"
}
```

`placed_at` is 14:09 UTC = 19:39 IST, which is after the 10:00 IST cutoff (§3.1
of `CLAUDE.md`), so `delivery_date` correctly derived as the *next* day
(2026-08-06). `notes` ("Order 2") is leftover text the parser couldn't map to
a line item — in this case just the admin's own "Order 2" counter from
copy-pasting multiple orders in sequence.

**`order_lines` rows** (two lines, one per fruit; both weight-based, both
clean/unflagged matches):

```json
[
  {
    "id": "2960c6b8-2a5d-4e22-ac2c-c9286a5c066c",
    "order_id": "fb92474f-75ea-4da3-b5be-16416dc637bb",
    "product_id": "7090ccb1-9415-4088-b807-f5499e197f7c",
    "ordered_qty": 2.074,
    "ordered_unit": "kg",
    "locked_price_per_unit": 225,
    "actual_qty": null,
    "line_status": "pending",
    "is_substitution": false,
    "substituted_for_line_id": null,
    "parse_confidence": "clean",
    "parse_note": null
  },
  {
    "id": "d9f298bc-45c2-473e-998b-c06a3755bb24",
    "order_id": "fb92474f-75ea-4da3-b5be-16416dc637bb",
    "product_id": "8e1495ba-a74d-4b98-8918-aae6c93c3b0e",
    "ordered_qty": 1.065,
    "ordered_unit": "kg",
    "locked_price_per_unit": 295,
    "actual_qty": null,
    "line_status": "pending",
    "is_substitution": false,
    "substituted_for_line_id": null,
    "parse_confidence": "clean",
    "parse_note": null
  }
]
```

The referenced `products` rows (for context — `order_lines.product_id` is a
foreign key, not a denormalized name):

```json
[
  { "id": "7090ccb1-9415-4088-b807-f5499e197f7c", "name": "Langra Mango", "unit_type": "weight", "unit_label": "kg" },
  { "id": "8e1495ba-a74d-4b98-8918-aae6c93c3b0e", "name": "Chausa Mango", "unit_type": "weight", "unit_label": "kg" }
]
```

Note "Banarsi Langda Mango" in the raw paste resolved to the canonical
product **"Langra Mango"** — this is `product_aliases` (or the parser's own
fuzzy/alias matching) at work; the LLM never invents a product, it only
matches against the existing catalog + known aliases.

`actual_qty` is `null` and `line_status` is `"pending"` on both lines because
this order hasn't reached packing yet — those fields only populate once a
packer records real weights against the order (§3.3 of `CLAUDE.md`). The bill,
when eventually generated, will use `actual_qty × locked_price_per_unit` per
line, **not** `ordered_qty` — the two are expected to diverge.

---

## 4. Address → zone mapping: yes, it already exists

There is a real, working (if simple) implementation at
`src/lib/customers/zone.ts`. It is a **static keyword/regex classifier**
against the fixed 8-zone list from `CLAUDE.md` §6 — not a geocoding API, not
ML, not configurable at runtime. Full source:

```ts
// Fixed delivery zone priority per CLAUDE.md §6. Order matters -- it's the
// route order delivery staff work through. "Unassigned" is a sentinel for
// addresses that couldn't be matched to a real zone (see 0004_customers.sql)
// and must never be treated as a real route stop, so it deliberately isn't
// part of ZONE_ORDER.

export const ZONE_ORDER = [
  "DLF Phase 2",
  "Sushant Lok",
  "Near Hamilton Court",
  "DLF Phase 1",
  "Phase 3",
  "Phase 4",
  "Phase 5",
  "Outside Gurgaon",
] as const;

export type RealZone = (typeof ZONE_ORDER)[number];
export type Zone = RealZone | "Unassigned";

const ZONE_PATTERNS: [RegExp, RealZone][] = [
  [/heritage city|the vilas|dlf[\s-]*phase[\s-]*2\b|dlf[\s-]*2\b/, "DLF Phase 2"],
  [/sushant lok/, "Sushant Lok"],
  [/hamilton court/, "Near Hamilton Court"],
  [/dlf[\s-]*phase[\s-]*1\b|dlf[\s-]*1\b|dlf[\s-]*i\b/, "DLF Phase 1"],
  [/dlf[\s-]*phase[\s-]*3\b|dlf[\s-]*3\b/, "Phase 3"],
  [/dlf[\s-]*phase[\s-]*4\b|dlf[\s-]*4\b/, "Phase 4"],
  [/dlf[\s-]*phase[\s-]*5\b|dlf[\s-]*5\b/, "Phase 5"],
];

export function deriveZoneFromAddress(address: string): Zone {
  const normalized = address.toLowerCase();
  for (const [pattern, zone] of ZONE_PATTERNS) {
    if (pattern.test(normalized)) return zone;
  }
  return "Unassigned";
}

export function zonePriority(zone: Zone): number {
  const index = ZONE_ORDER.indexOf(zone as RealZone);
  return index === -1 ? ZONE_ORDER.length : index;
}

export function compareByZone(a: Zone, b: Zone): number {
  return zonePriority(a) - zonePriority(b);
}
```

Key characteristics for an integrating system to know:
- **Coverage is narrow by design.** Only strings containing "DLF Phase N" (plus
  the two named-society aliases "Heritage City"/"The Vilas" → DLF Phase 2, and
  "Sushant Lok"/"Hamilton Court") resolve to a real zone. Everything else —
  including addresses that are clearly in Gurgaon but phrased differently
  (e.g. "Sector 42", "Golf Course Road", "Palam Vihar") — falls through to
  `'Unassigned'`. There is no `'Outside Gurgaon'` auto-detection either,
  despite it being a valid zone value; it appears to be admin-assigned only
  (no pattern maps to it in the code above).
- **It runs once, at customer-creation time** (`deriveZoneFromAddress` is
  called from the order-entry "new customer" flow and the CSV import script),
  and the result is stored on `customers.zone` — it is not re-derived later if
  the address is edited.
- **`zonePriority`/`compareByZone`** are what actually drive the delivery
  route ordering (§7 of `CLAUDE.md`, the Delivery — Route screen) — stops are
  sorted by this fixed priority list, `'Unassigned'` sorting last (its index
  lookup misses `ZONE_ORDER` and falls back to `ZONE_ORDER.length`).
- If an engagement engine needs better zone coverage (e.g. to target
  campaigns by neighborhood), this function is the integration point to
  either extend the regex list or replace with a real geocoder — there is
  currently no other zone-resolution path anywhere in the codebase.
