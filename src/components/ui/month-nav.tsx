"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";

export function addMonths(monthStr: string, delta: number): string {
  const [year, month] = monthStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function MonthNav({ month, basePath }: { month: string; basePath: string }) {
  const router = useRouter();
  const currentMonth = utcToIstDatetimeLocal(new Date()).slice(0, 7);

  return (
    <div className="flex items-center gap-2">
      <Link href={`${basePath}?month=${addMonths(month, -1)}`} className="font-sans text-sm font-bold text-muted">
        ← Prev
      </Link>
      <Input
        type="month"
        value={month}
        onChange={(e) => {
          if (e.target.value) router.push(`${basePath}?month=${e.target.value}`);
        }}
        size="sm"
      />
      <Link href={`${basePath}?month=${addMonths(month, 1)}`} className="font-sans text-sm font-bold text-muted">
        Next →
      </Link>
      {month !== currentMonth && (
        <Link href={basePath} className="font-sans text-sm font-bold text-brand">
          This month
        </Link>
      )}
    </div>
  );
}
