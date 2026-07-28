"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatIstDisplay } from "@/lib/time/ist";
import type { OrderStatus } from "@/lib/supabase/database.types";
import { DispatchButton } from "./dispatch-button";

interface StatusRow {
  id: string;
  customerName: string;
  zone: string;
  status: OrderStatus;
  statusTimestamps: Record<string, string>;
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  recorded: "Recorded",
  packed: "Packed",
  dispatched: "Dispatched",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const STATUS_CHIP_CLASS: Record<OrderStatus, string> = {
  recorded: "bg-neutral-100 text-neutral-700",
  packed: "bg-amber-100 text-amber-800",
  dispatched: "bg-blue-100 text-blue-800",
  out_for_delivery: "bg-indigo-100 text-indigo-800",
  delivered: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};

const STATUS_ORDER: OrderStatus[] = [
  "recorded",
  "packed",
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

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("orders-status-board")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `delivery_date=eq.${today}` },
        () => router.refresh(),
      )
      .subscribe();

    return () => {
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

  const counts = STATUS_ORDER.map((status) => ({
    status,
    count: initialOrders.filter((o) => o.status === status).length,
  })).filter((s) => s.count > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {counts.map(({ status, count }) => (
          <span
            key={status}
            className={`rounded-full px-3 py-1 text-sm font-medium ${STATUS_CHIP_CLASS[status]}`}
          >
            {STATUS_LABEL[status]}: {count}
          </span>
        ))}
        {isAdmin && (
          <DispatchButton selectedIds={[...selected]} onDispatched={() => setSelected(new Set())} />
        )}
      </div>

      {initialOrders.length === 0 && <p className="text-neutral-500">No orders for today.</p>}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border border-neutral-300 rounded-md">
          <thead>
            <tr className="bg-neutral-100 text-left">
              {isAdmin && <th className="px-3 py-2"></th>}
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Zone</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Since</th>
            </tr>
          </thead>
          <tbody>
            {initialOrders.map((order) => {
              const since = order.statusTimestamps[order.status];
              const dispatchable = order.status === "packed";
              return (
                <tr key={order.id} className="border-t border-neutral-200">
                  {isAdmin && (
                    <td className="px-3 py-2">
                      {dispatchable && (
                        <input
                          type="checkbox"
                          checked={selected.has(order.id)}
                          onChange={(e) => toggle(order.id, e.target.checked)}
                        />
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2">{order.customerName}</td>
                  <td className="px-3 py-2 text-neutral-600">{order.zone}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_CHIP_CLASS[order.status]}`}>
                      {STATUS_LABEL[order.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-neutral-600">
                    {since ? formatIstDisplay(new Date(since)) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
