// Loads the dashboard snapshot (every order with its lines, customers,
// products, overheads) for src/lib/dashboard/metrics.ts. Member metrics need
// full history, so this reads all orders, paging past PostgREST's 1000-row cap.
//
// Tolerates migration 0032 not being applied yet: without products.category,
// customers.is_internal or overhead_entries the dashboard still renders, with
// products uncategorised, "Kapoor's" treated as internal by name, and no
// overheads.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { MCustomer, MOrder, MOverhead, MProduct, Snapshot } from "./metrics";

type Client = SupabaseClient<Database>;

// Used only until migration 0032 adds customers.is_internal.
const INTERNAL_BY_NAME = new Set(["kapoor's"]);
const PAGE = 1000;

async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export async function loadSnapshot(supabase: Client): Promise<Snapshot & { schemaReady: boolean }> {
  const ordersRaw = await pageAll((f, t) =>
    supabase.from("orders").select("id, customer_id, delivery_date, status").order("id").range(f, t),
  );
  const linesRaw = await pageAll((f, t) =>
    supabase
      .from("order_lines")
      .select("order_id, product_id, actual_qty, locked_price_per_unit, locked_cogs_per_unit, actual_packaging_cost, actual_delivery_cost, actual_labour_cost, line_status, is_substitution, is_gift_box")
      .order("id")
      .range(f, t),
  );

  let schemaReady = true;

  let products: MProduct[];
  const withCategory = await supabase.from("products").select("id, name, category");
  if (withCategory.error) {
    schemaReady = false;
    const plain = await supabase.from("products").select("id, name");
    products = (plain.data ?? []).map((p) => ({ id: p.id, name: p.name, category: null }));
  } else {
    products = (withCategory.data ?? []).map((p) => ({ id: p.id, name: p.name, category: p.category }));
  }

  let customers: MCustomer[];
  const withInternal = await pageAll((f, t) => supabase.from("customers").select("id, display_name, zone, is_internal").order("id").range(f, t)).catch(() => null);
  if (withInternal) {
    customers = withInternal.map((c) => ({ id: c.id, name: c.display_name, zone: c.zone, isInternal: c.is_internal }));
  } else {
    schemaReady = false;
    const plain = await pageAll((f, t) => supabase.from("customers").select("id, display_name, zone").order("id").range(f, t));
    customers = plain.map((c) => ({ id: c.id, name: c.display_name, zone: c.zone, isInternal: INTERNAL_BY_NAME.has(c.display_name.toLowerCase()) }));
  }

  let overheads: MOverhead[] = [];
  const oh = await supabase.from("overhead_entries").select("entry_date, category, amount");
  if (oh.error) schemaReady = false;
  else overheads = (oh.data ?? []).map((o) => ({ date: o.entry_date, category: o.category, amount: Number(o.amount) }));

  const linesByOrder = new Map<string, MOrder["lines"]>();
  for (const l of linesRaw) {
    const list = linesByOrder.get(l.order_id) ?? [];
    list.push({
      productId: l.product_id,
      actualQty: l.actual_qty === null ? null : Number(l.actual_qty),
      price: l.locked_price_per_unit === null ? null : Number(l.locked_price_per_unit),
      cogsPerUnit: l.locked_cogs_per_unit === null ? null : Number(l.locked_cogs_per_unit),
      packaging: l.actual_packaging_cost === null ? null : Number(l.actual_packaging_cost),
      delivery: l.actual_delivery_cost === null ? null : Number(l.actual_delivery_cost),
      labour: l.actual_labour_cost === null ? null : Number(l.actual_labour_cost),
      lineStatus: l.line_status,
      isSubstitution: l.is_substitution,
      isGiftBox: l.is_gift_box,
    });
    linesByOrder.set(l.order_id, list);
  }

  const orders: MOrder[] = ordersRaw.map((o) => ({
    id: o.id,
    customerId: o.customer_id,
    deliveryDate: o.delivery_date,
    status: o.status,
    lines: linesByOrder.get(o.id) ?? [],
  }));

  return { orders, customers, products, overheads, schemaReady };
}
