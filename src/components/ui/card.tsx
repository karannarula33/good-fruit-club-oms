import { cn } from "@/lib/cn";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-neutral-300 dark:border-neutral-700 p-4 space-y-3 bg-background",
        className,
      )}
    >
      {children}
    </div>
  );
}
