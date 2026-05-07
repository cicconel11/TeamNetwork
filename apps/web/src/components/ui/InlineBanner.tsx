import type { HTMLAttributes, ReactNode } from "react";

const variantStyles = {
  error: "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400",
  success: "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300",
  warning: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300",
  info: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300",
} as const;

interface InlineBannerProps extends HTMLAttributes<HTMLDivElement> {
  variant: keyof typeof variantStyles;
  children: ReactNode;
}

export function InlineBanner({
  variant,
  children,
  className = "",
  ...rest
}: InlineBannerProps) {
  return (
    <div
      role="alert"
      aria-live={variant === "error" ? "assertive" : "polite"}
      className={`rounded-md px-3 py-2 text-sm ${variantStyles[variant]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
