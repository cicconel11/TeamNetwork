"use client";

import { forwardRef, ButtonHTMLAttributes } from "react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "custom"
  | "landingPrimary"
  | "landingSecondary"
  | "landingGhost";
export type ButtonSize = "sm" | "md" | "lg" | "xl";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
}

export const buttonVariants = (variant: ButtonVariant = "primary", size: ButtonSize = "md") => {
  const baseStyles = "inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl";

  const variants: Record<ButtonVariant, string> = {
    primary: "bg-org-secondary text-org-secondary-foreground hover:opacity-90 focus:ring-org-secondary",
    secondary: "bg-muted text-foreground hover:bg-border focus:ring-org-secondary",
    ghost: "bg-transparent hover:bg-muted focus:ring-org-secondary",
    danger: "bg-error text-white hover:opacity-90 focus:ring-error",
    custom: "focus:ring-org-secondary",
    landingPrimary:
      "landing-primary-cta bg-landing-green-dark text-white font-semibold hover:bg-[#15803d] focus:ring-landing-green",
    landingSecondary:
      "landing-secondary-cta border border-landing-cream/20 bg-landing-cream/10 text-landing-cream hover:bg-landing-cream/20 focus:ring-landing-cream",
    landingGhost:
      "bg-transparent text-landing-cream/80 hover:bg-landing-cream/10 hover:text-landing-cream focus:ring-landing-cream",
  };

  const sizes: Record<ButtonSize, string> = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2.5 text-sm",
    lg: "px-6 py-3 text-base",
    xl: "px-8 py-5 text-base sm:py-6 sm:text-lg",
  };

  return `${baseStyles} ${variants[variant]} ${sizes[size]}`;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant = "primary", size = "md", isLoading, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`${buttonVariants(variant as ButtonVariant, size as ButtonSize)} ${className}`}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading && (
          <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
