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
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm",
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
