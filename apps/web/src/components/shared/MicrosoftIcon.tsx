interface MicrosoftIconProps {
  className?: string;
}

export function MicrosoftIcon({ className = "w-5 h-5" }: MicrosoftIconProps) {
  return (
    <svg className={className} viewBox="0 0 23 23" fill="none">
      <path fill="#f3f3f3" d="M0 0h23v23H0z" />
      <path fill="#f35325" d="M1 1h10v10H1z" />
      <path fill="#81bc06" d="M12 1h10v10H12z" />
      <path fill="#05a6f0" d="M1 12h10v10H1z" />
      <path fill="#ffba08" d="M12 12h10v10H12z" />
    </svg>
  );
}
