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
    <div className="hero-animate landing-demo-wrap relative">
      <div className="landing-demo-card overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-landing-cream/10 bg-landing-cream/[0.03] px-5 py-3">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-landing-cream/45">
            <span className="h-2 w-2 rounded-full bg-landing-green shadow-[0_0_16px_rgba(34,197,94,0.75)]" />
            Live Workspace
          </div>
          <div className="rounded-full border border-landing-green/25 bg-landing-green/10 px-3 py-1 text-xs font-semibold text-landing-green">
            Active
          </div>
        </div>

        {/* Org header */}
        <div className="border-b border-landing-cream/10 bg-landing-cream/5 p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-landing-green/30 bg-landing-green/15 shadow-[0_0_28px_rgba(34,197,94,0.16)]">
              <span className="font-display font-bold text-landing-cream text-lg">SR</span>
            </div>
            <div className="min-w-0">
              <h3 className="truncate font-display text-xl font-bold text-landing-cream">
                South Rock Ridge High School
              </h3>
              <p className="text-sm text-landing-cream/50">Central Pennsylvania</p>
            </div>
          </div>
        </div>

        {/* Quick stats - count-up with breathing glow */}
        <div className="grid grid-cols-3 divide-x divide-landing-cream/10 border-b border-landing-cream/10 bg-[#0a0a0a]/80">
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
        <div className="space-y-3 p-5">
          {features.map((item) => (
            <div
              key={`${featureIndex}-${item.label}`}
              className={`flex items-center gap-3 rounded-lg border border-landing-cream/5 bg-landing-navy/55 p-3 transition-opacity duration-300 ${
                fadeState === "in" ? "opacity-100" : "opacity-0"
              }`}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-landing-cream/10">
                <FeatureCardIcon type={item.icon} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-landing-cream/50">{item.label}</p>
                <p className="text-sm text-landing-cream truncate">{item.value}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-landing-cream/10 bg-landing-cream/[0.03] px-5 py-4">
          <div className="flex items-center justify-between text-xs text-landing-cream/45">
            <span>Invite code ready</span>
            <span>82% complete</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-landing-cream/10">
            <div className="h-full w-[82%] rounded-full bg-gradient-to-r from-landing-green-dark to-landing-green" />
          </div>
        </div>
      </div>
    </div>
  );
}
