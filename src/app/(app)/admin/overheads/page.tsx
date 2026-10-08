import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { OverheadForm, DeleteOverheadButton } from "./overhead-form";

const TYPE_LABEL: Record<string, string> = { ads: "Ads", day_level: "Day-level cost", other: "Other" };
const rupees = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const date = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function OverheadsPage() {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const today = utcToIstDatetimeLocal(new Date()).slice(0, 10);
  const { data, error } = await supabase
    .from("overhead_entries")
    .select("id, entry_date, category, amount, note")
    .order("entry_date", { ascending: false });

  const rows = data ?? [];
  const byMonth = new Map<string, number>();
  for (const r of rows) byMonth.set(r.entry_date.slice(0, 7), (byMonth.get(r.entry_date.slice(0, 7)) ?? 0) + Number(r.amount));

  return (
    <div className="flex flex-col gap-5 px-[18px] pt-5 pb-10 max-w-3xl">
      <PageHeader
        title="Overheads"
        backHref="/admin/dashboard"
        backLabel="Dashboard"
        subtitle="Costs that belong to a day, not an order: ads, COD remittance fees, Mover minimums. The dashboard takes them off contribution for Net after overheads. Packer pay is already counted per order, so don't add it here."
      />
      {error ? (
        <Card><p className="font-sans text-sm text-danger-text">Overheads aren&apos;t set up yet. Run migration 0032 in Supabase, then reload.</p></Card>
      ) : (
        <>
          <Card elevated>
            <p className="font-sans text-sm font-bold text-foreground px-1">Add a cost</p>
            <OverheadForm today={today} />
          </Card>
          <Card>
            <div className="flex flex-wrap gap-x-5 gap-y-1 px-1 font-sans text-xs text-muted tabular-nums">
              {[...byMonth.entries()].map(([m, v]) => (
                <span key={m}><b className="text-foreground">{m}</b> {rupees(v)}</span>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm font-sans tabular-nums">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-muted">
                    <th className="py-1.5 px-2 text-left font-semibold">Date</th>
                    <th className="py-1.5 px-2 text-left font-semibold">Type</th>
                    <th className="py-1.5 px-2 text-right font-semibold">Amount</th>
                    <th className="py-1.5 px-2 text-left font-semibold">Note</th>
                    <th className="py-1.5 px-2" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-neutral-bg">
                      <td className="py-1.5 px-2 whitespace-nowrap">{date(r.entry_date)}</td>
                      <td className="py-1.5 px-2">{TYPE_LABEL[r.category] ?? r.category}</td>
                      <td className="py-1.5 px-2 text-right">{rupees(Number(r.amount))}</td>
                      <td className="py-1.5 px-2 text-muted">{r.note}</td>
                      <td className="py-1.5 px-2 text-right"><DeleteOverheadButton id={r.id} /></td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={5} className="py-4 px-2 text-center text-muted">No overheads yet. Add your first ad or day-level cost above.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
