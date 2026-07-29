import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { aggregateProcurement, type ProcurementLine } from "@/lib/procurement/aggregate";
import { formatIstDisplay, utcToIstDatetimeLocal } from "@/lib/time/ist";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { MarkSentButton } from "./mark-sent-button";

function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function ProcurementTable({
  rows,
}: {
  rows: { name: string; unitLabel: string | null; qty: number }[];
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500">Nothing here.</p>;
  }
  return (
    <Table>
      <THead>
        <TR>
          <TH>Product</TH>
          <TH>Unit</TH>
          <TH>Qty</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => (
          <TR key={row.name}>
            <TD>{row.name}</TD>
            <TD className="text-neutral-600 dark:text-neutral-400">{row.unitLabel ?? "—"}</TD>
            <TD>{row.qty}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
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
    <div className="p-6 space-y-6">
      <PageHeader
        title="Procurement"
        subtitle="Base list vs extras for a delivery date."
        action={
          <div className="flex items-center gap-3">
            <Link href={`/admin/procurement?date=${addDays(date, -1)}`} className="text-sm underline">
              ← Prev day
            </Link>
            <form>
              <Input type="date" name="date" defaultValue={date} size="sm" />
            </form>
            <Link href={`/admin/procurement?date=${addDays(date, 1)}`} className="text-sm underline">
              Next day →
            </Link>
          </div>
        }
      />

      <Card className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
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

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Base list</h2>
        <ProcurementTable rows={toRows(base)} />
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-danger-text">Extras</h2>
        <ProcurementTable rows={toRows(extras)} />
      </div>
    </div>
  );
}
