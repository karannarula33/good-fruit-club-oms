// Fills in actual_packaging_cost for any packed order_lines that don't
// have it yet, computed from packaging_cost_config (box cost by physical
// type) + finance_config's misc-per-box, split evenly across each
// physical package's lines. Part of the go-forward cost-capture workflow
// (see 0024_cost_ingestion_config.sql's header) -- unlike COGS/delivery
// cost, this isn't a daily paste, it's a periodic "catch up whatever's
// missing" run against packaging config that rarely changes.
//
// Packer wage is deliberately NOT allocated here -- the monthly total
// isn't known until month-end, so it's a P&L-level overhead line, not a
// per-line cost (left for the dashboard/P&L slice).
//
// Never overwrites an existing actual_packaging_cost -- only fills nulls.
//
// Run with: npm run apply-packaging-costs -- [--execute]
// Defaults to a dry run.

import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import type { PackagingType } from "../src/lib/supabase/database.types";

async function main() {
  const execute = process.argv.includes("--execute");
  console.log(`Mode: ${execute ? "EXECUTE (will write)" : "DRY RUN (no writes)"}\n`);

  const supabase = createServiceRoleClient();

  const [{ data: config }, { data: miscConfig }] = await Promise.all([
    supabase.from("packaging_cost_config").select("packaging_type, box_cost"),
    supabase.from("finance_config").select("value").eq("key", "misc_cost_per_box").maybeSingle(),
  ]);
  if (!config || config.length === 0) {
    console.error("packaging_cost_config is empty -- seed box costs per packaging_type before running this.");
    process.exit(1);
  }
  const miscCostPerBox = miscConfig?.value ?? 0;
  if (miscConfig === null) {
    console.log("Note: finance_config['misc_cost_per_box'] not set, treating as 0.\n");
  }
  const boxCostByType = new Map(config.map((c) => [c.packaging_type, c.box_cost]));

  // Every order_line that belongs to a physical package and has no
  // packaging cost yet -- fetched with its package's type so we know
  // which packages need attention.
  const { data: unsetLines, error: unsetError } = await supabase
    .from("order_lines")
    .select("id, package_id, order_packages!inner(packaging_type)")
    .not("package_id", "is", null)
    .is("actual_packaging_cost", null);
  if (unsetError) throw new Error(`Failed loading unpriced packaged lines: ${unsetError.message}`);

  const packageIds = [...new Set((unsetLines ?? []).map((l) => l.package_id as string))];
  if (packageIds.length === 0) {
    console.log("No packaged order_lines are missing a packaging cost -- nothing to do.");
    return;
  }

  let totalLinesUpdated = 0;
  const perPackage: { packageId: string; type: string; costPerLine: number; totalLinesInPackage: number; updated: number }[] = [];

  for (const packageId of packageIds) {
    // Full line set for this package (not just the unset ones) -- the
    // per-line cost has to be based on the package's true size.
    const { data: allLinesInPackage, error: allLinesError } = await supabase
      .from("order_lines")
      .select("id, actual_packaging_cost, order_packages!inner(packaging_type)")
      .eq("package_id", packageId);
    if (allLinesError) throw new Error(`Failed loading lines for package ${packageId}: ${allLinesError.message}`);

    const rows = (allLinesInPackage ?? []) as unknown as { id: string; actual_packaging_cost: number | null; order_packages: { packaging_type: PackagingType } }[];
    if (rows.length === 0) continue;
    const packagingType = rows[0].order_packages.packaging_type;
    const boxCost = boxCostByType.get(packagingType);
    if (boxCost === undefined) {
      console.log(`  skipping package ${packageId}: no packaging_cost_config row for type "${packagingType}"`);
      continue;
    }

    const costPerLine = Math.round(((boxCost + miscCostPerBox) / rows.length) * 100) / 100;
    const toUpdate = rows.filter((r) => r.actual_packaging_cost === null);
    perPackage.push({ packageId, type: packagingType, costPerLine, totalLinesInPackage: rows.length, updated: toUpdate.length });
    totalLinesUpdated += toUpdate.length;

    if (execute && toUpdate.length > 0) {
      const { error: updateError } = await supabase
        .from("order_lines")
        .update({ actual_packaging_cost: costPerLine })
        .in("id", toUpdate.map((r) => r.id));
      if (updateError) throw new Error(`Failed updating order_lines for package ${packageId}: ${updateError.message}`);
    }
  }

  console.log(`Packages needing attention: ${perPackage.length}`);
  perPackage.forEach((p) => console.log(`  ${p.type} (${p.packageId}): ${p.costPerLine}/line x ${p.totalLinesInPackage} lines in package, ${p.updated} to update`));
  console.log(`\nTotal: ${totalLinesUpdated} order_lines to update`);

  if (!execute) {
    console.log("\nDry run only -- no writes made. Re-run with --execute to apply.");
    return;
  }

  console.log(`\nApplied. ${totalLinesUpdated} order_lines updated.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
