# CLAUDE.md — Customer Engagement Engine
### Good Fruit Club OMS · additive module · daily nudge intelligence

**Purpose.** A daily, read-mostly module inside the existing OMS. Every day it re-evaluates every customer purely from their order history, classifies each into an engagement state, and produces a prioritised, human-readable list of who to reach out to, why, and with a drafted message. A human (admin) reviews and relays. Nothing sends automatically.

**This is an additive module.** It introduces only new tables (all prefixed `eng_`) and reads existing ones. It must not alter `customers`, `orders`, `order_lines`, or any billing/ledger table. Extend only additively, via versioned Supabase migrations, exactly as the base `CLAUDE.md` §2 requires.

**Sole approver:** admin (Karan). **Sending in v1:** relay only — the queue drafts and marks ready; the message is sent by hand from Sunita's phone. No WhatsApp API. (Consistent with base `CLAUDE.md` §1 "not in Phase 1: WhatsApp Business API outbound" and §3.8 "all customer-facing communication is from Sunita Kapoor's identity.")

---

## 0. Design principles (read before implementing)

1. **Daily evaluation is unconditional and anchored on order data, never on nudge history.** Every day, every customer's state is recomputed from `orders`/`order_lines` alone. Whether or when they were last nudged does **not** decide whether they're evaluated or surfaced — it only *modulates the recommended action* for a customer the order data has already flagged (see §7). A customer nudged yesterday who is still `breaking` today is still surfaced today; the system just escalates or suppresses the *action*, it does not hide the *customer*.
2. **Rules decide WHO and WHY (deterministic SQL). The model decides WHAT to say (Claude).** Classification, prioritisation, and action selection are pure SQL — auditable and tunable via a config table. Only message drafting uses the Anthropic API (server-side only, per base `CLAUDE.md` §2).
3. **No manual logging, ever.** Outcomes (did they reorder after a nudge?) are derived by re-reading `orders` on later runs. The only human actions are approve / edit / skip in the queue.
4. **Every nudge carries a one-sentence human rationale.** If it reads as a stretch, the threshold is miscalibrated — fix the rule, don't send the message.
5. **Everything is relative to each customer's own rhythm.** The `severity_ratio` (days silent ÷ that customer's own median inter-order gap) is the core field. A 2-day-cadence customer silent 14 days is a crisis; a 16-day-cadence customer silent 14 days is fine. Fixed calendar thresholds misprioritise every time — this was the single biggest lesson from the manual analysis.

---

## 1. How to read money and orders from the real schema

The base schema has no denormalized revenue and enforces order≠bill (base `CLAUDE.md` §3.3). The engine must therefore compute value carefully:

- **An "order" = one `orders` row.** Reorder recency and cadence key off `orders.placed_at` (timestamptz, IST) — **not** `delivery_date`, and **not** `bills`.
- **Line value = `coalesce(actual_qty, ordered_qty) × locked_price_per_unit`.** Recent orders won't be packed yet (`actual_qty` null, `line_status='pending'`), so fall back to `ordered_qty`. Lines with null `locked_price_per_unit` contribute 0 to value (unpriced — base §3.2) but still count as order activity.
- **Order value = sum of its line values.** **Customer revenue / LTV = sum across their orders.**
- **Exclude `orders.status = 'cancelled'`** from all state, cadence, and value math.
- **Gross profit is not directly stored.** `order_lines` has `locked_price_per_unit` but no locked COGS. For v1, GP-based ranking uses **revenue as the ranking proxy** (not true GP). If a locked-COGS column is later added to `order_lines`, switch `eng_customer_state.value_contribution` to true GP. Until then, name the field honestly: it's revenue, not margin.
- **Favourite fruits** = join `order_lines.product_id → products.name`, count line frequency per customer, take top 3. Note aliases already resolve to canonical `products.name` at parse time (e.g. "Banarsi Langda" → "Langra Mango"), so grouping by `product_id`/`products.name` is clean.
- **`zone`** is read directly from `customers.zone` (already computed, fixed enum incl. `'Unassigned'`). Treat `'Unassigned'` as a real value, never as missing. Do not re-derive zones.
- **Phone** is `customers.phone` (nullable — a customer may have none; the relay step then has no number, so such a customer can still be surfaced but flagged "no phone on file").

