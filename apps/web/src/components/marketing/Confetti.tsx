"use client";

import { useEffect, useRef, useState } from "react";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface ConfettiProps {
  colors?: string[];
  particleCount?: number;
}

interface Particle {
  id: number;
  x: number;
  color: string;
  delay: number;
  duration: number;
  size: number;
  rotation: number;
  isCircle: boolean;
}

const DEFAULT_COLORS = [
  "#34d399", // landing-green
  "#10b981", // landing-green-dark
  "#f1f5f9", // landing-cream
  "#e2e8f0", // landing-cream-muted
];

export function Confetti({
  colors = DEFAULT_COLORS,
  particleCount = 50,
}: ConfettiProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [particles, setParticles] = useState<Particle[]>([]);
  const hasTriggered = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const reduced = prefersReducedMotion();
    if (reduced) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !hasTriggered.current) {
            hasTriggered.current = true;

            // Generate confetti particles
            const newParticles: Particle[] = [];
            const count =
              window.innerWidth < 768
                ? Math.floor(particleCount / 2)
                : particleCount;

            for (let i = 0; i < count; i++) {
              newParticles.push({
                id: i,
                x: Math.random() * 100,
                color: colors[Math.floor(Math.random() * colors.length)],
                delay: Math.random() * 500,
                duration: 2000 + Math.random() * 1500,
                size: 6 + Math.random() * 8,
                rotation: Math.random() * 360,
                isCircle: Math.random() > 0.5,
              });
            }

            setParticles(newParticles);

            // Clear particles after animation completes
            setTimeout(() => {
              setParticles([]);
            }, 4000);

            observer.disconnect();
          }
        });
      },
      { threshold: 0.5 }
    );

    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, [colors, particleCount]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden pointer-events-none"
      aria-hidden="true"
    >
      {particles.map((particle) => (
        <div
          key={particle.id}
          className="confetti-particle"
          style={{
            left: `${particle.x}%`,
            top: "-20px",
            width: `${particle.size}px`,
            height: `${particle.size}px`,
            backgroundColor: particle.color,
            animationDelay: `${particle.delay}ms`,
            animationDuration: `${particle.duration}ms`,
            borderRadius: particle.isCircle ? "50%" : "2px",
            transform: `rotate(${particle.rotation}deg)`,
          }}
        />
      ))}
    </div>
  );
}
