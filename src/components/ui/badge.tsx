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
export function Badge({
  tone = "neutral",
  size = "md",
  className,
  children,
}: {
  tone?: BadgeTone;
  size?: "sm" | "md";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.span
      initial={{ scale: 1.2, opacity: 0.6 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
      className={cn(
        "inline-flex items-center rounded-full font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm",
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </motion.span>
  );
}
