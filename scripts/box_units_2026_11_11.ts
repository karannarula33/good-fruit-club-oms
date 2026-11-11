// Sells three items by the box in the OMS, matching the website (admin,
// 2026-11-11: "fix the unit mismatches"), so website orders for them keep
// the site price: Muscat Grapes (500g box), Orange Passion Fruit (500g box),
// Egypt Mango (2 pc, 1.3-1.5 kg box). Switches each product to a count item
// per "box" and publishes a price version with the site's box prices.
// No open orders used these products when it ran.
//   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/box_units_2026_11_11.ts [--execute]
import { createClient } from "@supabase/supabase-js";

const BOX_PRICES: { product: string; price: number; tiers: { minQty: number; pricePerUnit: number }[] }[] = [
  { product: "Muscat Grapes", price: 450, tiers: [{ minQty: 2, pricePerUnit: 425 }] },
  { product: "Orange Passion Fruit (Sweet Granadilla)", price: 450, tiers: [] },
  { product: "Egypt Mango", price: 900, tiers: [] },
];
const KARAN_ADMIN = "62b83fe8-fdc5-4327-925d-4a26bb480069";

async function main() {
  const execute = process.argv.includes("--execute");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: products } = await s.from("products").select("id, name, unit_type, unit_label").in("name", BOX_PRICES.map((b) => b.product));
  for (const b of BOX_PRICES) {
    const p = products?.find((x) => x.name === b.product);
    if (!p) throw new Error(`No OMS product named "${b.product}"`);
    console.log(`${p.name}: ${p.unit_type}/${p.unit_label} -> count/box at ₹${b.price}${b.tiers.map((t) => ` (${t.minQty}+ @ ₹${t.pricePerUnit})`).join("")}`);
  }
  if (!execute) return;
  for (const p of products!) {
    const { error } = await s.from("products").update({ unit_type: "count", unit_label: "box" }).eq("id", p.id);
    if (error) throw new Error(error.message);
  }
  const { data: v, error: vErr } = await s
    .from("price_versions")
    .insert({ effective_from: new Date().toISOString(), published_by: KARAN_ADMIN, note: "Box prices to match the website (11 Nov 2026)" })
    .select("id")
    .single();
  if (vErr || !v) throw new Error(vErr?.message);
  const { data: items, error: iErr } = await s
    .from("price_items")
    .insert(BOX_PRICES.map((b) => ({ version_id: v.id, product_id: products!.find((p) => p.name === b.product)!.id, price_per_unit: b.price })))
    .select("id, product_id");
  if (iErr) throw new Error(iErr.message);
  const tierRows = BOX_PRICES.flatMap((b) => {
    const pid = products!.find((p) => p.name === b.product)!.id;
    const item = items!.find((i) => i.product_id === pid)!;
    return b.tiers.map((t) => ({ price_item_id: item.id, min_qty: t.minQty, price_per_unit: t.pricePerUnit }));
  });
  if (tierRows.length) {
    const { error } = await s.from("price_tiers").insert(tierRows);
    if (error) throw new Error(error.message);
  }
  console.log(`Updated units; published price version ${v.id}.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
