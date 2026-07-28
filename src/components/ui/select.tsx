import { cn } from "@/lib/cn";

type SelectSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<SelectSize, string> = {
  sm: "px-2 py-1 text-sm",
  md: "px-3 py-2 text-sm",
  lg: "px-3 py-3 text-lg",
};

export function Select({
  size = "md",
  className,
  children,
  ...rest
}: { size?: SelectSize; className?: string; children: React.ReactNode } & Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  "size"
>) {
  return (
    <select
      className={cn(
        "rounded-md border border-neutral-300 dark:border-neutral-700 bg-background focus:outline-none focus:ring-2 focus:ring-brand",
        SIZE_CLASS[size],
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}
