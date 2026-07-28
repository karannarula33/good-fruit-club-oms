"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Apple, LogOut } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { cn } from "@/lib/cn";
import type { Role } from "@/lib/supabase/database.types";

const ROLE_HOME: Record<Role, string> = {
  admin: "/admin",
  packer: "/packer",
  delivery: "/delivery",
};

const NAV_LINKS: Record<Role, { href: string; label: string }[]> = {
  admin: [
    { href: "/admin", label: "Dashboard" },
    { href: "/admin/orders", label: "Order Entry" },
    { href: "/admin/procurement", label: "Procurement" },
    { href: "/admin/prices", label: "Prices" },
    { href: "/admin/customers", label: "Customers" },
    { href: "/status", label: "Status board" },
  ],
  packer: [
    { href: "/packer", label: "Packing" },
    { href: "/status", label: "Status board" },
  ],
  delivery: [
    { href: "/delivery", label: "Delivery route" },
    { href: "/status", label: "Status board" },
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
  const links = NAV_LINKS[profile.role];

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center gap-4 px-4 py-2">
          <Link href={ROLE_HOME[profile.role]} className="flex items-center gap-1.5 shrink-0 font-semibold">
            <Apple className="size-5 text-brand" aria-hidden="true" />
            <span className="hidden sm:inline">Good Fruit Club</span>
          </Link>

          <nav className="flex-1 flex items-center gap-1 overflow-x-auto">
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap",
                    active
                      ? "bg-brand text-brand-foreground"
                      : "text-neutral-600 hover:bg-neutral-bg dark:text-neutral-400",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden md:inline text-sm text-neutral-500">
              {profile.fullName || profile.phone}
            </span>
            <form action={signOut}>
              <button
                type="submit"
                title="Sign out"
                className="rounded-md p-2 text-neutral-500 hover:bg-neutral-bg hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                <LogOut className="size-4" aria-hidden="true" />
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
