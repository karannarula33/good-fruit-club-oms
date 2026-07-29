import { ClipboardList, Truck, Tag, Users, Activity } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";

const LINKS = [
  { href: "/admin/orders", label: "Order Entry", icon: ClipboardList },
  { href: "/admin/procurement", label: "Procurement", icon: Truck },
  { href: "/admin/prices", label: "Prices", icon: Tag },
  { href: "/admin/customers", label: "Customers", icon: Users },
  { href: "/status", label: "Status board", icon: Activity },
];

export default async function AdminPage() {
  const profile = await requireRole(["admin"]);

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Admin" subtitle={`Welcome, ${profile.full_name || profile.phone}.`} />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {LINKS.map(({ href, label, icon: Icon }) => (
          <Button key={href} href={href} variant="outline" size="lg" className="justify-start">
            <Icon className="size-5" aria-hidden="true" />
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}
