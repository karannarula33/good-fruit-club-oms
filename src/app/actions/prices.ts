"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { istWallClockToUtc } from "@/lib/time/ist";
import { loadCatalogEntries } from "@/lib/catalog/load";
import { parsePriceList, type ParsedPriceItem } from "@/lib/parser/parse-price-list";

export interface ReviewLine {
  rawText: string;
  price: number | null;
  productId: string | null;
  confidence: "clean" | "flagged";
  flagReason: ParsedPriceItem["flagReason"];
}

export async function parsePriceListDraft(
  rawText: string,
): Promise<{ ok: true; lines: ReviewLine[] } | { ok: false; error: string }> {
  await requireRole(["admin"]);

  if (!rawText.trim()) {
    return { ok: false, error: "Paste a price list first." };
  }

  try {
    const supabase = await createClient();
    const catalog = await loadCatalogEntries(supabase);
    const result = await parsePriceList(rawText, catalog);
    const lines: ReviewLine[] = result.items.map((item) => ({
      rawText: item.rawText,
      price: item.price,
      productId: item.productId,
      confidence: item.confidence,
      flagReason: item.flagReason,
    }));
    return { ok: true, lines };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to parse price list." };
  }
}

export async function publishPriceVersion(input: {
  effectiveFromIst: string;
  note: string | null;
  items: {
    productId: string;
    pricePerUnit: number;
    tiers?: { minQty: number; pricePerUnit: number }[];
    replaceTiers?: boolean;
  }[];
  newAliases: { productId: string; alias: string }[];
}): Promise<{ ok: true; versionId: string } | { ok: false; error: string }> {
  await requireRole(["admin"]);

  if (input.items.length === 0) {
    return { ok: false, error: "No priced items to publish." };
  }
  for (const item of input.items) {
    if (!item.productId || !Number.isFinite(item.pricePerUnit) || item.pricePerUnit <= 0) {
      return { ok: false, error: "Every line needs a product and a price greater than zero." };
    }
    for (const tier of item.tiers ?? []) {
      if (!Number.isFinite(tier.minQty) || tier.minQty <= 0 || !Number.isFinite(tier.pricePerUnit) || tier.pricePerUnit <= 0) {
        return { ok: false, error: "Every tier needs a quantity and a price greater than zero." };
      }
    }
  }

  const effectiveFrom = istWallClockToUtc(input.effectiveFromIst).toISOString();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("publish_price_version", {
    p_effective_from: effectiveFrom,
    p_note: input.note,
    p_items: input.items.map((item) => ({
      product_id: item.productId,
      price_per_unit: item.pricePerUnit,
      tiers: (item.tiers ?? []).map((tier) => ({ min_qty: tier.minQty, price_per_unit: tier.pricePerUnit })),
      replace_tiers: item.replaceTiers ?? false,
    })),
    p_new_aliases: input.newAliases.map((alias) => ({ product_id: alias.productId, alias: alias.alias })),
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin/prices");
  revalidatePath("/admin/catalog");
  return { ok: true, versionId: data as string };
}