---

## 2. New tables (all `eng_`-prefixed, additive migration)

```sql
-- Recomputed in full each run; one row per customer.
create table public.eng_customer_state (
  customer_id          uuid primary key references public.customers(id),
  computed_at           timestamptz not null,
  order_count            int not null,
  first_order_at          timestamptz,
  last_order_at            timestamptz,
  days_since_last           int,
  expected_gap_days          numeric,     -- own median inter-order gap; cohort default if <2 orders
  severity_ratio              numeric,     -- days_since_last / expected_gap_days
  revenue                      numeric,     -- lifetime, per §1 (proxy for value; not GP)
  revenue_percentile            numeric,     -- 0..1 across all customers
  is_vip                         boolean,     -- revenue_percentile >= config VIP_PERCENTILE
  aov                             numeric,
  favourite_products               text[],     -- top 3 canonical product names
  last_order_products               text[],
  state                              text not null,
  previous_state                      text,
  state_changed_at                     timestamptz
);

-- One row per candidate nudge, created each run for currently-triggered customers.
create table public.eng_nudge_queue (
  id                 uuid primary key default gen_random_uuid(),
  run_date            date not null,
  customer_id          uuid not null references public.customers(id),
  trigger_type          text not null,   -- see §4
  recommended_action     text not null,   -- 'message' | 'call' | 'skip_no_phone' (see §7)
  priority_score          numeric not null,
  rationale                text not null,  -- one human sentence, shown in queue
  draft_message             text,           -- null for 'call'
  draft_rationale            text,           -- one line: why the model chose this wording
  status                      text not null default 'pending',
                              -- pending | approved | edited | relayed | skipped | snoozed | expired
  final_message                text,
  snooze_until                  date,
  created_at                     timestamptz not null default now(),
  reviewed_at                     timestamptz,
  relayed_at                       timestamptz     -- set when admin marks it sent-by-hand
);

-- Auto-derived on later runs by re-reading orders. NO manual entry.
create table public.eng_nudge_outcomes (
  nudge_id             uuid primary key references public.eng_nudge_queue(id),
  relayed_at            timestamptz,
  reordered_within_7d    boolean,
  reordered_within_14d    boolean,
  reorder_order_id         uuid references public.orders(id),
  days_to_reorder           int,
  evaluated_at               timestamptz
);

create table public.eng_suppression (
  customer_id   uuid references public.customers(id),
  reason          text not null,   -- 'complaint' | 'requested_no_contact' | 'two_unanswered'
  added_at         timestamptz default now(),
  expires_at        timestamptz,   -- null = indefinite
  primary key (customer_id, reason)
);

create table public.eng_config (
  key text primary key,
  value numeric not null,
  updated_at timestamptz default now()
);
```

**RLS:** enable on all five. `select` for any authenticated role with a role (`public.has_role()`); all writes `admin`-only (`public.is_admin()`), matching the base app's pattern. The nightly job runs as the **service role** (bypasses RLS) since it's a server-side scheduled task, exactly like the LLM parser routes.

**Seed `eng_config`** with the constants in §3.

---

## 3. Config constants (derived from 63 days real data: 490 orders, 131 customers)

```
VIP_PERCENTILE               0.90    -- top-decile lifetime revenue
MEDIAN_REORDER_GAP_DAYS      6.7     -- reference only
COHORT_DEFAULT_GAP_DAYS      14      -- expected gap for a 1-order customer
SECOND_ORDER_GRACE_DAYS      9       -- 1-order customer flagged if silent past this
THIRD_ORDER_GRACE_DAYS       9       -- 2-order customer flagged if silent past this
DRIFT_SEVERITY_LOW           1.5
DRIFT_SEVERITY_MID           2.0
DRIFT_SEVERITY_HIGH          3.5
LAPSED_ABSOLUTE_DAYS         30
VIP_CHECKIN_INTERVAL_DAYS    10
FREQUENCY_CAP_DAYS           10      -- min days between nudges to one customer
UNANSWERED_COOLDOWN_COUNT    2       -- N unanswered nudges -> cooldown
UNANSWERED_COOLDOWN_DAYS     30
CALL_ESCALATION_ENABLED      1       -- lapsed becomes 'call' only after an unanswered message
```

