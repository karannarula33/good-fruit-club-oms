// Daily order -> Google Sheets sync (Master Dashboard "Delivery (actual)"
// column). Formula agreed with the business directly (see
// 0023_delivery_pricing_config.sql's top comment):
//
//   (hubDailyFee / ordersOnDeliveryDate)                          -- flat
//     Paschim Vihar -> Gurgaon-hub leg, split across that day's orders
//   + (baseFee for <= baseKm, + perKmRate per km beyond)           -- the
//     delivery partner's per-order leg, using real driving distance from
//     the Gurgaon hub to the customer
//   + (codFeePct * billTotal, only when isCashPaid)                -- the
//     delivery partner's COD handling fee; not charged on non-cash orders
//   + (perKgRate per kg of orderWeightKg above weightThresholdKg)  -- the
//     partner's over-weight surcharge, weight-unit product lines only
//
// Pure and DB-shape-agnostic like src/lib/billing/compute.ts.

export interface DeliveryCostInput {
  hubDailyFee: number;
  ordersOnDeliveryDate: number;
  distanceKm: number;
  baseFee: number;
  baseKm: number;
  perKmRate: number;
  billTotal: number;
  isCashPaid: boolean;
  codFeePct: number;
  orderWeightKg: number;
  weightThresholdKg: number;
  perKgRate: number;
}

export function computeDeliveryCost(input: DeliveryCostInput): number {
  const hubFeeShare = input.ordersOnDeliveryDate > 0 ? input.hubDailyFee / input.ordersOnDeliveryDate : 0;

  const chargeableKm = Math.max(0, input.distanceKm - input.baseKm);
  const distanceCharge = input.baseFee + chargeableKm * input.perKmRate;

  const codFee = input.isCashPaid ? input.billTotal * input.codFeePct : 0;

  const chargeableWeightKg = Math.max(0, input.orderWeightKg - input.weightThresholdKg);
  const weightCharge = chargeableWeightKg * input.perKgRate;

  return Math.round((hubFeeShare + distanceCharge + codFee + weightCharge) * 100) / 100;
}
