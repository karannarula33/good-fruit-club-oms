"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";

export function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function DateNav({ date, basePath }: { date: string; basePath: string }) {
  const router = useRouter();
  const today = utcToIstDatetimeLocal(new Date()).slice(0, 10);

  return (
    <div className="flex items-center gap-2">
      <Link href={`${basePath}?date=${addDays(date, -1)}`} className="font-sans text-sm font-bold text-muted">
        ← Prev
      </Link>
      <Input
        type="date"
        value={date}
        onChange={(e) => {
          if (e.target.value) router.push(`${basePath}?date=${e.target.value}`);
        }}
        size="sm"
      />
      <Link href={`${basePath}?date=${addDays(date, 1)}`} className="font-sans text-sm font-bold text-muted">
        Next →
      </Link>
      {date !== today && (
        <Link href={basePath} className="font-sans text-sm font-bold text-brand">
          Today
        </Link>
      )}
    </div>
  );
}
