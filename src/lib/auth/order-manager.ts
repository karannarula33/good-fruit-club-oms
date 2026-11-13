// Manage Orders and billing for the community manager (admin decision,
// 2026-11-13: "give Navya billing and manage order access, as much as I
// do"). The engagement role can do everything the admin does on Manage
// Orders and on the packing screen's billing (review priced items, override
// a price or quantity, generate, edit and send bills, discounts, duplicates,
// cancel / delete orders, the order exports) -- and pack, since billing
// lives on the same screen. Not the dashboard, overheads, prices/catalog,
// customers & ledger, procurement, dispatch or staff.
//
// The database policies only give these writes to the admin, so for the
// engagement role the server action -- after this role check -- uses the
// service role (the same pattern as a billing packer, billing-access.ts).
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Role } from "@/lib/supabase/database.types";

export const ORDER_MANAGER_ROLES: Role[] = ["admin", "engagement"];

export function isOrderManager(role: Role | null | undefined): boolean {
  return role === "admin" || role === "engagement";
}

export async function requireOrderManager(extra: Role[] = []) {
  const profile = await requireRole([...ORDER_MANAGER_ROLES, ...extra]);
  const db = profile.role === "admin" ? await createClient() : createServiceRoleClient();
  return { profile, db, isAdmin: profile.role === "admin" };
}

// The database client for a role already checked: the signed-in (RLS)
// client for admin and packers, the service role for the engagement role.
export async function dbForRole(role: Role | null | undefined) {
  return role === "engagement" ? createServiceRoleClient() : await createClient();
}
