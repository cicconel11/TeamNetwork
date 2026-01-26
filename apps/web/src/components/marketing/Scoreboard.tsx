"use client";

import { useEffect, useRef, useState, useCallback } from "react";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface ScoreboardProps {
  stats?: {
    teams: number;
    members: number;
    events: number;
    raised: string;
  };
}

const DEFAULT_STATS = {
  teams: 500,
  members: 50000,
  events: 2500,
  raised: "250K",
};

// Custom easing function (ease out expo)
function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export function Scoreboard({ stats = DEFAULT_STATS }: ScoreboardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [displayValues, setDisplayValues] = useState({
    teams: 0,
    members: 0,
    events: 0,
    raised: "$0",
  });
  const hasAnimated = useRef(false);

  const animateValue = useCallback(
    (
      start: number,
      end: number,
      duration: number,
      onUpdate: (val: number) => void
    ) => {
      const startTime = performance.now();

      function step(currentTime: number) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easedProgress = easeOutExpo(progress);
        const currentValue = Math.round(start + (end - start) * easedProgress);

        onUpdate(currentValue);

        if (progress < 1) {
          requestAnimationFrame(step);
        }
      }

      requestAnimationFrame(step);
    },
    []
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const reduced = prefersReducedMotion();

    if (reduced) {
      // Show final values immediately for reduced motion
      setDisplayValues({
        teams: stats.teams,
        members: stats.members,
        events: stats.events,
        raised: `$${stats.raised}+`,
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !hasAnimated.current) {
            hasAnimated.current = true;

            // Animate count-up for each stat
            const duration = 2000;

            // Teams
            animateValue(0, stats.teams, duration, (val) => {
              setDisplayValues((prev) => ({ ...prev, teams: val }));
            });

            // Members
            animateValue(0, stats.members, duration, (val) => {
              setDisplayValues((prev) => ({ ...prev, members: val }));
            });

            // Events
            animateValue(0, stats.events, duration, (val) => {
              setDisplayValues((prev) => ({ ...prev, events: val }));
            });

            // Raised - animate the numeric portion
            const raisedNum = parseInt(stats.raised.replace(/\D/g, ""), 10);
            animateValue(0, raisedNum, duration, (val) => {
              setDisplayValues((prev) => ({
                ...prev,
                raised: `$${val}K+`,
              }));
            });

            observer.disconnect();
          }
        });
      },
      { threshold: 0.3 }
    );

    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, [stats, animateValue]);

  const formatNumber = (num: number): string => {
    if (num >= 1000) {
      return `${(num / 1000).toFixed(num >= 10000 ? 0 : 1)}K+`;
    }
    return `${num}+`;
  };

  return (
    <section className="relative z-10 py-20 px-6">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-10">
          <h2 className="scroll-reveal font-display text-3xl sm:text-4xl font-bold text-landing-cream mb-4">
            The <span className="text-landing-green">Scoreboard</span>
          </h2>
          <p className="scroll-reveal text-landing-cream/60 text-lg">
            Teams across the country trust TeamNetwork
          </p>
        </div>

        <div
          ref={containerRef}
          className="scoreboard rounded-xl p-6 sm:p-8"
          role="region"
          aria-label="Platform statistics"
        >
          {/* Scoreboard header */}
          <div className="text-center mb-6 pb-4 border-b border-white/10 relative z-10">
            <span className="font-mono text-xs sm:text-sm tracking-[0.3em] text-landing-cream/40 uppercase">
              TeamNetwork Stats
            </span>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 relative z-10">
            <div className="text-center p-4">
              <p
                className="scoreboard-number text-3xl sm:text-4xl lg:text-5xl font-bold mb-2"
                aria-live="polite"
              >
                {formatNumber(displayValues.teams)}
              </p>
              <p className="text-landing-cream/50 text-xs sm:text-sm uppercase tracking-wider">
                Teams
              </p>
            </div>

            <div className="text-center p-4 border-l border-white/10">
              <p
                className="scoreboard-number text-3xl sm:text-4xl lg:text-5xl font-bold mb-2"
                aria-live="polite"
              >
                {formatNumber(displayValues.members)}
              </p>
              <p className="text-landing-cream/50 text-xs sm:text-sm uppercase tracking-wider">
                Members
              </p>
            </div>

            <div className="text-center p-4 lg:border-l border-white/10">
              <p
                className="scoreboard-number text-3xl sm:text-4xl lg:text-5xl font-bold mb-2"
                aria-live="polite"
              >
                {formatNumber(displayValues.events)}
              </p>
              <p className="text-landing-cream/50 text-xs sm:text-sm uppercase tracking-wider">
                Events
              </p>
            </div>

            <div className="text-center p-4 border-l border-white/10">
              <p
                className="scoreboard-number text-3xl sm:text-4xl lg:text-5xl font-bold mb-2"
                aria-live="polite"
              >
                {displayValues.raised}
              </p>
              <p className="text-landing-cream/50 text-xs sm:text-sm uppercase tracking-wider">
                Raised
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
