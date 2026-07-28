"use client";

import { useOptimistic, useState } from "react";
import { DeliveryStopCard } from "./delivery-stop-card";
import { MarkOutForDeliveryButton } from "./mark-out-for-delivery-button";
import type { OrderStatus } from "@/lib/supabase/database.types";

interface Stop {
  id: string;
  status: OrderStatus;
  customerName: string;
  phone: string | null;
  address: string;
  zone: string;
  billTotal: number | null;
  netDue: number | null;
}

export function DeliveryStopsBoard({ stops }: { stops: Stop[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [optimisticStops, setOptimisticStatus] = useOptimistic(
    stops,
    (state, update: { ids: string[]; status: OrderStatus }) =>
      state.map((s) => (update.ids.includes(s.id) ? { ...s, status: update.status } : s)),
  );

  function toggle(orderId: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  }

  const dispatchedCount = optimisticStops.filter((s) => s.status === "dispatched").length;

  return (
    <div className="space-y-4">
      {dispatchedCount > 0 && (
        <MarkOutForDeliveryButton
          selectedIds={[...selected]}
          onMarked={() => setSelected(new Set())}
          onOptimisticMark={(ids) => setOptimisticStatus({ ids, status: "out_for_delivery" })}
        />
      )}

      {optimisticStops.length === 0 && <p className="text-neutral-500">Nothing dispatched yet.</p>}

      <div className="space-y-4">
        {optimisticStops.map((stop) => (
          <DeliveryStopCard
            key={stop.id}
            stop={stop}
            selectable={stop.status === "dispatched"}
            checked={selected.has(stop.id)}
            onToggle={(checked) => toggle(stop.id, checked)}
            onOptimisticDeliver={() => setOptimisticStatus({ ids: [stop.id], status: "delivered" })}
          />
        ))}
      </div>
    </div>
  );
}
