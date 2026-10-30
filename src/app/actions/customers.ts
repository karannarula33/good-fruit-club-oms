"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireBillingAccess } from "@/lib/auth/billing-access";
import type { PaymentMode, Salutation } from "@/lib/supabase/database.types";

const VALID_SALUTATIONS: readonly Salutation[] = ["Sir", "Ma'am"];
const VALID_PAYMENT_MODES: readonly PaymentMode[] = ["cod", "online"];

export async function updateCustomerZone(
  customerId: string,
  zone: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole(["admin"]);

  zone = zone.trim();
  if (!zone) return { ok: false, error: "Pick a zone." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ zone })
    .eq("id", customerId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin/customers");
  return { ok: true };
}

// Whether the delivery sheet (src/app/api/admin/orders/delivery-sheet/route.ts)
// should print a COD amount for this customer's orders -- see 0022_customer_payment_mode.sql.
export async function updateCustomerPaymentMode(
  customerId: string,
  paymentMode: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole(["admin"]);

  if (!VALID_PAYMENT_MODES.includes(paymentMode as PaymentMode)) {
    return { ok: false, error: `Unknown payment mode: ${paymentMode}` };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ payment_mode: paymentMode as PaymentMode })
    .eq("id", customerId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin/customers");
  return { ok: true };
}

// Sets/corrects the WhatsApp bill greeting salutation for a customer --
// used both by the admin's customer list (SalutationSelect) and the
// billing-time picker (PackedDetail) when auto-classification came back
// "unknown" (see src/lib/parser/classify-salutation.ts).
export async function updateCustomerSalutation(
  customerId: string,
  salutation: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // A packer with billing access hits the same Sir/Ma'am picker at billing
  // time; they have no RLS write on customers, hence the service-role client.
  const { isAdmin } = await requireBillingAccess();

  if (!VALID_SALUTATIONS.includes(salutation as Salutation)) {
    return { ok: false, error: `Unknown salutation: ${salutation}` };
  }

  const supabase = isAdmin ? await createClient() : createServiceRoleClient();
  const { error } = await supabase
    .from("customers")
    .update({ salutation: salutation as Salutation })
    .eq("id", customerId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin/customers");
  return { ok: true };
}
