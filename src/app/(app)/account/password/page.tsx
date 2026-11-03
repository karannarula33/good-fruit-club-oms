import { requireRole } from "@/lib/auth/require-role";
import { PageHeader } from "@/components/ui/page-header";
import { PasswordForm } from "./password-form";

export default async function ChangePasswordPage() {
  await requireRole(["admin", "packer", "delivery", "engagement"]);
  return (
    <div className="flex flex-col gap-4 px-[18px] pt-5 pb-8">
      <PageHeader title="Change password" subtitle="Pick one only you know. You'll use it to log in from now on." />
      <PasswordForm />
    </div>
  );
}
