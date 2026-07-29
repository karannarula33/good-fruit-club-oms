"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

const MotionLink = motion.create(Link);

const TAP_ANIMATION = { scale: 0.96 };
const TAP_TRANSITION = { type: "spring", stiffness: 500, damping: 30 } as const;

// "dark" (ink) is the first-commit CTA (Parse Message, Pack & Close, Dispatch,
// Log In); "primary" is the forward-moving accent CTA (Confirm & Send, Publish,
// Generate Bill, Mark Delivered) -- naming/mapping per the design handoff's own
// "Ink/dark CTA" vs "Accent (primary action color)" distinction.
export type ButtonVariant = "primary" | "dark" | "secondary" | "outline" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-brand text-brand-foreground hover:bg-brand-hover",
  dark: "bg-foreground text-white hover:opacity-90",
  secondary: "bg-neutral-bg text-neutral-text hover:brightness-95",
  outline: "border border-[#ECEAE3] text-foreground hover:bg-neutral-bg",
  ghost: "text-brand hover:opacity-80",
  destructive: "bg-danger-bg text-danger-text hover:brightness-95",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm rounded-xl",
  md: "px-4 py-2.5 text-sm rounded-xl",
  lg: "px-[18px] py-[18px] text-base rounded-2xl",
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
    size = "lg",
    fullWidth = false,
    pill = false,
    pending = false,
    pendingText,
    className,
    children,
    ...rest
  } = props;

  const classes = cn(
    "inline-flex items-center justify-center gap-2 font-sans font-extrabold transition-colors disabled:opacity-50 disabled:pointer-events-none",
    variant === "ghost" ? "px-0 py-0" : SIZE_CLASS[size],
    pill && "!rounded-full",
    VARIANT_CLASS[variant],
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
