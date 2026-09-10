// One-time (and re-runnable) seed/update for packaging_cost_config and
// finance_config -- the small, rarely-changing knobs apply_packaging_costs.ts
// reads from. Upserts, so safe to re-run when a box cost or the packer's
// wage changes later.
//
// Input JSON shape:
// {
//   "packaging": { "big_box": 13, "medium_box": 11, ... },   // any subset of the 6 types
//   "finance": { "misc_cost_per_box": 2, "packer_monthly_wage": 7000 }  // optional, any subset
// }
//
// Run with: npm run seed-cost-config -- <path-to-json> [--execute]
// Defaults to a dry run.

import { readFileSync } from "node:fs";
import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import type { PackagingType } from "../src/lib/supabase/database.types";

const VALID_PACKAGING_TYPES: PackagingType[] = ["big_box", "medium_box", "small_box", "small_packet", "big_packet", "tiny_box"];

interface SeedInput {
  packaging?: Partial<Record<PackagingType, number>>;
  finance?: Record<string, number>;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const [jsonPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!jsonPath) {
    console.error("Usage: npm run seed-cost-config -- <path-to-json> [--execute]");
    process.exit(1);
  }

  console.log(`Mode: ${execute ? "EXECUTE (will write)" : "DRY RUN (no writes)"}\n`);

  const input: SeedInput = JSON.parse(readFileSync(jsonPath, "utf-8"));
  const supabase = createServiceRoleClient();

  const packagingRows: { packaging_type: PackagingType; box_cost: number }[] = [];
  for (const [type, cost] of Object.entries(input.packaging ?? {})) {
    if (!VALID_PACKAGING_TYPES.includes(type as PackagingType)) {
      console.log(`  skipping unknown packaging_type "${type}"`);
      continue;
    }
    if (!Number.isFinite(cost) || cost <= 0) {
      console.log(`  skipping "${type}": invalid cost ${cost}`);
      continue;
    }
    packagingRows.push({ packaging_type: type as PackagingType, box_cost: cost });
  }

  const financeRows = Object.entries(input.finance ?? {}).map(([key, value]) => ({ key, value }));

  console.log(`packaging_cost_config rows to upsert (${packagingRows.length}):`);
  packagingRows.forEach((r) => console.log(`  ${r.packaging_type}: ${r.box_cost}`));
  console.log(`\nfinance_config rows to upsert (${financeRows.length}):`);
  financeRows.forEach((r) => console.log(`  ${r.key}: ${r.value}`));

  if (!execute) {
    console.log("\nDry run only -- no writes made. Re-run with --execute to apply.");
    return;
  }

  if (packagingRows.length > 0) {
    const { error } = await supabase.from("packaging_cost_config").upsert(packagingRows, { onConflict: "packaging_type" });
    if (error) throw new Error(`Failed upserting packaging_cost_config: ${error.message}`);
  }
  if (financeRows.length > 0) {
    const { error } = await supabase.from("finance_config").upsert(financeRows, { onConflict: "key" });
    if (error) throw new Error(`Failed upserting finance_config: ${error.message}`);
  }

  console.log(`\nApplied. ${packagingRows.length} packaging_cost_config rows, ${financeRows.length} finance_config rows.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
