// What a duplicated order copies (admin, 2026-11-11: "a second order the same
// day", src/app/actions/manage-orders.ts duplicateOrder). The customer's
// ordered items -- product, ordered qty and unit, price lock, gift box flag
// -- as fresh "to pack" lines. Not copied: substitutes (made at packing for
// the original), packed / billed quantities, costs, packaging, the discount
// and anything paid. Items the original couldn't supply are copied too: they
// were ordered.
import type { Database } from "@/lib/supabase/database.types";

type LineInsert = Database["public"]["Tables"]["order_lines"]["Insert"];

export interface SourceLine {
  product_id: string | null;
  ordered_qty: number | null;
  ordered_unit: string | null;
  locked_price_per_unit: number | null;
  is_gift_box: boolean;
  is_substitution: boolean;
}

export function duplicateLineRows(orderId: string, lines: SourceLine[]): LineInsert[] {
  return lines
    .filter((l) => !l.is_substitution && l.product_id !== null && l.ordered_qty !== null && Number(l.ordered_qty) > 0)
    .map((l) => ({
      order_id: orderId,
      product_id: l.product_id,
      ordered_qty: l.ordered_qty,
      ordered_unit: l.ordered_unit,
      locked_price_per_unit: l.locked_price_per_unit,
      is_gift_box: l.is_gift_box,
      line_status: "pending" as const,
      parse_confidence: l.locked_price_per_unit === null ? ("flagged" as const) : ("clean" as const),
      parse_note: "Copied from a duplicated order",
    }));
}
