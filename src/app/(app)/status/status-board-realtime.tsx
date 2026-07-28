"use client";

import { useEffect, useOptimistic, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatIstDisplay } from "@/lib/time/ist";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, ORDER_STATUS_ORDER } from "@/lib/orders/status-display";
import type { OrderStatus } from "@/lib/supabase/database.types";
import { DispatchButton } from "./dispatch-button";

interface StatusRow {
  id: string;
  customerName: string;
  zone: string;
  status: OrderStatus;
  statusTimestamps: Record<string, string>;
}

const REALTIME_DEBOUNCE_MS = 400;

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

  const counts = ORDER_STATUS_ORDER.map((status) => ({
    status,
    count: optimisticOrders.filter((o) => o.status === status).length,
  })).filter((s) => s.count > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {counts.map(({ status, count }) => (
          <Badge key={status} tone={ORDER_STATUS_TONE[status]}>
            {ORDER_STATUS_LABEL[status]}: {count}
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
              const dispatchable = order.status === "packed";
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
                    <Badge tone={ORDER_STATUS_TONE[order.status]} size="sm">
                      {ORDER_STATUS_LABEL[order.status]}
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
