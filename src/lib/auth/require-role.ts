import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/supabase/database.types";

// UI-level convenience only - RLS on public.profiles (and every other
// table, as slices add them) is the real enforcement boundary.
export async function requireRole(allowed: Role[]) {
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

  if (!profile?.role || !allowed.includes(profile.role)) {
    redirect("/");
  }

  return profile;
}
