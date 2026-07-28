import { cn } from "@/lib/cn";

type InputSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<InputSize, string> = {
  sm: "px-2 py-1 text-sm",
  md: "px-3 py-2 text-sm",
  lg: "px-3 py-3 text-lg",
};

export function Input({
  size = "md",
  className,
  ...rest
}: { size?: InputSize; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">) {
  return (
    <input
      className={cn(
        "rounded-md border border-neutral-300 dark:border-neutral-700 bg-background focus:outline-none focus:ring-2 focus:ring-brand",
        SIZE_CLASS[size],
        className,
      )}
      {...rest}
    />
  );
}
