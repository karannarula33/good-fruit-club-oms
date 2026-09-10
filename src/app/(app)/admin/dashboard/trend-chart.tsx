"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { DailyPoint } from "@/lib/dashboard/compute";

// Palette validated via the dataviz skill's script (2-slot categorical,
// light mode, app surface): #F2952E (brand) + #2A6FB3 (info) pass CVD
// separation (deltaE 28.2/31.9, well above the 8 floor) -- reuses the
// app's existing brand tokens rather than introducing new chart-only
// colors. Both colors WARN on contrast-vs-surface at this weight, so the
// legend below stays text-labeled (not swatch-only), and the tables on
// this page are the accessible non-color fallback.
const REVENUE_COLOR = "#F2952E";
const MARGIN_COLOR = "#2A6FB3";

function formatShortDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function TrendChart({ daily }: { daily: DailyPoint[] }) {
  if (daily.length === 0) {
    return <p className="font-sans text-sm text-muted py-8 text-center">No orders in this month yet.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={daily} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--neutral-bg)" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatShortDate}
          tick={{ fontSize: 12, fill: "var(--muted)" }}
          axisLine={{ stroke: "var(--neutral-bg)" }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v: number) => formatRupees(v)}
          tick={{ fontSize: 12, fill: "var(--muted)" }}
          axisLine={false}
          tickLine={false}
          width={64}
        />
        <Tooltip
          formatter={(value, name) => [formatRupees(Number(value)), String(name)]}
          labelFormatter={(label) => formatShortDate(String(label))}
          contentStyle={{ borderRadius: 12, border: "1px solid var(--neutral-bg)", fontSize: 13 }}
        />
        <Legend wrapperStyle={{ fontSize: 13, color: "var(--foreground)" }} />
        <Line type="monotone" dataKey="revenue" name="Revenue" stroke={REVENUE_COLOR} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 5 }} />
        <Line type="monotone" dataKey="margin" name="Gross margin" stroke={MARGIN_COLOR} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
