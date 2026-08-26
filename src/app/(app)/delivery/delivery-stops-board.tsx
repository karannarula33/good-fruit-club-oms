"use client";

import { useOptimistic, useState } from "react";
import { motion } from "motion/react";
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
  packagingSummary: string | null;
  undeliveredReason: string | null;
}

export function DeliveryStopsBoard({ stops }: { stops: Stop[] }) {
  const [selectedForOutForDelivery, setSelectedForOutForDelivery] = useState<Set<string>>(new Set());

  const [optimisticStops, setOptimisticStopsStatus] = useOptimistic(
    stops,
    (state, update: { ids: string[]; status: OrderStatus }) =>
      state.map((s) => (update.ids.includes(s.id) ? { ...s, status: update.status } : s)),
  );

  function toggleOutForDelivery(orderId: string, checked: boolean) {
    setSelectedForOutForDelivery((prev) => {
      const next = new Set(prev);
      if (checked) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  }

  const dispatchedCount = optimisticStops.filter((s) => s.status === "dispatched").length;

  return (
    <div className="flex flex-col gap-4">
      {dispatchedCount > 0 && (
        <MarkOutForDeliveryButton
          selectedIds={[...selectedForOutForDelivery]}
          onMarked={() => setSelectedForOutForDelivery(new Set())}
          onOptimisticMark={(ids) => setOptimisticStopsStatus({ ids, status: "out_for_delivery" })}
        />
      )}

      {optimisticStops.length === 0 && (
        <p className="font-sans text-sm text-muted">No stops right now — dispatch billed orders to start a route.</p>
      )}

      <div className="flex flex-col gap-3">
        {optimisticStops.map((stop, index) => (
          <motion.div
            key={stop.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05, duration: 0.2 }}
          >
            <DeliveryStopCard
              stop={stop}
              selectable={stop.status === "dispatched"}
              checked={selectedForOutForDelivery.has(stop.id)}
              onToggle={(checked) => toggleOutForDelivery(stop.id, checked)}
              onOptimisticDeliver={() => setOptimisticStopsStatus({ ids: [stop.id], status: "delivered" })}
              onOptimisticUndeliver={() => setOptimisticStopsStatus({ ids: [stop.id], status: "undelivered" })}
            />
          </motion.div>
        ))}
      </div>
    </div>
  );
}
