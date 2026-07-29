import { cn } from "@/lib/cn";

// Ported verbatim from the Claude Design prototype's dc-script (renderVals())
// so avatar colors are stable and match the design exactly.
const PALETTE = ["#C7622A", "#3B6B2E", "#7C5AA0", "#B35C1E", "#2E9E5B", "#A23B4E", "#4472C4"];

export function initialsFor(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function colorFor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function Avatar({
  name,
  size = 40,
  shape = "circle",
  className,
}: {
  name: string;
  size?: number;
  shape?: "circle" | "square";
  className?: string;
}) {
  const color = colorFor(name);
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center font-display font-bold",
        shape === "circle" ? "rounded-full" : "rounded-xl",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: `${color}22`,
        color,
        fontSize: Math.round(size * 0.36),
      }}
    >
      {initialsFor(name)}
    </div>
  );
}
