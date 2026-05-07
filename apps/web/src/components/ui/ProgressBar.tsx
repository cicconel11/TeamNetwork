"use client";

interface ProgressBarProps {
  value: number;
  variant?: "default" | "success" | "error";
  size?: "sm" | "md";
  animated?: boolean;
  label?: string;
  className?: string;
}

const variantClasses: Record<string, string> = {
  default: "bg-[var(--color-org-secondary)]",
  success: "bg-emerald-500",
  error: "bg-red-500",
};

export function ProgressBar({
  value,
  variant = "default",
  size = "sm",
  animated = false,
  label,
  className = "",
}: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  const heightClass = size === "sm" ? "h-1" : "h-1.5";

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label || "Upload progress"}
      className={`w-full ${heightClass} rounded-full bg-[var(--muted)] overflow-hidden ${className}`}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-200 ease-out ${variantClasses[variant] || variantClasses.default} ${animated ? "progress-stripe-animated" : ""}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
