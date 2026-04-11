"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setVisible(window.scrollY > 400);
    }

    // Check initial position (e.g., page refresh mid-scroll)
    handleScroll();

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  if (!visible) return null;

  return (
    <Link
      href="#top"
      aria-label="Back to top"
      className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 rounded-full border border-landing-cream/20 bg-landing-navy/80 px-4 py-3 text-sm font-semibold text-landing-cream/80 shadow-lg backdrop-blur transition hover:-translate-y-1 hover:bg-landing-cream/10 hover:text-landing-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-landing-green/60 focus-visible:ring-offset-2 focus-visible:ring-offset-landing-navy"
    >
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 19V5" />
        <path d="m5 12 7-7 7 7" />
      </svg>
      Top
    </Link>
  );
}