All tunable without code changes. §12 revisits them once outcome data accrues.

---

## 4. States & classification (pure SQL, from order data only)

```
expected_gap_days =
    order_count >= 2 : median(days between consecutive placed_at, cancelled excluded)
    order_count == 1 : COHORT_DEFAULT_GAP_DAYS
severity_ratio = days_since_last / expected_gap_days
is_vip = revenue_percentile >= VIP_PERCENTILE

classify():
  order_count == 0                                            -> 'prospect'
  order_count == 1 and days_since_last <  SECOND_ORDER_GRACE  -> 'first_timer'
  order_count == 1 and days_since_last >= SECOND_ORDER_GRACE  -> 'second_order_risk'
  order_count == 2 and days_since_last >= THIRD_ORDER_GRACE
        and days_since_last < LAPSED_ABSOLUTE_DAYS
        and severity_ratio < DRIFT_SEVERITY_HIGH              -> 'third_order_risk'
  days_since_last >= LAPSED_ABSOLUTE_DAYS
        or severity_ratio >= DRIFT_SEVERITY_HIGH              -> 'lapsed'
  severity_ratio >= DRIFT_SEVERITY_MID                        -> 'breaking'
  severity_ratio >= DRIFT_SEVERITY_LOW                        -> 'drifting'
  else                                                        -> 'habituated'

vip_checkin flag (parallel): is_vip and state=='habituated' and days_since_last >= VIP_CHECKIN_INTERVAL_DAYS
```

| State | Meaning | Base action (before §7 modulation) |
|---|---|---|
| `prospect` | 0 orders | none (acquisition, out of scope) |
| `first_timer` | 1 order, within grace | none |
| `second_order_risk` | 1 order, silent past day 9 | message — warmest, most exploratory |
| `third_order_risk` | 2 orders, silent past day 9 | message — the known leak: ~78% reach order 2, only ~33% reach order 3 |
| `habituated` | 3+ orders, on rhythm | none (unless `vip_checkin`) |
| `drifting` | 1.5–2.0× own gap | message — soft |
| `breaking` | 2.0–3.5× own gap | message — warm, personal |
| `lapsed` | ≥3.5× own gap, or ≥30 days | message (call only as escalation — §7) |
| `vip_checkin` | VIP, on-rhythm, silent ≥10d | message — proactive, no ask required |

---

## 5. Nightly pipeline (one scheduled server job)

```
STEP 1  RECOMPUTE STATE  (unconditional — every customer, every day)
  From orders + order_lines (cancelled excluded), compute per §1 and §4.
  Upsert eng_customer_state. Carry previous_state; set state_changed_at on change.

STEP 2  EVALUATE PAST OUTCOMES  (replaces all manual tracking)
  For each eng_nudge_queue row with status='relayed', no outcome row, relayed 7+ days ago:
    find any non-cancelled order by that customer with placed_at within 7d / 14d of relayed_at.
    write eng_nudge_outcomes. This is the only source of "did nudges work".

STEP 3  GENERATE CANDIDATES  (order-data driven; nudge history only modulates action)
  For every customer whose state (or vip_checkin flag) has a trigger (§4):
    - determine recommended_action via §7 (this is where nudge history enters).
    - apply suppression (§6). Suppressed -> no candidate.
    - one candidate per customer; if multiple triggers, highest priority (§8) wins.

STEP 4  DRAFT  (Claude, server-side)
  For recommended_action='message', call the draft agent (§9) -> draft_message + draft_rationale.
  'call' and 'skip_no_phone' get rationale only, no draft.

STEP 5  QUEUE
  Insert candidates into eng_nudge_queue (status='pending'), plus the daily summary (§10).
```

Nothing sends. The queue waits for admin review.

