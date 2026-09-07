// Vercel Cron target for the daily order -> Google Sheets sync (see
// src/lib/sheet-sync/pipeline.ts). Runs as service role (bypasses RLS),
// same shape as engagement-recompute/route.ts. Schedule lives in vercel.ts.

import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { runSheetSync } from "@/lib/sheet-sync/pipeline";
import { createSheetsClient } from "@/lib/google/sheets-client";
import { getDrivingDistanceKm } from "@/lib/google/distance";

export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const sheetTabName = process.env.GOOGLE_SHEETS_ORDERS_TAB;
  const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!clientEmail || !privateKey || !spreadsheetId || !sheetTabName || !mapsApiKey) {
    return NextResponse.json({ ok: false, error: "Missing Google Sheets/Maps env vars" }, { status: 500 });
  }

  const supabase = createServiceRoleClient();
  try {
    const summary = await runSheetSync(supabase, {
      // Service-account JSON keys store the private key with literal "\n"
      // sequences -- Vercel env vars can't hold real newlines, so this
      // un-escapes them back into an actual PEM string.
      sheetsClient: createSheetsClient({ clientEmail, privateKey: privateKey.replace(/\\n/g, "\n"), spreadsheetId }),
      sheetTabName,
      getDrivingDistanceKm: (origin, destination) => getDrivingDistanceKm(origin, destination, mapsApiKey),
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Sheet sync failed" }, { status: 500 });
  }
}
