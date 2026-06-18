interface SpinnerProps {
  /** Tailwind classes for sizing/color, e.g. "h-4 w-4 text-org-secondary". */
  className?: string;
  /** Accessible label announced to screen readers. Defaults to "Loading". */
  label?: string;
}

/**
 * The single shared loading spinner. Prefer this over hand-rolled `animate-spin`
 * SVGs. (The `Button` component keeps its own inline spinner for `isLoading`.)
 */
export function Spinner({ className = "h-5 w-5", label = "Loading" }: SpinnerProps) {
  return (
    <svg
      className={`animate-spin motion-reduce:animate-none ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      role="status"
      aria-label={label}
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
