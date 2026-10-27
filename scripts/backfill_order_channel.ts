// Marks past OMS orders as channel = 'website' by matching them to the
// site's own order list (goodfruit.club admin), for website orders that were
// pasted into the OMS without their GFC-#### number.
//
// Input: a JSON file of site orders, phones already hashed in the browser so
// no phone number leaves the admin page in clear:
//   [{ "no": 1187, "h": "<first 16 hex of sha256(last 10 digits)>",
//      "at": "2026-10-18T00:58" (IST), "st": "del" | "can" | ..., "total": 1250 }]
// Cancelled site orders ("can": abandoned online payments) are skipped.
//
// A site order matches an OMS order of the same customer (phone hash) whose
// delivery date is 0-3 days after the site order date (IST). The closest one
// wins; an OMS order is used once. Orders whose paste already carries the
// GFC number are website already (migration 0038).
//
// Usage: npx tsx --env-file=.env.local scripts/backfill_order_channel.ts <site_orders.json> [--execute]
// Dry run by default.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

interface SiteOrder { no: number; h: string; at: string; st: string; total: number }

const [, , file, flag] = process.argv;
if (!file) throw new Error("usage: backfill_order_channel.ts <site_orders.json> [--execute]");
const execute = flag === "--execute";
const site: SiteOrder[] = JSON.parse(readFileSync(file, "utf8"));

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const hashPhone = (p: string | null) =>
  createHash("sha256").update(String(p ?? "").replace(/\D/g, "").slice(-10)).digest("hex").slice(0, 16);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

async function all<T>(q: (f: number, t: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await q(f, f + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function main() {
  const customers = await all<{ id: string; phone: string | null }>((f, t) => supabase.from("customers").select("id, phone").order("id").range(f, t));
  const orders = await all<{ id: string; customer_id: string; delivery_date: string; status: string; channel: string; raw_paste: string | null }>((f, t) =>
    supabase.from("orders").select("id, customer_id, delivery_date, status, channel, raw_paste").order("id").range(f, t),
  );

  const hashOf = new Map(customers.map((c) => [c.id, c.phone ? hashPhone(c.phone) : null]));
  const byHash = new Map<string, typeof orders>();
  for (const o of orders) {
    const h = hashOf.get(o.customer_id);
    if (!h) continue;
    byHash.set(h, [...(byHash.get(h) ?? []), o]);
  }

  const used = new Set<string>();
  const toMark: { orderId: string; no: number; delivery: string }[] = [];
  let alreadyWebsite = 0;
  const unmatched: SiteOrder[] = [];

  for (const s of [...site].filter((x) => x.st !== "can").sort((a, b) => a.no - b.no)) {
    const siteDate = s.at.slice(0, 10);
    // The paste carries this exact number: already website via migration 0038.
    const byRef = orders.find((o) => (o.raw_paste ?? "").includes(`GFC-${s.no}`));
    if (byRef) { used.add(byRef.id); alreadyWebsite++; continue; }
    const candidates = (byHash.get(s.h) ?? [])
      .filter((o) => !used.has(o.id) && o.status !== "cancelled")
      .map((o) => ({ o, d: dayDiff(siteDate, o.delivery_date) }))
      .filter((x) => x.d >= 0 && x.d <= 3)
      .sort((a, b) => a.d - b.d);
    const hit = candidates[0];
    if (!hit) { unmatched.push(s); continue; }
    used.add(hit.o.id);
    if (hit.o.channel === "website") { alreadyWebsite++; continue; }
    toMark.push({ orderId: hit.o.id, no: s.no, delivery: hit.o.delivery_date });
  }

  console.log(`site orders (not cancelled): ${site.filter((x) => x.st !== "can").length}`);
  console.log(`already website: ${alreadyWebsite}`);
  console.log(`to mark website: ${toMark.length}`);
  for (const m of toMark) console.log(`  GFC-${m.no} -> order ${m.orderId.slice(0, 8)} (delivery ${m.delivery})`);
  console.log(`no OMS order found: ${unmatched.length}${unmatched.length ? " -> " + unmatched.map((u) => `GFC-${u.no} (${u.at.slice(0, 10)}, ${u.st})`).join(", ") : ""}`);

  if (execute && toMark.length) {
    const { error } = await supabase.from("orders").update({ channel: "website" }).in("id", toMark.map((m) => m.orderId));
    if (error) throw new Error(error.message);
    console.log(`marked ${toMark.length} orders as website.`);
  } else if (!execute) {
    console.log("dry run -- pass --execute to write.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
