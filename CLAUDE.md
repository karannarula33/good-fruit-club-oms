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
For a given delivery date, the procurement view aggregates ordered quantities by product across that day's orders, split into two buckets:
1. **Base list** — orders placed before the previous evening's send-to-vendor moment (admin presses "mark list sent to vendor", which timestamps the split).
2. **Extras** — orders placed after that moment (the morning same-day orders). Shown separately so admin can convey only the delta to the vendor.

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
```

Derived (queries/views, not stored): customer balance, order payment status, procurement aggregation (base vs extras via `procurement_marks.list_sent_at`), delivery route list.

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
