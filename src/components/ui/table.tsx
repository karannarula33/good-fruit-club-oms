import { cn } from "@/lib/cn";

export function Table({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-300 dark:border-neutral-700">
      <table className={cn("min-w-full text-sm", className)}>{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="bg-neutral-bg">{children}</thead>;
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({ className, children }: { className?: string; children: React.ReactNode }) {
  return <tr className={cn("border-t border-neutral-200 dark:border-neutral-800", className)}>{children}</tr>;
}

export function TH({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <th className={cn("px-3 py-2 text-left font-medium", className)}>{children}</th>;
}

export function TD({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <td className={cn("px-3 py-2", className)}>{children}</td>;
}
