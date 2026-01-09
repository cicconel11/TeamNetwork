"use client";

import { useEffect, useState } from "react";

interface Orb {
  id: number;
  x: number;
  y: number;
  size: number;
  delay: number;
  color: string;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  duration: number;
  delay: number;
}

export function AppBackgroundEffects() {
  const [mounted, setMounted] = useState(false);
  const [orbs, setOrbs] = useState<Orb[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    setMounted(true);
    
    // Generate orbs - more vibrant colors matching landing page
    const orbColors = [
      "rgba(16, 185, 129, 0.15)",  // emerald-500 - more visible
      "rgba(52, 211, 153, 0.12)", // emerald-400
      "rgba(6, 182, 212, 0.1)",   // cyan-500
      "rgba(34, 197, 94, 0.08)",  // green-500
    ];
    
    const newOrbs: Orb[] = [
      { id: 0, x: -10, y: -10, size: 500, delay: 0, color: orbColors[0] },
      { id: 1, x: 80, y: 15, size: 400, delay: -8, color: orbColors[1] },
      { id: 2, x: 10, y: 60, size: 450, delay: -15, color: orbColors[2] },
      { id: 3, x: 60, y: 70, size: 350, delay: -20, color: orbColors[3] },
    ];
    
    setOrbs(newOrbs);

    // Generate floating particles like landing page
    const particleCount = 15;
    const newParticles: Particle[] = [];
    for (let i = 0; i < particleCount; i++) {
      newParticles.push({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 3 + 1,
        duration: Math.random() * 15 + 10,
        delay: Math.random() * -15,
      });
    }
    setParticles(newParticles);
  }, []);

  if (!mounted) return null;

  // Check for reduced motion preference
  if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return null;
  }

  return (
    <>
      {/* Stripe pattern overlay like landing page */}
      <div className="fixed inset-0 stripe-pattern pointer-events-none z-0 opacity-30" />
      
      {/* Gradient orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        {orbs.map((orb) => (
          <div
            key={orb.id}
            className="gradient-orb"
            style={{
              left: `${orb.x}%`,
              top: `${orb.y}%`,
              width: `${orb.size}px`,
              height: `${orb.size}px`,
              background: orb.color,
              animationDelay: `${orb.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Floating particles */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        {particles.map((p) => (
          <div
            key={p.id}
            className="absolute rounded-full bg-emerald-500 opacity-20"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              animation: `float-particle ${p.duration}s linear infinite`,
              animationDelay: `${p.delay}s`,
              willChange: "transform, opacity",
            }}
          />
        ))}
        <style jsx>{`
          @keyframes float-particle {
            0% {
              transform: translateY(0) translateX(0);
              opacity: 0;
            }
            10% {
              opacity: 0.25;
            }
            90% {
              opacity: 0.25;
            }
            100% {
              transform: translateY(-80px) translateX(15px);
              opacity: 0;
            }
          }
        `}</style>
      </div>
    </>
  );
}
