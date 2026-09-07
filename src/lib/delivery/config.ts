// Maps delivery_pricing_config / delivery_pricing_text_config rows
// (0023_delivery_pricing_config.sql) onto a typed shape, same convention as
// src/lib/engagement/config.ts -- keeps the rest of the sync job free of
// string keys.

export interface DeliveryPricingConfig {
  hubDailyFee: number;
  baseFee: number;
  baseKm: number;
  perKmRate: number;
  codFeePct: number;
  weightThresholdKg: number;
  perKgRate: number;
  miscCostPerPackage: number;
  hubOrigin: string;
}

const NUMERIC_KEYS: Record<Exclude<keyof DeliveryPricingConfig, "hubOrigin">, string> = {
  hubDailyFee: "HUB_DAILY_FEE",
  baseFee: "BASE_FEE",
  baseKm: "BASE_KM",
  perKmRate: "PER_KM_RATE",
  codFeePct: "COD_FEE_PCT",
  weightThresholdKg: "WEIGHT_THRESHOLD_KG",
  perKgRate: "PER_KG_RATE",
  miscCostPerPackage: "MISC_COST_PER_PACKAGE",
};

const HUB_ORIGIN_KEY = "HUB_ORIGIN";

export function buildDeliveryPricingConfig(
  numericRows: { key: string; value: number }[],
  textRows: { key: string; value: string }[],
): DeliveryPricingConfig {
  const byKey = new Map(numericRows.map((r) => [r.key, r.value]));
  const textByKey = new Map(textRows.map((r) => [r.key, r.value]));

  const entries = Object.entries(NUMERIC_KEYS).map(([field, dbKey]) => {
    const value = byKey.get(dbKey);
    if (value === undefined) throw new Error(`Missing delivery_pricing_config row for ${dbKey}`);
    return [field, value] as const;
  });

  const hubOrigin = textByKey.get(HUB_ORIGIN_KEY);
  if (hubOrigin === undefined) {
    throw new Error(`Missing delivery_pricing_text_config row for ${HUB_ORIGIN_KEY}`);
  }

  return {
    ...(Object.fromEntries(entries) as Omit<DeliveryPricingConfig, "hubOrigin">),
    hubOrigin,
  };
}
