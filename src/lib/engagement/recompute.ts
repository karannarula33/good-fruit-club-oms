// CLAUDE_engagement_engine_FINAL.md §5 STEP 1: unconditional daily
// eng_customer_state recompute for every customer, from orders/order_lines
// alone. Shared between the admin-triggered server action and the Vercel
// Cron route so there's exactly one code path that writes this table.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { buildEngagementConfig } from "./config";
import { computeCustomerState, lineValue, type EngagementOrderInput } from "./classify";
import { attachRevenuePercentiles } from "./priority";

type Client = SupabaseClient<Database>;

export interface RecomputeSummary {
  customersProcessed: number;
  stateCounts: Record<string, number>;
}

export async function runEngagementRecompute(supabase: Client): Promise<RecomputeSummary> {
  const now = new Date();

  const [{ data: configRows, error: configError }, { data: customers, error: customersError }] = await Promise.all([
    supabase.from("eng_config").select("key, value"),
    supabase.from("customers").select("id"),
  ]);
  if (configError) throw new Error(`Failed to load eng_config: ${configError.message}`);
  if (customersError) throw new Error(`Failed to load customers: ${customersError.message}`);

  const config = buildEngagementConfig(configRows ?? []);

  // §1: order-level activity keys off placed_at, excludes cancelled orders.
  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id, customer_id, placed_at")
    .neq("status", "cancelled");
  if (ordersError) throw new Error(`Failed to load orders: ${ordersError.message}`);

  // Chunked: a single .in() with 500+ UUIDs blows the request URL length
  // limit (each id is ~37 chars once URL-encoded) once order history grows,
  // e.g. after the historical import. Same CHUNK size as the import script's
  // writes for consistency.
  const orderIds = (orders ?? []).map((o) => o.id);
  const FETCH_CHUNK = 200;
  const lines: { order_id: string; product_id: string | null; ordered_qty: number | null; actual_qty: number | null; locked_price_per_unit: number | null }[] = [];
  for (let i = 0; i < orderIds.length; i += FETCH_CHUNK) {
    const { data, error } = await supabase
      .from("order_lines")
      .select("order_id, product_id, ordered_qty, actual_qty, locked_price_per_unit")
      .in("order_id", orderIds.slice(i, i + FETCH_CHUNK));
    if (error) throw new Error(`Failed to load order_lines chunk ${i}: ${error.message}`);
    lines.push(...(data ?? []));
  }

  const { data: products, error: productsError } = await supabase.from("products").select("id, name");
  if (productsError) throw new Error(`Failed to load products: ${productsError.message}`);
  const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]));

  const { data: existingStates, error: existingError } = await supabase
    .from("eng_customer_state")
    .select("customer_id, state, state_changed_at");
  if (existingError) throw new Error(`Failed to load eng_customer_state: ${existingError.message}`);
  const previousByCustomer = new Map((existingStates ?? []).map((s) => [s.customer_id, s]));

  // §1: line value = coalesce(actual_qty, ordered_qty) x locked_price_per_unit,
  // grouped by order, grouped by customer.
  const linesByOrder = new Map<string, EngagementOrderInput["lines"]>();
  for (const line of lines) {
    const productName = line.product_id ? productNameById.get(line.product_id) : undefined;
    if (!productName) continue; // product deleted/unresolved -- exclude from favourites/value, not fatal
    const value = lineValue(line.actual_qty, line.ordered_qty, line.locked_price_per_unit);
    const bucket = linesByOrder.get(line.order_id) ?? [];
    bucket.push({ productName, value });
    linesByOrder.set(line.order_id, bucket);
  }

  const ordersByCustomer = new Map<string, EngagementOrderInput[]>();
  for (const order of orders ?? []) {
    const bucket = ordersByCustomer.get(order.customer_id) ?? [];
    bucket.push({ placedAt: new Date(order.placed_at), lines: linesByOrder.get(order.id) ?? [] });
    ordersByCustomer.set(order.customer_id, bucket);
  }

  const perCustomer = (customers ?? []).map((customer) => {
    const computed = computeCustomerState(ordersByCustomer.get(customer.id) ?? [], config, now);
    return { customerId: customer.id, ...computed };
  });

  const withPercentiles = attachRevenuePercentiles(perCustomer, config);

  const rows = withPercentiles.map((c) => {
    const previous = previousByCustomer.get(c.customerId);
    const stateChanged = !previous || previous.state !== c.state;
    return {
      customer_id: c.customerId,
      computed_at: now.toISOString(),
      order_count: c.orderCount,
      first_order_at: c.firstOrderAt?.toISOString() ?? null,
      last_order_at: c.lastOrderAt?.toISOString() ?? null,
      days_since_last: c.daysSinceLast,
      expected_gap_days: c.expectedGapDays,
      severity_ratio: c.severityRatio,
      revenue: c.revenue,
      revenue_percentile: c.revenuePercentile,
      is_vip: c.isVip,
      aov: c.aov,
      favourite_products: c.favouriteProducts,
      last_order_products: c.lastOrderProducts,
      state: c.state,
      previous_state: previous?.state ?? null,
      state_changed_at: stateChanged ? now.toISOString() : (previous?.state_changed_at ?? now.toISOString()),
    };
  });

  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from("eng_customer_state").upsert(rows.slice(i, i + CHUNK), {
      onConflict: "customer_id",
    });
    if (error) throw new Error(`Failed to upsert eng_customer_state chunk ${i}: ${error.message}`);
  }

  const stateCounts: Record<string, number> = {};
  for (const row of rows) stateCounts[row.state] = (stateCounts[row.state] ?? 0) + 1;

  return { customersProcessed: rows.length, stateCounts };
}
