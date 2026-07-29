"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/cn";

export type BadgeTone = "brand" | "success" | "warning" | "danger" | "info" | "neutral";

const TONE_CLASS: Record<BadgeTone, string> = {
  brand: "bg-brand text-brand-foreground",
  success: "bg-success-bg text-success-text",
  warning: "bg-warning-bg text-warning-text",
  danger: "bg-danger-bg text-danger-text",
  info: "bg-info-bg text-info-text",
  neutral: "bg-neutral-bg text-neutral-text",
};

// Pass a `key` that changes with whatever value the badge reflects (e.g.
// `key={order.status}`) so a remount plays this pulse -- that's what makes
// a live status change (Realtime, optimistic update) visibly announce
// itself instead of silently swapping color.
// `style` lets a caller pass an exact bg/fg pair (e.g. the design's literal
// per-order-status hex pairs in src/lib/orders/status-display.ts) without
// forcing every color into the generic `tone` palette.
export function Badge({
  tone = "neutral",
  size = "md",
  className,
  style,
  children,
}: {
  tone?: BadgeTone;
  size?: "sm" | "md";
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <motion.span
      initial={{ scale: 1.2, opacity: 0.6 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
      style={style}
      className={cn(
        "inline-flex items-center rounded-full font-sans font-bold whitespace-nowrap",
        size === "sm" ? "px-2.5 py-1 text-[10px] uppercase tracking-wide" : "px-3 py-1.5 text-xs",
        !style && TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </motion.span>
  );
}