---

## 6. Suppression (checked before a candidate is created)

Skip if ANY holds:
- Row in `eng_suppression`, not expired.
- ≥ `UNANSWERED_COOLDOWN_COUNT` relayed nudges with no reorder in the trailing 60 days → auto-insert `two_unanswered` (30-day expiry), skip.
- A nudge relayed to this customer within `FREQUENCY_CAP_DAYS` → skip (this is the *action* frequency cap; the customer is still evaluated and, if you want visibility, may still appear in the summary counts — but no new queue card).
- An open complaint / quality issue, **if** such a signal exists in the OMS. (None exists in the base schema today — `orders.notes` is free text. For v1, `complaint` suppression is manual-insert only; do not attempt to infer complaints from notes.)

---

## 7. Recommended-action selection — where nudge history enters (and only here)

The customer is already surfaced by order data. This step decides the *action*, taking prior nudges as one input. It never un-surfaces a customer.

```
base_action = table in §4 (message for most; message for lapsed by default)

modulate(base_action, customer):
  if customer.phone is null:
      return 'skip_no_phone'                 -- surface with rationale, but nothing to relay

  # Lapsed escalation: a call is intrusive as a FIRST touch, appropriate as a SECOND.
  if state == 'lapsed' and CALL_ESCALATION_ENABLED:
      if a message was relayed in the last 21 days with no reorder:
          return 'call'                       -- text didn't land; a human voice is now warranted
      else:
          return 'message'                    -- default lapsed to a warm re-opening message

  # General escalation for repeat non-response on active states:
  if last relayed nudge to this customer had no reorder within 14d
     and current state in ('breaking','lapsed'):
      annotate rationale with "(follow-up — prior message unanswered)"
      # tone shifts, not channel; the draft agent is told this is a second touch

  return base_action
```

The essential property: **state comes from orders; action comes from state + nudge history.** A customer nudged yesterday and still `breaking` today reappears today — either suppressed by the frequency cap (no card, but counted) or, if past the cap, escalated. They are never simply hidden because "we already messaged them."

---

## 8. Prioritisation

```
priority_score = base(trigger) + (revenue_percentile * 20)
  base:  lapsed (vip) 100 · lapsed 90 · breaking 70 · third_order_risk 65
       · second_order_risk 55 · vip_checkin 50 · drifting 40
```
Queue sorts by `priority_score` desc. Revenue percentile lifts higher-value customers within their tier.

---

## 9. Draft agent (the only LLM component)

Server-side Anthropic call, per `message` candidate. Prompt lives in a versioned repo file (`lib/prompts/nudge_drafter.md`), first-class code like the order parser (base `CLAUDE.md` §5). Keep a small eval set of input→expected-tone examples.

### Input
```json
{
  "customer_name": "Annu Sethi",
  "zone": "Sushant Lok",
  "trigger_type": "breaking",
  "is_followup": false,
  "rationale": "Orders every 3.5d on average; silent 14d (4.0x her normal gap).",
  "order_count": 7,
  "last_order_products": ["Afghan Cherry", "Chausa Mango"],
  "favourite_products": ["Afghan Cherry", "Chausa Mango", "Jamun"],
  "todays_catalogue_highlights": ["Pomegranate", "Muscat Grapes"],
  "seasonal_note": "Cherry season ending soon; festive gift boxes and Turkish cherries newly launched"
}
```

