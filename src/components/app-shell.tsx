"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { cn } from "@/lib/cn";
import type { Role } from "@/lib/supabase/database.types";

const ROLE_HOME: Record<Role, string> = {
  admin: "/admin/orders",
  packer: "/packer",
  delivery: "/delivery",
};

// Matches the design handoff's "Navigation Shell" table exactly -- label
// text and tab order are part of the spec, not incidental. "Manage" is a
// deliberate deviation beyond the design (added for the delete-test-data
// utility screen), same precedent as the customer-resolver UI and
// checkbox-batch actions added earlier.
const TABS: Record<Role, { href: string; label: string }[]> = {
  admin: [
    { href: "/admin/orders", label: "Orders" },
    { href: "/packer", label: "Packing" },
    { href: "/admin/procurement", label: "Procure" },
    { href: "/admin/prices", label: "Prices" },
    { href: "/admin/catalog", label: "Catalog" },
    { href: "/delivery", label: "Route" },
    { href: "/status", label: "Status" },
    { href: "/admin/customers", label: "Ledger" },
    { href: "/admin/engagement", label: "Engagement" },
    { href: "/admin/manage-orders", label: "Manage" },
  ],
  packer: [
    { href: "/packer", label: "Packing" },
    { href: "/status", label: "Status" },
  ],
  delivery: [
    { href: "/delivery", label: "Route" },
    { href: "/status", label: "Status" },
  ],
};

export function AppShell({
  profile,
  children,
}: {
  profile: { fullName: string | null; phone: string | null; role: Role };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const tabs = TABS[profile.role];
  const many = tabs.length > 2;

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <div className="flex items-center justify-between px-4 py-2.5">
        <Link href={ROLE_HOME[profile.role]} className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-xl bg-foreground font-display text-sm font-extrabold text-white">
            GF
          </span>
          <span className="font-display text-sm font-bold text-foreground">Good Fruit Club</span>
        </Link>
        <form action={signOut}>
          <button
            type="submit"
            title="Sign out"
            className="rounded-full p-2 text-muted hover:bg-neutral-bg hover:text-foreground"
          >
            <LogOut className="size-4" aria-hidden="true" />
          </button>
        </form>
      </div>

      <main className="flex-1 overflow-y-auto pb-[calc(64px+env(safe-area-inset-bottom,0px))]">
        {children}
      </main>

      <nav
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex border-t border-[#ECEAE3] bg-white px-1 pt-2",
          many && "overflow-x-auto gap-0.5",
        )}
        style={{ paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))" }}
      >
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex flex-col items-center gap-1 px-2 py-1.5 font-sans text-[10.5px] font-bold",
                many ? "shrink-0 min-w-16" : "flex-1",
                active ? "text-foreground" : "text-tertiary",
              )}
            >
              <span className={cn("size-[5px] rounded-full", active ? "bg-brand" : "bg-transparent")} />
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
