// Publishes the 3 Nov 2026 price list (the shared PDF menu) as one OMS price
// version, the same way the Prices screen does: only products whose price
// changed get a row; everything else carries forward. 500g / 1 kg pairs use
// the pack-price rule (src/lib/pricing/pack-prices.ts).
//   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/publish_price_list_2026_11_03.ts            # dry run
//   ... --execute
import { createClient } from "@supabase/supabase-js";
import { packPricesToItem } from "../src/lib/pricing/pack-prices";

type Entry = { product: string; kg?: number; half?: number; price?: number; extraTiers?: { minQty: number; pricePerUnit: number }[] };
const LIST: Entry[] = [
  { product: "Chikoo", price: 330 },
  { product: "Donut Peaches – 1 box", price: 650 },
  { product: "Pomegranate", price: 450 },
  { product: "Persimmon", price: 400 },
  { product: "Mandarin Orange", price: 400 },
  { product: "Nagpur Orange", price: 280 },
  { product: "Malta", price: 330 },
  { product: "Premium Mausmi", price: 150 },
  { product: "Apple (New Zealand)", price: 470 },
  { product: "Kinnaur Apple", price: 330 },
  { product: "Rockit Apples", price: 550 },
  { product: "Indian Golden Apple", price: 300 },
  { product: "Orange Passion Fruit (Sweet Granadilla)", half: 450 },
  { product: "Water Chestnut", price: 120 },
  { product: "Mangosteen", half: 600, kg: 1150 },
  { product: "Longan", half: 470, kg: 900 },
  { product: "Yellaki (Elaichi) Banana", price: 300 },
  { product: "Red Banana", price: 300 },
  { product: "Muscat Grapes", half: 450, kg: 850 },
  { product: "Red Globe Grapes", half: 290, kg: 540 },
  { product: "Custard Apple", price: 380 },
  { product: "Jumbo Blueberry", price: 340 },
  { product: "Bartlett Pear", price: 380 },
  { product: "Beauty Pear", price: 480 },
  { product: "Red Dragon Fruit", price: 150 },
  { product: "Dragon Fruit", price: 130 },
  { product: "Sun Melon", price: 220 },
  { product: "Avocado", price: 160 },
  { product: "Bangalore Papaya", price: 250 },
  { product: "Papaya", price: 160 },
  { product: "Green Kiwi", price: 320 },
  { product: "Golden Kiwi", price: 400 },
  { product: "Raspberry – 1 box", price: 500 },
  { product: "Indian Guava", price: 250 },
  { product: "Imported Lemon", half: 400 },
  { product: "Thai Sweet Tamarind", price: 250 },
  { product: "Pineapple", price: 240 },
  { product: "Rani Pineapple", price: 240 },
  { product: "Medjool Dates", half: 990, kg: 1800 },
  { product: "Good staples Atta", half: 180, kg: 250, extraTiers: [{ minQty: 5, pricePerUnit: 220 }] },
];

const KARAN_ADMIN = "62b83fe8-fdc5-4327-925d-4a26bb480069";

async function main() {
  const execute = process.argv.includes("--execute");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: products } = await s.from("products").select("id, name, active");
  const { data: items } = await s.from("price_items").select("id, product_id, price_per_unit, price_versions!inner(effective_from, created_at)").limit(10000);
  const { data: tiers } = await s.from("price_tiers").select("price_item_id, min_qty, price_per_unit").limit(10000);
  const now = new Date().toISOString();

  const rows: { product_id: string; price_per_unit: number; tiers: { minQty: number; pricePerUnit: number }[]; name: string; was: string }[] = [];
  for (const e of LIST) {
    const p = (products ?? []).find((x) => x.name === e.product);
    if (!p) throw new Error(`No OMS product named "${e.product}"`);
    const target =
      e.price !== undefined ? { pricePerUnit: e.price, tiers: [] as { minQty: number; pricePerUnit: number }[] } : packPricesToItem(e.kg ?? null, e.half ?? null)!;
    const wantTiers = [...target.tiers, ...(e.extraTiers ?? [])].sort((a, b) => a.minQty - b.minQty);
    const cur = (items ?? [])
      .filter((i: any) => i.product_id === p.id && i.price_versions.effective_from <= now)
      .sort((a: any, b: any) => (b.price_versions.effective_from + b.price_versions.created_at).localeCompare(a.price_versions.effective_from + a.price_versions.created_at))[0] as any;
    const curTiers = cur ? (tiers ?? []).filter((t) => t.price_item_id === cur.id).map((t) => ({ minQty: Number(t.min_qty), pricePerUnit: Number(t.price_per_unit) })).sort((a, b) => a.minQty - b.minQty) : [];
    const same = cur && Number(cur.price_per_unit) === target.pricePerUnit && JSON.stringify(curTiers) === JSON.stringify(wantTiers);
    const was = cur ? `${cur.price_per_unit}${curTiers.length ? " [" + curTiers.map((t) => `${t.minQty}@${t.pricePerUnit}`).join(", ") + "]" : ""}` : "—";
    if (same) continue;
    rows.push({ product_id: p.id, price_per_unit: target.pricePerUnit, tiers: wantTiers, name: p.name, was });
  }
  for (const r of rows) console.log(`${r.name}: ${r.was} -> ${r.price_per_unit}${r.tiers.length ? " [" + r.tiers.map((t) => `${t.minQty}@${t.pricePerUnit}`).join(", ") + "]" : ""}`);
  console.log(`${rows.length} products change.`);
  if (!execute || rows.length === 0) return;

  const { data: v, error: vErr } = await s
    .from("price_versions")
    .insert({ effective_from: now, published_by: KARAN_ADMIN, note: "Price list 3 Nov 2026 (PDF menu)" })
    .select("id")
    .single();
  if (vErr || !v) throw new Error(vErr?.message);
  const { data: inserted, error: iErr } = await s
    .from("price_items")
    .insert(rows.map((r) => ({ version_id: v.id, product_id: r.product_id, price_per_unit: r.price_per_unit })))
    .select("id, product_id");
  if (iErr) throw new Error(iErr.message);
  const tierRows = rows.flatMap((r) => {
    const pi = inserted!.find((x) => x.product_id === r.product_id)!;
    return r.tiers.map((t) => ({ price_item_id: pi.id, min_qty: t.minQty, price_per_unit: t.pricePerUnit }));
  });
  if (tierRows.length) {
    const { error: tErr } = await s.from("price_tiers").insert(tierRows);
    if (tErr) throw new Error(tErr.message);
  }
  console.log(`Published version ${v.id}.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
