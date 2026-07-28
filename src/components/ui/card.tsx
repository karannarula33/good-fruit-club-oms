import { cn } from "@/lib/cn";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-neutral-300 dark:border-neutral-700 p-3 space-y-2 bg-background",
        className,
      )}
    >
      {children}
    </div>
  );
}
