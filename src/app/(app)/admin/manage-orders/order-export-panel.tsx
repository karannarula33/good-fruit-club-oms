"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// Defaults both ends to the date already being viewed, so a plain click
// downloads just that day; widening "To" turns it into a period export.
export function OrderExportPanel({ date }: { date: string }) {
  const [from, setFrom] = useState(date);
  const [to, setTo] = useState(date);

  const range = from <= to ? { from, to } : { from: to, to: from };
  const href = `/api/admin/orders/export?from=${range.from}&to=${range.to}`;

  return (
    <Card elevated className="flex flex-wrap items-end gap-2.5 !space-y-0">
      <label className="flex flex-col gap-1">
        <span className="font-sans text-[11.5px] font-semibold text-muted">From</span>
        <Input type="date" size="sm" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-sans text-[11.5px] font-semibold text-muted">To</span>
        <Input type="date" size="sm" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
      </label>
      <a
        href={href}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[#ECEAE3] px-3 py-1.5 font-sans text-sm font-extrabold text-foreground hover:bg-neutral-bg"
      >
        <Download className="size-4" aria-hidden="true" /> Download CSV
      </a>
    </Card>
  );
}
