"use client";

import { useEffect, useRef } from "react";
import { animate, stagger } from "animejs";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function StadiumLightBeams() {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!containerRef.current || hasAnimated.current) return;
    hasAnimated.current = true;

    const reduced = prefersReducedMotion();
    const beams = containerRef.current.querySelectorAll<HTMLElement>(".light-beam");

    if (reduced) {
      // Show static beams for reduced motion
      beams.forEach((beam) => {
        beam.style.opacity = "0.15";
        beam.style.transform = "rotate(5deg) translateY(0)";
      });
      return;
    }

    // Animate light beams sweeping across
    animate(beams, {
      opacity: [0, 0.25, 0.15],
      rotate: [-25, 8],
      translateY: ["-30%", "0%"],
      duration: 1800,
      ease: "out(3)",
      delay: stagger(200, { start: 200 }),
    });
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none -z-10"
      aria-hidden="true"
    >
      {/* Light beam 1 - far left */}
      <div
        className="light-beam opacity-0"
        style={{
          left: "10%",
          top: "-20%",
        }}
      />
      {/* Light beam 2 - left center */}
      <div
        className="light-beam opacity-0"
        style={{
          left: "30%",
          top: "-15%",
        }}
      />
      {/* Light beam 3 - right center */}
      <div
        className="light-beam opacity-0"
        style={{
          right: "30%",
          top: "-15%",
        }}
      />
      {/* Light beam 4 - far right */}
      <div
        className="light-beam opacity-0"
        style={{
          right: "10%",
          top: "-20%",
        }}
      />

      {/* Subtle ambient glow at top */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-[300px]"
        style={{
          background:
            "radial-gradient(ellipse at center top, rgba(241, 245, 249, 0.05) 0%, transparent 70%)",
        }}
      />
    </div>
  );
}
