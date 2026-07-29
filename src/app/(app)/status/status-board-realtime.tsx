"use client";

import { useEffect, useOptimistic, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatIstDisplay } from "@/lib/time/ist";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { DISPLAY_STATUS_LABEL, deriveDisplayStatus, displayStatusChipStyle, type DisplayStatus } from "@/lib/orders/status-display";
import type { OrderStatus } from "@/lib/supabase/database.types";
import { DispatchButton } from "./dispatch-button";

interface StatusRow {
  id: string;
  customerName: string;
  zone: string;
  status: OrderStatus;
  hasBill: boolean;
  statusTimestamps: Record<string, string>;
}

const REALTIME_DEBOUNCE_MS = 400;

const DISPLAY_STATUS_ORDER: DisplayStatus[] = [
  "recorded",
  "packed",
  "billed",
  "dispatched",
  "out_for_delivery",
  "delivered",
  "cancelled",
];

export function StatusBoardRealtime({
  initialOrders,
  today,
  isAdmin,
}: {
  initialOrders: StatusRow[];
  today: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [optimisticOrders, setOptimisticStatus] = useOptimistic(
    initialOrders,
    (state, update: { ids: string[]; status: OrderStatus }) =>
      state.map((o) => (update.ids.includes(o.id) ? { ...o, status: update.status } : o)),
  );

  useEffect(() => {
    const supabase = createClient();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const channel = supabase
      .channel("orders-status-board")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `delivery_date=eq.${today}` },
        () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => router.refresh(), REALTIME_DEBOUNCE_MS);
        },
      )
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [today, router]);

  function toggle(orderId: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  }

  const displayStatusOf = (o: StatusRow) => deriveDisplayStatus(o.status, o.hasBill);

  const counts = DISPLAY_STATUS_ORDER.map((status) => ({
    status,
    count: optimisticOrders.filter((o) => displayStatusOf(o) === status).length,
  })).filter((s) => s.count > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {counts.map(({ status, count }) => (
          <Badge key={status} style={displayStatusChipStyle(status)}>
            {DISPLAY_STATUS_LABEL[status]}: {count}
          </Badge>
        ))}
        {isAdmin && (
          <DispatchButton
            selectedIds={[...selected]}
            onDispatched={() => setSelected(new Set())}
            onOptimisticDispatch={(ids) => setOptimisticStatus({ ids, status: "dispatched" })}
          />
        )}
      </div>

      {optimisticOrders.length === 0 && <p className="text-neutral-500">No orders for today.</p>}

      {optimisticOrders.length > 0 && (
        <Table>
          <THead>
            <TR>
              {isAdmin && <TH className="w-8" />}
              <TH>Customer</TH>
              <TH>Zone</TH>
              <TH>Status</TH>
              <TH>Since</TH>
            </TR>
          </THead>
          <TBody>
            {optimisticOrders.map((order) => {
              const since = order.statusTimestamps[order.status];
              // Only packed AND billed orders are dispatch-eligible -- a
              // packed order with no bill yet can't be sent (dispatchPackedOrders
              // re-checks this server-side too, this is just the UI gate).
              const dispatchable = order.status === "packed" && order.hasBill;
              const displayStatus = displayStatusOf(order);
              return (
                <TR key={order.id}>
                  {isAdmin && (
                    <TD>
                      {dispatchable && (
                        <input
                          type="checkbox"
                          checked={selected.has(order.id)}
                          onChange={(e) => toggle(order.id, e.target.checked)}
                        />
                      )}
                    </TD>
                  )}
                  <TD>{order.customerName}</TD>
                  <TD className="text-neutral-600 dark:text-neutral-400">{order.zone}</TD>
                  <TD>
                    <Badge key={displayStatus} style={displayStatusChipStyle(displayStatus)} size="sm">
                      {DISPLAY_STATUS_LABEL[displayStatus]}
                    </Badge>
                  </TD>
                  <TD className="text-neutral-600 dark:text-neutral-400">
                    {since ? formatIstDisplay(new Date(since)) : "—"}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </div>
  );
}
