"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// Re-fetches the dashboard on a timer while the tab is visible, and right away
// when the admin comes back to the tab, so the insights follow new orders,
// packing and cost entries without a manual reload.
export function AutoRefresh({ seconds = 120, renderedAt }: { seconds?: number; renderedAt: string }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(refresh, seconds * 1000);
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, seconds]);

  const mins = Math.max(0, Math.floor((now - Date.parse(renderedAt)) / 60_000));
  return (
    <span className="font-sans text-[11px] text-tertiary" aria-live="polite">
      Updated {mins === 0 ? "just now" : `${mins} min ago`} · refreshes every {Math.round(seconds / 60)} min
    </span>
  );
}
