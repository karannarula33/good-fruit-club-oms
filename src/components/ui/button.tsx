"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

const MotionLink = motion.create(Link);

const TAP_ANIMATION = { scale: 0.96 };
const TAP_TRANSITION = { type: "spring", stiffness: 500, damping: 30 } as const;

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

// Native onDrag*/onAnimation* handlers collide with Motion's own prop
// signatures for the same names -- omitted since this Button never needs
// native browser drag-and-drop or CSS animation callbacks.
type ConflictingHtmlProps = "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd";

type ButtonAsButton = SharedProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof SharedProps | ConflictingHtmlProps> & {
    href?: undefined;
  };

type ButtonAsLink = SharedProps &
  Omit<React.ComponentProps<typeof Link>, keyof SharedProps | ConflictingHtmlProps> & { href: string };

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
      <MotionLink
        href={href}
        className={classes}
        whileTap={TAP_ANIMATION}
        transition={TAP_TRANSITION}
        {...linkRest}
      >
        {content}
      </MotionLink>
    );
  }

  const buttonRest = rest as Omit<ButtonAsButton, keyof SharedProps>;
  return (
    <motion.button
      type="button"
      className={classes}
      disabled={pending || buttonRest.disabled}
      whileTap={TAP_ANIMATION}
      transition={TAP_TRANSITION}
      {...buttonRest}
    >
      {content}
    </motion.button>
  );
}