### System prompt (the tone contract — templates in §11 are the reference)
```
You draft a WhatsApp message on behalf of Sunita, who runs Good Fruit Club personally.
Every customer believes she is texting them herself.

Hard rules:
- 2-4 sentences. WhatsApp, not email.
- Reference something specific and TRUE from this customer's own history — a product they
  actually ordered. Never a generic favourite. Never invent a fact not in the input.
- Never mention days-since-order, tracking, algorithms, or "we noticed you've been away."
  Sunita simply thought of them.
- If order_count >= 3, you MAY use the order-count as genuine appreciation ("with 7 orders,
  you've been a lovely part of our journey") — this is the strongest personalisation lever.
- trigger_type second_order_risk / third_order_risk: warm, curious, low-pressure; end with an
  explicit "no worries either way." They've ordered once or twice; remove friction, don't push.
- trigger_type drifting / breaking: warmer, relationship-led; established customers.
- trigger_type lapsed: warm re-opening; acknowledge time has passed gently, no specifics; give
  MORE room, not less; new arrivals / gift boxes / Turkish cherries fit naturally as genuine news.
- trigger_type vip_checkin: a genuine "thinking of you, X is beautiful right now" with NO ask is fine.
- is_followup true: this is a second touch after an unanswered message — lighter, no repetition,
  do not restate the prior message.
- Gift boxes / Turkish cherries: optional garnish, only where it fits; never force an upsell,
  especially for second_order_risk (they barely know us yet).
- Sunita's voice: warm, brief, plain words, at most one emoji, at most one exclamation mark.

Output exactly:
1. draft_message
2. draft_rationale — one line on the specific choice made (for admin, not the customer).
```

**Why not a template string:** templated messages are detectable as automation within one message and would erode the belief that a real person picks the fruit — the core of the business and the reason all comms are from Sunita's identity (base §3.8). Drafting must read as ten seconds of genuine thought about that specific person.

---

## 10. Output — the daily queue (admin morning view)

A priority-sorted list, rationale first (judge each in ~2 seconds), then the draft, then one-tap actions. This is a decision-support surface, not an automation — relay is by hand.

```
Daily summary header (computed each run):
  Today: 6 lapsed · 14 breaking · 9 third-order · 6 drifting · 29 second-order.
  State shifts since yesterday: +3 breaking, 1 recovered to habituated, 2 newly lapsed.
  Last week's nudges: 17 relayed -> 9 reordered within 7d (53%).   <- auto from eng_nudge_outcomes
```

```
┌──────────────────────────────────────────────────────────────┐
│ 🟠 BREAKING · Annu Sethi · Sushant Lok · ₹10,061 · 4.0x       │
│ Orders every 3.5d, silent 14d.                                 │
│ "Hi Annu! Hope you've been keeping well 😊 With 7 orders       │
│  you've been such a lovely part of our journey — the           │
│  pomegranates are especially good this week, thought of you."   │
│ why: bridged her cadence to what's fresh now; used order-count. │
│ [Relay (mark sent)] [Edit] [Skip] [Snooze 3d]                  │
├──────────────────────────────────────────────────────────────┤
│ 📞 CALL (follow-up) · Vijay Khanna · Phase 1 · ₹2,815 · 8.5x  │
│ Orders every 2d, silent 17d. Prior message went unanswered.    │
│ No draft — a call is the right second touch here.              │
│ [Mark called] [Skip] [Snooze]                                  │
└──────────────────────────────────────────────────────────────┘
```

