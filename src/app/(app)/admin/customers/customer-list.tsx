"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { ZoneSelect } from "./zone-select";
import type { Zone } from "@/lib/customers/zone";

interface CustomerRow {
  id: string;
  display_name: string;
  phone: string | null;
  address: string;
  zone: Zone;
  notes: string | null;
}

export function CustomerList({ customers }: { customers: CustomerRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.display_name.toLowerCase().includes(q));
  }, [customers, query]);

  return (
    <div className="flex flex-col gap-3">
      <Input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name…"
        className="w-full"
      />

      <div className="flex flex-col gap-2">
        {filtered.map((customer) => (
          <Card key={customer.id} elevated className="!space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Link href={`/admin/customers/${customer.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar name={customer.display_name} />
                <div className="min-w-0">
                  <div className="font-display text-[15px] font-bold text-foreground">{customer.display_name}</div>
                  <div className="truncate font-sans text-[12px] font-medium text-muted">
                    {customer.phone ?? "No phone"} · {customer.address}
                  </div>
                </div>
              </Link>
              <ZoneSelect customerId={customer.id} zone={customer.zone} />
            </div>
            {customer.notes && <div className="font-sans text-xs text-muted">{customer.notes}</div>}
          </Card>
        ))}
        {filtered.length === 0 && <p className="font-sans text-sm text-muted">No customers match &quot;{query}&quot;.</p>}
      </div>
    </div>
  );
}
