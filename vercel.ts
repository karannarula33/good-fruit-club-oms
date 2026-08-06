import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  // CLAUDE_engagement_engine_FINAL.md §5 STEP 1 / §14.4: nightly, unconditional
  // eng_customer_state recompute. 23:30 UTC = 05:00 IST, matching the ~06:00
  // price-publish cycle so the admin's morning queue reflects overnight orders.
  crons: [{ path: "/api/cron/engagement-recompute", schedule: "30 23 * * *" }],
};
