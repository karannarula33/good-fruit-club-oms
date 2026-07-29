"use client";

import { useOptimistic, useState } from "react";
import { motion } from "motion/react";
import { Card } from "@/components/ui/card";
import { DeliveryStopCard } from "./delivery-stop-card";
import { MarkOutForDeliveryButton } from "./mark-out-for-delivery-button";
import { DispatchSelectedButton } from "./dispatch-selected-button";
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

export function DeliveryStopsBoard({
  readyToDispatch,
  stops,
  isAdmin,
}: {
  readyToDispatch: Stop[];
  stops: Stop[];
  isAdmin: boolean;
}) {
  const [selectedForDispatch, setSelectedForDispatch] = useState<Set<string>>(new Set());
  const [selectedForOutForDelivery, setSelectedForOutForDelivery] = useState<Set<string>>(new Set());

  const [optimisticReady, setOptimisticReadyStatus] = useOptimistic(
    readyToDispatch,
    (state, update: { ids: string[]; status: OrderStatus }) =>
      state.filter((s) => !update.ids.includes(s.id)),
  );
  const [optimisticStops, setOptimisticStopsStatus] = useOptimistic(
    stops,
    (state, update: { ids: string[]; status: OrderStatus }) =>
      state.map((s) => (update.ids.includes(s.id) ? { ...s, status: update.status } : s)),
  );

  function toggleDispatch(orderId: string, checked: boolean) {
    setSelectedForDispatch((prev) => {
      const next = new Set(prev);
      if (checked) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  }
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
      {isAdmin && optimisticReady.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="px-0.5 font-sans text-[11px] font-bold uppercase tracking-wide text-muted">
            Ready to dispatch
          </div>
          {optimisticReady.map((order) => (
            <Card key={order.id} elevated className="flex items-center gap-3 !space-y-0">
              <input
                type="checkbox"
                checked={selectedForDispatch.has(order.id)}
                onChange={(e) => toggleDispatch(order.id, e.target.checked)}
                className="size-4"
              />
              <div className="min-w-0 flex-1">
                <div className="font-sans text-sm font-bold text-foreground">{order.customerName}</div>
                <div className="font-sans text-[11.5px] font-semibold text-muted">{order.zone}</div>
              </div>
              <div className="font-display text-sm font-bold text-foreground">
                ₹{(order.netDue ?? 0).toFixed(2)}
              </div>
            </Card>
          ))}
          <DispatchSelectedButton
            selectedIds={[...selectedForDispatch]}
            onDispatched={() => setSelectedForDispatch(new Set())}
            onOptimisticDispatch={(ids) => {
              setOptimisticReadyStatus({ ids, status: "dispatched" });
              setSelectedForDispatch(new Set());
            }}
          />
        </div>
      )}

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
            />
          </motion.div>
        ))}
      </div>
    </div>
  );
}
