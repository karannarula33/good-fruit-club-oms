"use server";

// Change your own password. Staff logins start with a temporary password set
// by the admin (scripts/create-staff-user.ts sets app_metadata
// .must_change_password); the OMS shows a reminder until it's changed.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function changePassword(newPassword: string, confirm: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please log in again." };

  if (newPassword.length < 8) return { ok: false, error: "Use at least 8 characters." };
  if (newPassword !== confirm) return { ok: false, error: "The two passwords don't match." };

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, error: error.message };

  // app_metadata can only be changed with the service role.
  if (user.app_metadata?.must_change_password) {
    const admin = createServiceRoleClient();
    const { error: metaError } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { ...user.app_metadata, must_change_password: false },
    });
    if (metaError) return { ok: false, error: `Password changed, but couldn't clear the reminder: ${metaError.message}` };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
