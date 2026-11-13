"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { KeyRound, LogOut } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { cn } from "@/lib/cn";
import type { Role } from "@/lib/supabase/database.types";

const ROLE_HOME: Record<Role, string> = {
  admin: "/admin/orders",
  packer: "/packer",
  delivery: "/delivery",
  engagement: "/learn",
};

// Matches the design handoff's "Navigation Shell" table exactly -- label
// text and tab order are part of the spec, not incidental. "Manage" and
// "Dashboard" are deliberate deviations beyond the design (the delete-test-data
// utility screen and the revenue/margin dashboard), same precedent as the
// customer-resolver UI and checkbox-batch actions added earlier.
const TABS: Record<Role, { href: string; label: string }[]> = {
  admin: [
    { href: "/admin/orders", label: "Orders" },
    { href: "/packer", label: "Packing" },
    { href: "/packer/stock", label: "Stock" },
    { href: "/admin/dispatch", label: "Dispatch" },
    { href: "/admin/procurement", label: "Procure" },
    { href: "/admin/prices", label: "Prices" },
    { href: "/admin/catalog", label: "Catalog" },
    { href: "/delivery", label: "Route" },
    { href: "/admin/customers", label: "Ledger" },
    { href: "/admin/engagement", label: "Engagement" },
    { href: "/admin/manage-orders", label: "Manage" },
    { href: "/admin/dashboard", label: "Dashboard" },
    { href: "/admin/training", label: "Training" },
  ],
  packer: [
    { href: "/admin/orders", label: "Orders" },
    { href: "/packer", label: "Packing" },
    { href: "/packer/stock", label: "Stock" },
  ],
  delivery: [{ href: "/delivery", label: "Route" }],
  // The community manager (CLAUDE.md "Engagement role", migration 0041).
  engagement: [
    { href: "/learn", label: "Learn" },
    { href: "/admin/orders", label: "Orders" },
    { href: "/packer", label: "Billing" },
    { href: "/admin/manage-orders", label: "Manage" },
    { href: "/admin/engagement", label: "Engagement" },
    { href: "/delivery", label: "Route" },
  ],
};

export function AppShell({
  profile,
  learn,
  mustChangePassword = false,
  children,
}: {
  mustChangePassword?: boolean;
  profile: { fullName: string | null; phone: string | null; role: Role };
  // Learn GFC progress for an assigned learner ("6 of 11"), else null.
  learn?: { done: number; total: number } | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // Anyone assigned the onboarding gets a Learn tab (the engagement role has it already).
  const baseTabs = TABS[profile.role];
  const tabs =
    learn && !baseTabs.some((t) => t.href === "/learn") ? [{ href: "/learn", label: "Learn" }, ...baseTabs] : baseTabs;
  const many = tabs.length > 2;

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <div className="flex items-center justify-between px-4 py-2.5">
        <Link href={ROLE_HOME[profile.role]} prefetch={false} className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-xl bg-foreground font-display text-sm font-extrabold text-white">
            GF
          </span>
          <span className="font-display text-sm font-bold text-foreground">Good Fruit Club</span>
        </Link>
        <div className="flex items-center">
        <Link href="/account/password" prefetch={false} title="Change password" className="rounded-full p-2 text-muted hover:bg-neutral-bg hover:text-foreground">
          <KeyRound className="size-4" aria-hidden="true" />
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
      </div>

      {mustChangePassword && pathname !== "/account/password" && (
        <Link
          href="/account/password"
          prefetch={false}
          className="mx-4 mb-1 flex items-center justify-between gap-3 rounded-xl bg-warning-bg px-3 py-2.5 font-sans text-[13px] font-semibold text-warning-text"
        >
          <span>You&apos;re using a temporary password. Please change it.</span>
          <span className="shrink-0 font-extrabold">Change →</span>
        </Link>
      )}

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
          const active = pathname === tab.href || (tab.href === "/learn" && pathname.startsWith("/learn/"));
          const showBadge = tab.href === "/learn" && learn && learn.done < learn.total;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              prefetch={false}
              className={cn(
                "flex flex-col items-center gap-1 px-2 py-1.5 font-sans text-[10.5px] font-bold",
                many ? "shrink-0 min-w-16" : "flex-1",
                active ? "text-foreground" : "text-tertiary",
              )}
            >
              <span className={cn("size-[5px] rounded-full", active ? "bg-brand" : "bg-transparent")} />
              <span className="flex items-center gap-1">
                {tab.label}
                {showBadge && (
                  <span
                    aria-label={`${learn.done} of ${learn.total} done`}
                    className="rounded-full bg-brand px-1.5 py-px text-[9.5px] font-extrabold leading-tight text-white"
                  >
                    {learn.done}/{learn.total}
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
