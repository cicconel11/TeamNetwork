"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { FeatureCardIcon } from "./icons";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const STATS = [
  { value: 127, label: "Members", prefix: "", format: "number" },
  { value: 24, label: "Events", prefix: "", format: "number" },
  { value: 8200, label: "Donations", prefix: "$", format: "compact" },
] as const;

const FEATURE_SETS = [
  [
    { icon: "users", label: "Member Directory", value: "48 active \u2022 79 alumni" },
    { icon: "calendar", label: "Upcoming", value: "Spring Regatta - Mar 15" },
    { icon: "trophy", label: "Recent Award", value: "Conference Champions 2025" },
  ],
  [
    { icon: "users", label: "Active Roster", value: "23 varsity \u2022 25 JV" },
    { icon: "calendar", label: "Next Practice", value: "Tuesday 4:00 PM" },
    { icon: "trophy", label: "Season Record", value: "12-3 Conference Play" },
  ],
  [
    { icon: "users", label: "Alumni Network", value: "312 connected alumni" },
    { icon: "calendar", label: "Reunion", value: "Homecoming - Oct 18" },
    { icon: "trophy", label: "Hall of Fame", value: "5 new inductees" },
  ],
];

function formatCompact(val: number): string {
  if (val >= 1000) {
    const k = val / 1000;
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return val.toLocaleString();
}

type StatType = (typeof STATS)[number];

function CountUpStat({ stat }: { stat: StatType }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const hasAnimated = useRef(false);
  const reduced = prefersReducedMotion();

  const finalDisplay =
    stat.format === "compact"
      ? `${stat.prefix}${formatCompact(stat.value)}`
      : `${stat.prefix}${stat.value.toLocaleString()}`;

  useEffect(() => {
    const el = ref.current;
    if (!el || hasAnimated.current) return;

    if (reduced) {
      el.textContent = finalDisplay;
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !hasAnimated.current) {
            hasAnimated.current = true;
            const duration = 2000;
            const startTime = performance.now();
            const easeOutExpo = (t: number) =>
              t === 1 ? 1 : 1 - Math.pow(2, -10 * t);

            function step(now: number) {
              const progress = Math.min((now - startTime) / duration, 1);
              const eased = easeOutExpo(progress);
              const current = Math.round(stat.value * eased);
              if (el) {
                el.textContent =
                  stat.format === "compact"
                    ? `${stat.prefix}${formatCompact(current)}`
                    : `${stat.prefix}${current.toLocaleString()}`;
              }
              if (progress < 1) requestAnimationFrame(step);
            }
            requestAnimationFrame(step);
            observer.disconnect();
          }
        });
      },
      { threshold: 0.3 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [stat, finalDisplay, reduced]);

  return (
    <p ref={ref} className="text-2xl font-bold font-mono text-landing-green stat-glow">
      {reduced ? finalDisplay : "0"}
    </p>
  );
}

export function HeroOrgCard() {
  const [featureIndex, setFeatureIndex] = useState(0);
  const [fadeState, setFadeState] = useState<"in" | "out">("in");
  const reduced = prefersReducedMotion();

  const cycleFeatures = useCallback(() => {
    setFadeState("out");
    setTimeout(() => {
      setFeatureIndex((prev) => (prev + 1) % FEATURE_SETS.length);
      setFadeState("in");
    }, 300);
  }, []);

  useEffect(() => {
    if (reduced) return;
    const interval = setInterval(cycleFeatures, 4000);
    return () => clearInterval(interval);
  }, [cycleFeatures, reduced]);

  const features = FEATURE_SETS[featureIndex];

  return (
    <div className="hero-animate relative">
      <div className="bg-landing-navy-light/80 rounded-2xl border border-landing-cream/10 overflow-hidden">
        {/* Org header */}
        <div className="bg-landing-cream/5 border-b border-landing-cream/10 p-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-landing-cream/20 flex items-center justify-center border border-landing-cream/20">
              <span className="font-display font-bold text-landing-cream text-lg">SR</span>
            </div>
            <div>
              <h3 className="font-display font-bold text-xl text-landing-cream">
                South Rock Ridge High School
              </h3>
              <p className="text-sm text-landing-cream/50">Central Pennsylvania</p>
            </div>
          </div>
        </div>

        {/* Quick stats - count-up with breathing glow */}
        <div className="grid grid-cols-3 divide-x divide-landing-cream/10 border-b border-landing-cream/10 bg-[#0a0a0a]">
          {STATS.map((stat) => (
            <div key={stat.label} className="p-4 text-center">
              <CountUpStat stat={stat} />
              <p className="text-xs text-landing-cream/50 uppercase tracking-wider">
                {stat.label}
              </p>
            </div>
          ))}
        </div>

        {/* Feature preview — rotating sets */}
        <div className="p-5 space-y-3">
          {features.map((item) => (
            <div
              key={`${featureIndex}-${item.label}`}
              className={`flex items-center gap-3 p-3 rounded-lg bg-landing-navy/50 transition-opacity duration-300 ${
                fadeState === "in" ? "opacity-100" : "opacity-0"
              }`}
            >
              <div className="w-8 h-8 rounded-lg bg-landing-cream/10 flex items-center justify-center">
                <FeatureCardIcon type={item.icon} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-landing-cream/50">{item.label}</p>
                <p className="text-sm text-landing-cream truncate">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
