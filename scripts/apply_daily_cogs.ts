// Applies the vendor's daily handwritten cost list to that day's live
// order_lines. Part of the go-forward cost-capture workflow (chat-driven,
// not an in-app screen -- see 0024_cost_ingestion_config.sql's header):
// the owner shares the vendor's list (photo or text), Claude reads it into
// a small JSON file, this script resolves products and applies costs.
//
// Input JSON shape: [{ "product": "Alphonso Mango", "cost": 320 }, ...]
// "cost" is per-unit (matches the product's catalog unit), not a line
// total -- unlike the historical sheet's Sell Price/COGS columns, there's
// no qty to divide through here.
//
// Never overwrites an existing locked_cogs_per_unit -- only fills nulls,
// same posture as 0013's original design intent for that column.
//
// Run with: npm run apply-daily-cogs -- <YYYY-MM-DD> <path-to-json> [--execute]
// Defaults to a dry run.

import { readFileSync } from "node:fs";
import { createServiceRoleClient } from "../src/lib/supabase/service-role";

interface CogsInputLine {
  product: string;
  cost: number;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const [entryDate, jsonPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!entryDate || !jsonPath || !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
    console.error("Usage: npm run apply-daily-cogs -- <YYYY-MM-DD> <path-to-json> [--execute]");
    process.exit(1);
  }

  console.log(`Mode: ${execute ? "EXECUTE (will write)" : "DRY RUN (no writes)"}`);
  console.log(`Date: ${entryDate}\n`);

  const lines: CogsInputLine[] = JSON.parse(readFileSync(jsonPath, "utf-8"));
  const supabase = createServiceRoleClient();

  const [{ data: products }, { data: aliases }] = await Promise.all([
    supabase.from("products").select("id, name"),
    supabase.from("product_aliases").select("alias, product_id"),
  ]);
  const productByLowerName = new Map((products ?? []).map((p) => [p.name.toLowerCase(), p.id]));
  const productByLowerAlias = new Map((aliases ?? []).map((a) => [a.alias.toLowerCase(), a.product_id]));
  function resolveProduct(nameRaw: string): string | null {
    const key = nameRaw.trim().toLowerCase();
    return productByLowerName.get(key) ?? productByLowerAlias.get(key) ?? null;
  }

  const resolved: { productId: string; product: string; cost: number }[] = [];
  const unresolved: string[] = [];
  for (const line of lines) {
    if (!Number.isFinite(line.cost) || line.cost <= 0) {
      console.log(`  skipping "${line.product}": invalid cost ${line.cost}`);
      continue;
    }
    const productId = resolveProduct(line.product);
    if (!productId) {
      unresolved.push(line.product);
      continue;
    }
    resolved.push({ productId, product: line.product, cost: line.cost });
  }

  console.log(`Resolved: ${resolved.length}/${lines.length}`);
  if (unresolved.length > 0) {
    console.log(`Unresolved products (need a catalog match or alias before these can apply):`);
    unresolved.forEach((p) => console.log(`  - "${p}"`));
  }

  const dayStart = `${entryDate}T00:00:00+05:30`;
  const nextDay = new Date(new Date(`${entryDate}T00:00:00+05:30`).getTime() + 24 * 60 * 60 * 1000);
  const dayEnd = nextDay.toISOString();

  let totalLinesUpdated = 0;
  let totalLinesAlreadySet = 0;
  const perProduct: { product: string; cost: number; updated: number; alreadySet: number }[] = [];

  for (const item of resolved) {
    const { data: matchingLines, error: matchError } = await supabase
      .from("order_lines")
      .select("id, locked_cogs_per_unit, orders!inner(is_historical, placed_at)")
      .eq("product_id", item.productId)
      .eq("orders.is_historical", false)
      .gte("orders.placed_at", dayStart)
      .lt("orders.placed_at", dayEnd);
    if (matchError) throw new Error(`Failed matching order_lines for "${item.product}": ${matchError.message}`);

    const toUpdate = (matchingLines ?? []).filter((l) => l.locked_cogs_per_unit === null);
    const alreadySet = (matchingLines ?? []).length - toUpdate.length;
    perProduct.push({ product: item.product, cost: item.cost, updated: toUpdate.length, alreadySet });
    totalLinesUpdated += toUpdate.length;
    totalLinesAlreadySet += alreadySet;

    if (execute && toUpdate.length > 0) {
      const { error: updateError } = await supabase
        .from("order_lines")
        .update({ locked_cogs_per_unit: item.cost })
        .in("id", toUpdate.map((l) => l.id));
      if (updateError) throw new Error(`Failed updating order_lines for "${item.product}": ${updateError.message}`);
    }
  }

  console.log(`\nPer product:`);
  perProduct.forEach((p) => console.log(`  ${p.product}: cost ${p.cost}, ${p.updated} lines to update, ${p.alreadySet} already priced (untouched)`));
  console.log(`\nTotal: ${totalLinesUpdated} lines to update, ${totalLinesAlreadySet} already priced (untouched)`);

  if (!execute) {
    console.log("\nDry run only -- no writes made. Re-run with --execute to apply.");
    return;
  }

  if (execute) {
    const { error: upsertError } = await supabase
      .from("daily_cogs_entries")
      .upsert(
        resolved.map((item) => ({ entry_date: entryDate, product_id: item.productId, cost_per_unit: item.cost })),
        { onConflict: "entry_date,product_id" },
      );
    if (upsertError) throw new Error(`Failed upserting daily_cogs_entries: ${upsertError.message}`);
  }

  console.log(`\nApplied. ${totalLinesUpdated} order_lines updated, ${resolved.length} daily_cogs_entries rows recorded.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
