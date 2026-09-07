// Manual trigger / backfill for the daily order -> Google Sheets sync
// (src/lib/sheet-sync/pipeline.ts). Defaults to a dry run: computes and
// prints what would be synced without calling the Sheets or Distance
// Matrix APIs or touching order_sheet_sync -- inspect the numbers before
// ever spending real API calls. Pass --execute to actually run it.
//
// Run with: npm run sync:orders-to-sheet -- [--execute]
//
// Note: runSheetSync always targets "2 days ago" (TARGET_DAYS_AGO in
// pipeline.ts) -- this script is for testing/triggering that same run on
// demand, not for backfilling an arbitrary historical date range.

import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { runSheetSync } from "../src/lib/sheet-sync/pipeline";
import { createSheetsClient, type SheetsClient } from "../src/lib/google/sheets-client";
import { getDrivingDistanceKm } from "../src/lib/google/distance";

const EXECUTE = process.argv.includes("--execute");

function createDryRunSheetsClient(): SheetsClient {
  return {
    async appendRows(tabName, rows) {
      console.log(`[dry run] would append ${rows.length} row(s) to "${tabName}":`);
      for (const row of rows) console.log("  ", row);
    },
  };
}

async function main() {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const sheetTabName = process.env.GOOGLE_SHEETS_ORDERS_TAB;
  const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (EXECUTE && (!clientEmail || !privateKey || !spreadsheetId || !sheetTabName || !mapsApiKey)) {
    console.error("Missing GOOGLE_SHEETS_*/GOOGLE_MAPS_API_KEY env vars -- required for --execute.");
    process.exit(1);
  }
  if (!mapsApiKey) {
    console.error("GOOGLE_MAPS_API_KEY is required even for a dry run (distance still needs to be looked up).");
    process.exit(1);
  }

  const supabase = createServiceRoleClient();
  const sheetsClient = EXECUTE
    ? createSheetsClient({ clientEmail: clientEmail!, privateKey: privateKey!.replace(/\\n/g, "\n"), spreadsheetId: spreadsheetId! })
    : createDryRunSheetsClient();

  const summary = await runSheetSync(supabase, {
    sheetsClient,
    sheetTabName: sheetTabName ?? "Orders",
    getDrivingDistanceKm: (origin, destination) => getDrivingDistanceKm(origin, destination, mapsApiKey),
    dryRun: !EXECUTE,
  });

  console.log(`\nTarget delivery date: ${summary.targetDeliveryDate}`);
  console.log(`Synced orders: ${summary.syncedOrders}${EXECUTE ? "" : " (dry run -- not written to the sheet or marked synced)"}`);
  if (summary.skippedOrders.length > 0) {
    console.log("Skipped orders:");
    for (const s of summary.skippedOrders) console.log(`  - ${s.orderId}: ${s.reason}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
