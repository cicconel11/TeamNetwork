import { HTMLAttributes } from "react";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "primary" | "success" | "warning" | "error" | "muted";
  /** Additional context for screen readers (e.g., "Status: Active" for a badge showing "Active") */
  "aria-label"?: string;
}

export function Badge({ className = "", variant = "muted", children, ...props }: BadgeProps) {
  const variants = {
    primary: "badge-primary",
    success: "badge-success",
    warning: "badge-warning",
    error: "badge-error",
    muted: "badge-muted",
  };

  return (
    <span className={`badge ${variants[variant]} ${className}`} {...props}>
      {children}
    </span>
  );
}

