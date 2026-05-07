"use client";

import { motion } from "framer-motion";

function FloatingPaths({ position }: { position: number }) {
  const paths = Array.from({ length: 40 }, (_, i) => {
    const drift = i * 10 * position;
    const x0 = -(600 - drift);
    const y0 = -(189 + i * 12);
    const x1 = -(312 - drift);
    const y1 = 216 - i * 12;
    const x2 = 400 - drift;
    const y2 = 343 - i * 12;
    const x3 = 1100 - drift;
    const y3 = 470 - i * 12;
    const x4 = 1400 - drift;
    const y4 = 875 - i * 12;
    return {
      id: i,
      d: `M${x0} ${y0}C${x0} ${y0} ${x1} ${y1} ${x2} ${y2}C${x3} ${y3} ${x4} ${y4} ${x4} ${y4}`,
      width: 0.4 + i * 0.02,
    };
  });

  return (
    <svg
      className="absolute inset-0 h-full w-full text-landing-cream"
      viewBox="0 0 1400 316"
      fill="none"
      preserveAspectRatio="xMidYMid slice"
    >
      <title>Background Paths</title>
      {paths.map((path) => (
        <motion.path
          key={path.id}
          d={path.d}
          stroke="currentColor"
          strokeWidth={path.width}
          strokeOpacity={0.04 + path.id * 0.015}
          initial={{ pathLength: 0.3, opacity: 0.25 }}
          animate={{
            pathLength: 1,
            opacity: [0.1, 0.25, 0.1],
            pathOffset: [0, 1, 0],
          }}
          transition={{
            duration: 20 + Math.random() * 10,
            repeat: Number.POSITIVE_INFINITY,
            ease: "linear",
          }}
        />
      ))}
    </svg>
  );
}

export function BackgroundPaths() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{
        WebkitMaskImage:
          "radial-gradient(ellipse 95% 80% at 50% 50%, black 30%, transparent 100%)",
        maskImage:
          "radial-gradient(ellipse 95% 80% at 50% 50%, black 30%, transparent 100%)",
      }}
    >
      <FloatingPaths position={1} />
    </div>
  );
}
