import type { ReactNode } from "react";

type Tone = "default" | "tint";
type Divider = "top" | "bottom" | "both" | "none";
type PadY = "sm" | "md" | "lg";

const TONE_MAP: Record<Tone, string> = {
  default: "",
  tint: "bg-white/[0.015]",
};

const PAD_MAP: Record<PadY, string> = {
  sm: "py-16 sm:py-20",
  md: "py-24 sm:py-32",
  lg: "py-28 sm:py-40",
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

export function SectionEyebrow({
  children,
  centered = false,
}: {
  children: ReactNode;
  centered?: boolean;
}) {
  return (
    <div className={`scroll-reveal eyebrow-label mb-6${centered ? " is-centered" : ""}`}>
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