Actions: **Relay** → `status='relayed'`, `relayed_at=now` (admin then sends from Sunita's phone; outcome auto-tracked from `orders`). **Edit** → writes `final_message`, `status='edited'`→`relayed`. **Skip** → `skipped` (a trigger skipped repeatedly ⇒ miscalibrated rule, revisit §3). **Snooze** → set `snooze_until`, re-surface then.

---

## 11. Message templates (reference for the draft agent's tone)

The agent generates per-customer; these are the shapes it targets. (Full worked examples maintained in `lib/prompts/nudge_drafter.md`.)

- **second_order_risk** — friendly, no milestone (they've ordered once), explicit "no worries either way." *"Hi there! 🥭 Just a quick check-in from Good Fruit Club. We've a beautiful new batch in and wanted to share our handpicked picks. If your fruit bowl's running low, just say the word — if you're all set, absolutely no worries!"*
- **third_order_risk** — light, curious, reference their prior order if known, zero pressure.
- **drifting** — barely-outreach, a friendly aside; one genuine specific detail.
- **breaking** — warm, relationship-led; order-count milestone where ≥3; new arrivals fit.
- **lapsed** — warm re-opening; acknowledge time gently; more room, not less; gift boxes / Turkish cherries as genuine news. Escalates to a **call** only if this message goes unanswered (§7).
- **vip_checkin** — "thinking of you, X is lovely right now"; no ask required.

---

## 12. Historical order import (one-time seed, run before the engine's first STEP 1)

The engine needs real order history for cadence, severity, revenue, and favourite-product personalisation. Going forward all orders enter via the live OMS; everything **before the go-live cutoff** comes from a one-time seed of the existing order sheet. The goal is for the OMS to be the single source of truth, so this seed captures **complete order + line detail**, not a reduced subset — the same shape a live order would have, just flagged as historical.

### 12.1 Principle

- Import each historical order as a full `orders` row plus one `order_lines` row per fruit, populating every column a live order would have that is knowable from the sheet.
- **Do NOT** generate `bills`, `ledger_entries`, or `payment_allocations` for historical orders. Those are financial records; back-dating them would contaminate real accounting. Historical orders are complete at the order/line level and stop there. (If historical financials are ever wanted, that is a separate, explicit decision — not this seed.)
- Every imported row is **flagged** so it is always distinguishable from live OMS data and excludable from financial reporting.

### 12.2 Prerequisites (one-time, manual)

1. **Product alias map** — historical fruit name → catalog `products.id`. ~30–40 fruits. Reuse/extend the existing `product_aliases` mechanism so these aliases also help the live parser later (e.g. "Banarsi Langda" → "Langra Mango", "Jumbo Blueberry" → canonical blueberry product). Any fruit not in the catalog gets a catalog product created first (the base app already supports inline product creation).
2. **Customer match** — the directory is already seeded (base slice 3). Match each historical order's customer by phone first, then by `display_name`. Unmatched → create the customer (with `deriveZoneFromAddress`), or map to an existing row if it's a known alias/duplicate.
3. **Go-live cutoff date** — the date on/after which orders are recorded live in the OMS. The seed imports strictly **before** this date; live entry owns everything on/after. This prevents double-counting the overlap. Pick it explicitly and pass it to the script.

### 12.3 Field mapping (per historical order)

`orders`:
```
customer_id        -> matched/created customer
placed_at          -> the order's date from the sheet, at a fixed IST time (e.g. 09:00 IST).
                      Cadence math only needs the date; a fixed time keeps it deterministic.
delivery_date      -> same date as placed_at (historical; exact delivery date is unknown and
                      irrelevant to the engine).
status             -> 'delivered'  (all historical orders are complete/in the past)
status_timestamps  -> {"delivered": <placed_at>}   (best-effort; optional)
raw_paste          -> the original sheet text for that order if available, else null
notes              -> preserve any order-level note from the sheet; append a marker (see flag below)
is_historical      -> true          <-- NEW additive column, see 12.4
created_by         -> null (or a dedicated 'import' service profile if one is made)
created_at         -> now() (actual import timestamp; do not fake it)
```

`order_lines` (one per fruit, capturing complete detail):
```
product_id             -> via alias map (12.2). Never invent; unmatched blocks the row for review.
ordered_qty            -> quantity from the sheet, in kg (weight) or pieces/boxes (count)
ordered_unit           -> 'kg' | 'pc' | 'box' etc., matching the product's unit_type
locked_price_per_unit  -> the historical sell price from the sheet for that date/fruit
actual_qty             -> SET EQUAL TO ordered_qty  (so value math is correct and the order
                          reads as fulfilled, not pending)
line_status            -> 'packed'   (historical orders were fulfilled)
is_substitution        -> false
parse_confidence       -> 'clean'    (human-curated sheet data)
parse_note             -> null
```

If the sheet has COGS per line and a locked-COGS column exists on `order_lines` by import time, populate it — that unlocks true-GP ranking (§1, §13.1) retroactively. If no such column exists yet, skip it.

### 12.4 The historical flag (additive migration, ships with this module)

```sql
alter table public.orders add column if not exists is_historical boolean not null default false;
```

- All real/live orders keep the default `false`.
- The seed sets `true`.
- **The engine reads historical and live orders identically** — `is_historical` never changes state/cadence/value math. It exists purely so financial reporting, bills, and any future accounting can exclude pre-OMS data with a single predicate. Do not filter it out of the engagement engine.

### 12.5 Seed script shape (`scripts/import_historical_orders.ts`, run once)

```
INPUT:  the order sheet exported to CSV/JSON (line-level: date, customer, fruit, qty, unit,
        sell_price, [cogs]), + the product alias map, + the go-live cutoff date.

FOR each historical order (group sheet rows by customer + date, before cutoff):
  1. resolve customer (phone -> name -> create). record zone via deriveZoneFromAddress.
  2. insert orders row per 12.3 (is_historical = true, status = 'delivered').
  3. FOR each fruit line in that order:
       resolve product_id via alias map; if unmatched, collect to an unresolved report
         and SKIP the whole order (do not import partial) — fix aliases, re-run idempotently.
       insert order_lines row per 12.3 (actual_qty = ordered_qty, line_status = 'packed').
  4. do NOT create bills / ledger / allocations.

IDEMPOTENCY: safe to re-run. Key on (customer_id, placed_at::date, sorted line fingerprint)
  or a dedicated import_batch tag, so a second run does not duplicate. Prefer: wrap in a
  transaction, and/or delete-where-is_historical before re-import during setup.

OUTPUT: summary — orders imported, lines imported, customers created, unresolved products
  (with counts) for alias fixes, orders skipped pending resolution.

AFTER a clean run: execute the engine's STEP 1 once to backfill eng_customer_state from full history.
```

Run this as part of setup, **after** catalog + customers exist (base slices 2–3) and **after** the `eng_` migration, but **before** the engine's first nightly run. It is the customer-CSV-import pattern (base slice 3) extended from customers to orders.

---

## 13. Build order (vertical slices, each usable before the next)

0. **Historical import (§12).** The `is_historical` migration + the one-time seed script, run after catalog/customers exist. Backfills full order history so the engine has real cadence and favourites from day one. Do this before slice 1's first run.
1. **`eng_config` + `eng_customer_state` + STEP 1** (nightly state recompute) + a read-only admin view sorted by priority. **Immediately useful on its own** — it replaces every manual severity-sort done to date, with zero drafting or queue.
2. **STEP 2 + `eng_nudge_outcomes`** — the self-tracking loop, built before any drafting so outcome data starts accruing early.
3. **`eng_nudge_queue` + STEP 3 + STEP 5** for two triggers only (`breaking`, `third_order_risk`) — rationale-only cards, no drafts yet. Validates the WHO/WHY.
4. **Draft agent (STEP 4, §9)** for those two triggers; admin reviews and relays.
5. **Remaining triggers** (`second_order_risk`, `drifting`, `lapsed`, `vip_checkin`) + suppression (§6) + action modulation (§7).
6. **Tune §3 constants** from the outcome data STEP 2 has accumulated.

Definition of done per slice (mirroring base `CLAUDE.md` §8): deployed, opened on a phone, exercised with real data, committed. State/severity math is "money logic" — unit-test it (median gap, severity ratio, value fallback `actual_qty`→`ordered_qty`, cancelled exclusion) before a slice counts as done.

---

## 14. Open items / decisions

1. **True GP ranking** needs a locked-COGS column on `order_lines` (not in base schema). Until then, ranking uses revenue and is named as such (§1). If that column is added before the historical import runs, the seed (§12.3) can backfill COGS and unlock GP ranking retroactively.
2. **Complaint suppression** has no automatic signal in the base schema; v1 is manual-insert only (§6). If a structured complaint/quality flag is later added to `orders`, wire it into suppression.
3. **`'Unassigned'` and no-phone customers** are surfaced but flagged; decide whether to show them in the main queue or a separate "needs data cleanup" tray.
4. **Scheduling:** the nightly job needs a trigger (Vercel Cron or Supabase scheduled function) running as service role in IST. Confirm which the deployment prefers.
5. **`todays_catalogue_highlights` / `seasonal_note`** for the draft agent should read from the active price version / a small admin-set field, so "what's fresh" is real. Wire to the existing price-version data rather than hardcoding.
```
