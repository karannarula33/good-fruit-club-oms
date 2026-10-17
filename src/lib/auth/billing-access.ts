import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Bill generation is admin work, plus any packer the admin has given billing
// access (admin decision, 2026-10-17: Kunal). That packer may generate a bill
// but never sees prices, totals or the bill text, can't override a price or
// quantity, and can't send the bill -- sending stays with the admin.
//
// The grant is the auth user's app_metadata.can_generate_bills flag. Only the
// service role can write app_metadata, so a user can't grant it to
// themselves. Set or clear it with the Supabase Admin API:
//   auth.admin.updateUserById(id, { app_metadata: { can_generate_bills: true } })
export async function getBillingAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role")
    .eq("id", user.id)
    .single();
  if (!profile?.role) redirect("/");

  const isAdmin = profile.role === "admin";
  const canGenerateBills = isAdmin || (profile.role === "packer" && user.app_metadata?.can_generate_bills === true);
  return { profile, isAdmin, canGenerateBills };
}

export async function requireBillingAccess() {
  const access = await getBillingAccess();
  if (!access.canGenerateBills) redirect("/");
  return access;
}
