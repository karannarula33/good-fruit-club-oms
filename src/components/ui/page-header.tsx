import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export function PageHeader({
  title,
  subtitle,
  backHref,
  backLabel = "Back",
  action,
}: {
  title: string;
  subtitle?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        {backHref && (
          <Link href={backHref} className="inline-flex items-center gap-1 font-sans text-[13.5px] font-bold text-muted mb-1.5">
            <ChevronLeft className="size-4" aria-hidden="true" />
            {backLabel}
          </Link>
        )}
        <h1 className="font-display text-[23px] font-bold text-foreground">{title}</h1>
        {subtitle && <p className="mt-[3px] font-sans text-xs font-medium text-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
