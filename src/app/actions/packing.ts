"use server";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import {
  buildFinalizeOrderPlan,
  type PackingLineResolution,
  type SubstitutionInput,
} from "@/lib/packing/finalize";
import { PACKAGING_TYPES } from "@/lib/packing/packaging";
import type { PackagingType } from "@/lib/supabase/database.types";

export interface NewPackageInput {
  tempId: string;
  packagingType: PackagingType;
}

const VALID_PACKAGING_TYPES = new Set(PACKAGING_TYPES.map((t) => t.value));

// Resolves a per-line `packageRef` -- "" (unset), an existing order_packages
// uuid, or a client-side tempId minted for a not-yet-saved box -- to the
// real package_id that should be written to order_lines.
function resolvePackageId(packageRef: string | null | undefined, tempIdToRealId: Map<string, string>): string | null {
  if (!packageRef) return null;
  return tempIdToRealId.get(packageRef) ?? packageRef;
}

export async function finalizeOrder(
  orderId: string,
  resolutions: PackingLineResolution[],
  substitutions: SubstitutionInput[],
  newPackages: NewPackageInput[] = [],
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole(["packer", "admin"]);

  for (const pkg of newPackages) {
    if (!VALID_PACKAGING_TYPES.has(pkg.packagingType)) {
      return { ok: false, error: `Unknown packaging type: ${pkg.packagingType}.` };
    }
  }

  const supabase = await createClient();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("status, status_timestamps")
    .eq("id", orderId)
    .single();
  if (orderError || !order) {
    return { ok: false, error: orderError?.message ?? "Order not found." };
  }
  if (order.status !== "recorded") {
    return { ok: false, error: `Order is already ${order.status}.` };
  }

  const { data: existingLines, error: linesError } = await supabase
    .from("order_lines")
    .select("id")
    .eq("order_id", orderId);
  if (linesError) {
    return { ok: false, error: linesError.message };
  }

  const resolvedLineIds = new Set(resolutions.map((r) => r.lineId));
  const missing = (existingLines ?? []).filter((line) => !resolvedLineIds.has(line.id));
  if (missing.length > 0) {
    return { ok: false, error: `${missing.length} line(s) still need to be packed or marked unavailable.` };
  }
  for (const resolution of resolutions) {
    if (resolution.resolution === "packed" && (!Number.isFinite(resolution.actualQty) || (resolution.actualQty ?? 0) <= 0)) {
      return { ok: false, error: "Every packed line needs a quantity greater than zero." };
    }
  }

  const now = new Date();
  const plan = buildFinalizeOrderPlan({ resolutions, substitutions });

  // New boxes/packets the packer created during this session (a line picked
  // "New: Big Box" etc.) need real rows before we can point order_lines at
  // them -- insert first and map each client tempId to its real uuid.
  const tempIdToRealId = new Map<string, string>();
  if (newPackages.length > 0) {
    const { data: insertedPackages, error: packagesError } = await supabase
      .from("order_packages")
      .insert(newPackages.map((pkg) => ({ order_id: orderId, packaging_type: pkg.packagingType })))
      .select("id");
    if (packagesError || !insertedPackages) {
      return { ok: false, error: packagesError?.message ?? "Failed to create packaging." };
    }
    newPackages.forEach((pkg, i) => tempIdToRealId.set(pkg.tempId, insertedPackages[i].id));
  }
  const packageIdByLineId = new Map(
    resolutions.map((r) => [r.lineId, resolvePackageId(r.packageRef, tempIdToRealId)]),
  );

  // Each line is an independent row -- run the writes in parallel rather
  // than one sequential round trip per line.
  const lineUpdateResults = await Promise.all(
    plan.lineUpdates.map((update) =>
      supabase
        .from("order_lines")
        .update({
          line_status: update.lineStatus,
          actual_qty: update.actualQty,
          package_id: packageIdByLineId.get(update.lineId) ?? null,
        })
        .eq("id", update.lineId),
    ),
  );
  const firstLineUpdateError = lineUpdateResults.find((r) => r.error);
  if (firstLineUpdateError?.error) {
    return { ok: false, error: firstLineUpdateError.error.message };
  }

  if (plan.newSubstitutionLines.length > 0) {
    const { error } = await supabase.from("order_lines").insert(
      plan.newSubstitutionLines.map((line, i) => ({
        order_id: orderId,
        product_id: line.productId,
        actual_qty: line.actualQty,
        line_status: "packed" as const,
        is_substitution: true,
        substituted_for_line_id: line.substitutedForLineId,
        package_id: resolvePackageId(substitutions[i]?.packageRef, tempIdToRealId),
      })),
    );
    if (error) {
      return { ok: false, error: error.message };
    }
  }

  // CLAUDE.md §3.5 allows cancelled "until packed" -- if nothing on the
  // order actually got packed (every line unavailable, no substitutes),
  // close it out as cancelled instead of leaving a ₹0 "ready to bill"
  // order in the queue for admin to notice and cancel manually.
  const finalStatus = plan.shouldCancel ? "cancelled" : "packed";
  const mergedStatusTimestamps = { ...order.status_timestamps, [finalStatus]: now.toISOString() };
  const { error: finalizeError } = await supabase
    .from("orders")
    .update({ status: finalStatus, status_timestamps: mergedStatusTimestamps })
    .eq("id", orderId);
  if (finalizeError) {
    return { ok: false, error: finalizeError.message };
  }

  // No revalidatePath here -- finalizeOrder and generateBill are now two
  // separately-triggered steps (packing-screen.tsx), and the packer's own
  // client explicitly calls router.refresh() after Pack & Close returns to
  // the queue, matching this app's established convention.
  return { ok: true };
}
