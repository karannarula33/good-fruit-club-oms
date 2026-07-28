import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-brand text-brand-foreground hover:bg-brand-hover",
  secondary: "bg-neutral-bg text-neutral-text hover:brightness-95",
  outline: "border border-neutral-300 text-neutral-900 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-900",
  ghost: "text-neutral-600 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 px-0 py-0",
  destructive: "bg-danger text-white hover:opacity-90",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-4 py-3 text-lg",
};

interface SharedProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  pill?: boolean;
  pending?: boolean;
  pendingText?: string;
  className?: string;
  children: React.ReactNode;
}

type ButtonAsButton = SharedProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof SharedProps> & { href?: undefined };

type ButtonAsLink = SharedProps &
  Omit<React.ComponentProps<typeof Link>, keyof SharedProps> & { href: string };

export function Button(props: ButtonAsButton | ButtonAsLink) {
  const {
    variant = "primary",
    size = "md",
    fullWidth = false,
    pill = false,
    pending = false,
    pendingText,
    className,
    children,
    ...rest
  } = props;

  const classes = cn(
    "inline-flex items-center justify-center gap-2 font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none",
    pill ? "rounded-full" : "rounded-md",
    VARIANT_CLASS[variant],
    variant !== "ghost" && SIZE_CLASS[size],
    fullWidth && "w-full",
    className,
  );

  const content = (
    <>
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {pending && pendingText ? pendingText : children}
    </>
  );

  if ("href" in props && props.href) {
    const { href, ...linkRest } = rest as Omit<ButtonAsLink, keyof SharedProps>;
    return (
      <Link href={href} className={classes} {...linkRest}>
        {content}
      </Link>
    );
  }

  const buttonRest = rest as Omit<ButtonAsButton, keyof SharedProps>;
  return (
    <button type="button" className={classes} disabled={pending || buttonRest.disabled} {...buttonRest}>
      {content}
    </button>
  );
}
