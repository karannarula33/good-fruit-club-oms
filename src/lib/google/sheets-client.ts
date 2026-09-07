// Daily order -> Google Sheets sync: thin client for appending rows to the
// Master Dashboard's "Orders" tab via the Sheets API v4 REST endpoint.
// Uses google-auth-library only for service-account JWT auth (not the full
// googleapis package) -- keeps the dependency footprint close to this
// repo's otherwise lean list (no SDK exists here beyond @anthropic-ai/sdk
// and @supabase/supabase-js).

import { JWT } from "google-auth-library";

export interface SheetsClientConfig {
  clientEmail: string;
  // Service-account JSON keys store this with literal "\n" sequences;
  // callers must un-escape those before passing it in here (see
  // src/app/api/cron/sheet-sync/route.ts and scripts/sync-orders-to-sheet.ts).
  privateKey: string;
  spreadsheetId: string;
}

export interface SheetsClient {
  appendRows(tabName: string, rows: (string | number)[][]): Promise<void>;
}

export function createSheetsClient(config: SheetsClientConfig): SheetsClient {
  const auth = new JWT({
    email: config.clientEmail,
    key: config.privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return {
    async appendRows(tabName: string, rows: (string | number)[][]): Promise<void> {
      if (rows.length === 0) return;

      const { token } = await auth.getAccessToken();
      if (!token) throw new Error("Failed to obtain a Google access token for the Sheets API");

      const range = encodeURIComponent(`${tabName}!A:A`);
      const url =
        `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${range}:append` +
        `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values: rows }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Sheets API append failed (${response.status}): ${body}`);
      }
    },
  };
}
