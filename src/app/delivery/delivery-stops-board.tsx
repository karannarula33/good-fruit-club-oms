"use client";

import { useState } from "react";
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

  function toggle(orderId: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  }

  const dispatchedCount = stops.filter((s) => s.status === "dispatched").length;

  return (
    <div className="space-y-4">
      {dispatchedCount > 0 && (
        <MarkOutForDeliveryButton
          selectedIds={[...selected]}
          onMarked={() => setSelected(new Set())}
        />
      )}

      {stops.length === 0 && <p className="text-neutral-500">Nothing dispatched yet.</p>}

      <div className="space-y-4">
        {stops.map((stop) => (
          <DeliveryStopCard
            key={stop.id}
            stop={stop}
            selectable={stop.status === "dispatched"}
            checked={selected.has(stop.id)}
            onToggle={(checked) => toggle(stop.id, checked)}
          />
        ))}
      </div>
    </div>
  );
}
