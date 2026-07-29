import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { aggregateProcurement, type ProcurementLine } from "@/lib/procurement/aggregate";
import { formatIstDisplay, utcToIstDatetimeLocal } from "@/lib/time/ist";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { MarkSentButton } from "./mark-sent-button";

function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function ProcurementRows({
  rows,
  tint = false,
}: {
  rows: { name: string; unitLabel: string | null; qty: number }[];
  tint?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="font-sans text-sm text-muted">Nothing here.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <Card
          key={row.name}
          elevated={!tint}
          className={cn("flex items-center justify-between !space-y-0", tint && "bg-[#FFF4E8]")}
        >
          <div className="font-sans text-sm font-bold text-foreground">{row.name}</div>
          <div className="font-sans text-[12.5px] font-semibold text-muted">
            {row.qty} {row.unitLabel ?? ""}
          </div>
        </Card>
      ))}
    </div>
  );
}

export default async function AdminProcurementPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireRole(["admin"]);

  const params = await searchParams;
  const date = params.date ?? utcToIstDatetimeLocal(new Date()).slice(0, 10);

  const supabase = await createClient();

  const [{ data: orders }, { data: products }, { data: mark }] = await Promise.all([
    supabase.from("orders").select("id, placed_at").eq("delivery_date", date).neq("status", "cancelled"),
    supabase.from("products").select("id, name, unit_label"),
    supabase
      .from("procurement_marks")
      .select("list_sent_at, profiles(full_name)")
      .eq("delivery_date", date)
      .maybeSingle(),
  ]);

  const orderIds = (orders ?? []).map((o) => o.id);
  const placedAtByOrderId = new Map((orders ?? []).map((o) => [o.id, new Date(o.placed_at)]));

  const { data: orderLines } = orderIds.length
    ? await supabase.from("order_lines").select("order_id, product_id, ordered_qty").in("order_id", orderIds)
    : { data: [] };

  const lines: ProcurementLine[] = (orderLines ?? [])
    .filter((line) => line.product_id && line.ordered_qty !== null)
    .map((line) => ({
      productId: line.product_id as string,
      qty: line.ordered_qty as number,
      placedAt: placedAtByOrderId.get(line.order_id) as Date,
    }));

  const listSentAt = mark ? new Date(mark.list_sent_at) : null;
  const { base, extras } = aggregateProcurement(lines, listSentAt);

  const productById = new Map((products ?? []).map((p) => [p.id, p]));
  function toRows(bucket: Map<string, number>) {
    return [...bucket.entries()]
      .map(([productId, qty]) => {
        const product = productById.get(productId);
        return product ? { name: product.name, unitLabel: product.unit_label, qty } : null;
      })
      .filter((row): row is { name: string; unitLabel: string | null; qty: number } => row !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const sentByName = (mark?.profiles as unknown as { full_name: string } | null)?.full_name;

  return (
    <div className="flex flex-col gap-5 px-[18px] pt-5 pb-6">
      <PageHeader
        title="Procurement"
        subtitle="Before the mandi run"
        action={
          <div className="flex items-center gap-3">
            <Link href={`/admin/procurement?date=${addDays(date, -1)}`} className="font-sans text-sm font-bold text-muted">
              ← Prev
            </Link>
            <form>
              <Input type="date" name="date" defaultValue={date} size="sm" />
            </form>
            <Link href={`/admin/procurement?date=${addDays(date, 1)}`} className="font-sans text-sm font-bold text-muted">
              Next →
            </Link>
          </div>
        }
      />

      <Card elevated className="flex items-center justify-between flex-wrap gap-3">
        <p className="font-sans text-sm text-[#5b5e66]">
          {listSentAt ? (
            <>
              Sent to vendor at {formatIstDisplay(listSentAt)}
              {sentByName ? ` by ${sentByName}` : ""}
            </>
          ) : (
            "Not yet sent to vendor."
          )}
        </p>
        {!listSentAt && <MarkSentButton deliveryDate={date} />}
      </Card>

      <div className="flex flex-col gap-2">
        <div className="px-0.5 font-sans text-[11px] font-bold uppercase tracking-wide text-muted">Sent to vendor</div>
        <ProcurementRows rows={toRows(base)} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="px-0.5 font-sans text-[11px] font-bold uppercase tracking-wide text-muted">New extras</div>
        <ProcurementRows rows={toRows(extras)} tint />
      </div>
    </div>
  );
}
