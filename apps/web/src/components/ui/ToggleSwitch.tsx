"use client";

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  label?: string;
  id?: string;
}

export function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
  size = "md",
  label,
  id,
}: ToggleSwitchProps) {
  const trackSize = size === "sm" ? "h-5 w-9" : "h-6 w-11";
  const dotSize = size === "sm" ? "h-3.5 w-3.5" : "h-[18px] w-[18px]";
  const dotTranslate = size === "sm" ? "translate-x-4" : "translate-x-5";

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`
        relative inline-flex shrink-0 cursor-pointer items-center rounded-full
        transition-colors duration-200 ease-in-out
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2
        ${trackSize}
        ${checked ? "bg-green-500" : "bg-muted-foreground/30"}
        ${disabled ? "opacity-50 cursor-not-allowed" : ""}
      `}
    >
      <span
        className={`
          pointer-events-none inline-block rounded-full bg-white shadow-sm
          transform transition-transform duration-200 ease-in-out
          ${dotSize}
          ${checked ? dotTranslate : "translate-x-0.5"}
        `}
      />
    </button>
  );
}
