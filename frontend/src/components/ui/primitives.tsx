"use client";

import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

// ======================================================================
// BUTTON — quiet, hairline, Linear-style
// ======================================================================
type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-fg text-ink hover:bg-white",
  secondary: "bg-ink-800 text-fg border border-line-strong hover:bg-ink-700",
  ghost: "text-fg-muted hover:text-fg hover:bg-white/[0.06]",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-8 px-3 text-[13px] gap-2",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md font-medium transition-colors",
        "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-signal-green",
        "disabled:pointer-events-none disabled:opacity-40",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className
      )}
      {...props}
    />
  );
});

export const IconButton = React.forwardRef<HTMLButtonElement, ButtonProps>(function IconButton(
  { className, size = "md", ...props },
  ref
) {
  return (
    <Button
      ref={ref}
      variant="ghost"
      size={size}
      className={cn(size === "sm" ? "w-7 px-0" : "w-8 px-0", className)}
      {...props}
    />
  );
});

// ======================================================================
// TYPOGRAPHY
// ======================================================================
export const Kicker: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <span
    className={cn(
      "font-display text-[11px] font-bold uppercase tracking-[0.14em] text-fg-subtle",
      className
    )}
  >
    {children}
  </span>
);

export const Tag: React.FC<{
  children: React.ReactNode;
  tone?: "neutral" | "green" | "magenta" | "solid";
  className?: string;
}> = ({ children, tone = "neutral", className }) => {
  const tones = {
    neutral: "border-line-strong text-fg-muted",
    green: "border-signal-green/40 text-signal-green",
    magenta: "border-signal-magenta/50 text-signal-magenta",
    solid: "border-fg bg-fg text-ink",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-[3px] border px-1.5 font-mono text-[10px] font-medium uppercase tracking-wide",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
};

// ======================================================================
// MODAL SHELL
// ======================================================================
export interface ModalShellProps {
  kicker?: string;
  title: string;
  description?: string;
  onClose: () => void;
  headerActions?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}

export const ModalShell: React.FC<ModalShellProps> = ({
  kicker,
  title,
  description,
  onClose,
  headerActions,
  footer,
  className,
  bodyClassName,
  children,
}) => {
  const { t } = useI18n();
  const closeLabel = t("common.close");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Only a press that starts AND ends on the backdrop closes the modal, so a text
  // selection dragged out of the panel doesn't dismiss it.
  const pressStartedOnBackdrop = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4"
      onMouseDown={(e) => {
        pressStartedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressStartedOnBackdrop.current && e.target === e.currentTarget) onClose();
        pressStartedOnBackdrop.current = false;
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-line-strong bg-ink-900 shadow-[0_24px_80px_rgba(0,0,0,0.6)] outline-none",
          className
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {kicker && <Kicker className="text-signal-green">{kicker}</Kicker>}
            <h2 className="font-display text-2xl font-bold uppercase leading-none tracking-tight text-fg">
              {title}
            </h2>
            {description && <p className="mt-1.5 text-[13px] text-fg-muted">{description}</p>}
          </div>
          <div className="flex items-center gap-1">
            {headerActions}
            <IconButton onClick={onClose} aria-label={closeLabel} title={closeLabel}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        </div>

        <div className={cn("flex-1 overflow-y-auto", bodyClassName)}>{children}</div>

        {footer && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
