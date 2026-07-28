import { requireRole } from "@/lib/auth/require-role";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireRole(["admin", "packer", "delivery"]);

  return (
    <AppShell profile={{ fullName: profile.full_name, phone: profile.phone, role: profile.role! }}>
      {children}
    </AppShell>
  );
}
