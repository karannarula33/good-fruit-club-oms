"use client";

import { useOptimistic, useState } from "react";
import { motion } from "motion/react";
import { Card } from "@/components/ui/card";
import { DispatchSelectedButton } from "./dispatch-selected-button";

interface DispatchOrder {
  id: string;
  customerName: string;
  zone: string;
  netDue: number;
  packagingSummary: string | null;
}

export function DispatchBoard({ orders }: { orders: DispatchOrder[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [optimisticOrders, setOptimisticOrders] = useOptimistic(orders, (state, dispatchedIds: string[]) =>
    state.filter((o) => !dispatchedIds.includes(o.id)),
  );

  function toggle(orderId: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  }

  if (optimisticOrders.length === 0) {
    return <p className="font-sans text-sm text-muted">Nothing ready to dispatch — pack and bill orders first.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {optimisticOrders.map((order, index) => (
          <motion.div
            key={order.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05, duration: 0.2 }}
          >
            <Card elevated className="flex items-center gap-3 !space-y-0">
              <input
                type="checkbox"
                checked={selected.has(order.id)}
                onChange={(e) => toggle(order.id, e.target.checked)}
                className="size-4"
              />
              <div className="min-w-0 flex-1">
                <div className="font-sans text-sm font-bold text-foreground">{order.customerName}</div>
                <div className="font-sans text-[11.5px] font-semibold text-muted">{order.zone}</div>
                {order.packagingSummary && (
                  <div className="font-sans text-[11px] font-semibold text-tertiary">{order.packagingSummary}</div>
                )}
              </div>
              <div className="font-display text-sm font-bold text-foreground">₹{order.netDue.toFixed(2)}</div>
            </Card>
          </motion.div>
        ))}
      </div>
      <DispatchSelectedButton
        selectedIds={[...selected]}
        onDispatched={() => setSelected(new Set())}
        onOptimisticDispatch={(ids) => {
          setOptimisticOrders(ids);
          setSelected(new Set());
        }}
      />
    </div>
  );
}
