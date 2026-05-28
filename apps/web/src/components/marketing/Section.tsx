import type { ReactNode } from "react";

type Tone = "default" | "tint";
type Divider = "top" | "bottom" | "both" | "none";
type PadY = "sm" | "md" | "lg";

const TONE_MAP: Record<Tone, string> = {
  default: "",
  tint: "bg-landing-navy-light/20",
};

const PAD_MAP: Record<PadY, string> = {
  sm: "py-14 sm:py-16",
  md: "py-20 sm:py-24",
  lg: "py-24 sm:py-28",
};

interface SectionProps {
  id?: string;
  tone?: Tone;
  divider?: Divider;
  padY?: PadY;
  eyebrow?: string;
  className?: string;
  children: ReactNode;
}

function Divider() {
  return (
    <div className="h-px bg-gradient-to-r from-transparent via-landing-cream/10 to-transparent" />
  );
}

export function SectionEyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="scroll-reveal inline-block px-4 py-1.5 rounded-full bg-landing-cream/5 text-landing-cream/60 text-xs uppercase tracking-[0.2em] mb-6">
      {children}
    </div>
  );
}

export function Section({
  id,
  tone = "default",
  divider = "none",
  padY = "md",
  eyebrow,
  className = "",
  children,
}: SectionProps) {
  const showTop = divider === "top" || divider === "both";
  const showBottom = divider === "bottom" || divider === "both";

  return (
    <>
      {showTop && <Divider />}
      <section
        id={id}
        className={`relative z-10 ${PAD_MAP[padY]} ${TONE_MAP[tone]} ${className}`.trim()}
      >
        {eyebrow ? (
          <div className="text-center">
            <SectionEyebrow>{eyebrow}</SectionEyebrow>
          </div>
        ) : null}
        {children}
      </section>
      {showBottom && <Divider />}
    </>
  );
}
