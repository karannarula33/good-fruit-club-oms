import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  // CLAUDE_engagement_engine_FINAL.md §5 STEP 1 / §14.4: nightly, unconditional
  // eng_customer_state recompute. 23:30 UTC = 05:00 IST, matching the ~06:00
  // price-publish cycle so the admin's morning queue reflects overnight orders.
  crons: [
    { path: "/api/cron/engagement-recompute", schedule: "30 23 * * *" },
    // Daily order -> Google Sheets sync (src/lib/sheet-sync/pipeline.ts).
    // 01:00 UTC = 06:30 IST -- after the ~06:00 morning price cycle, well
    // clear of the engagement recompute above. Syncs orders delivered 2
    // days ago (not "yesterday"), so exact time of day isn't critical.
    { path: "/api/cron/sheet-sync", schedule: "0 1 * * *" },
  ],
};
