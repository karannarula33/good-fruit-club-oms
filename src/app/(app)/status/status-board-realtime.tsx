"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DISPLAY_STATUS_LABEL, deriveDisplayStatus, displayStatusChipStyle } from "@/lib/orders/status-display";
import type { OrderStatus } from "@/lib/supabase/database.types";

interface StatusRow {
  id: string;
  customerName: string;
  zone: string;
  status: OrderStatus;
  hasBill: boolean;
  statusTimestamps: Record<string, string>;
}

const REALTIME_DEBOUNCE_MS = 400;

export function StatusBoardRealtime({ initialOrders, today }: { initialOrders: StatusRow[]; today: string }) {
  const router = useRouter();

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

  if (initialOrders.length === 0) {
    return <p className="font-sans text-sm text-muted">No orders for today.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {initialOrders.map((order) => {
        const displayStatus = deriveDisplayStatus(order.status, order.hasBill);
        return (
          <Card key={order.id} elevated className="flex items-center justify-between !space-y-0">
            <div>
              <div className="font-display text-[14.5px] font-bold text-foreground">{order.customerName}</div>
              <div className="mt-0.5 font-sans text-[11.5px] font-semibold text-muted">{order.zone}</div>
            </div>
            <Badge key={displayStatus} style={displayStatusChipStyle(displayStatus)} size="sm">
              {DISPLAY_STATUS_LABEL[displayStatus]}
            </Badge>
          </Card>
        );
      })}
    </div>
  );
}
