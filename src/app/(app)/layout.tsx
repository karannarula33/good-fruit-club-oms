import { requireRole } from "@/lib/auth/require-role";
import { AppShell } from "@/components/app-shell";
import { learnSummary } from "@/lib/training/load";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireRole(["admin", "packer", "delivery", "engagement"]);

  // Learn GFC badge ("6/11") for anyone assigned the onboarding; never blocks the page.
  const learn = await learnSummary(profile.id).catch(() => null);
  // Temporary password from the admin? Show a reminder until it's changed.
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  const mustChangePassword = user?.app_metadata?.must_change_password === true;

  return (
    <AppShell profile={{ fullName: profile.full_name, phone: profile.phone, role: profile.role! }} learn={learn} mustChangePassword={mustChangePassword}>
      {children}
    </AppShell>
  );
}
