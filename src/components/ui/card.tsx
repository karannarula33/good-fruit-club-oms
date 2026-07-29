import { cn } from "@/lib/cn";

export function Card({
  className,
  elevated = false,
  children,
}: {
  className?: string;
  elevated?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[20px] bg-white p-3 space-y-2",
        elevated
          ? "shadow-[0_1px_2px_rgba(0,0,0,.04),0_6px_18px_-10px_rgba(0,0,0,.1)]"
          : "shadow-[0_1px_2px_rgba(0,0,0,.04)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
