"use client";

import { useEffect, useRef } from "react";
import { animate, createScope, stagger } from "animejs";
import type { Scope } from "animejs";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useAnimationScope() {
  const scopeRef = useRef<Scope | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const scope = createScope({ root: containerRef.current });
    scopeRef.current = scope;
    return () => {
      scope.revert();
    };
  }, []);

  return { containerRef, scopeRef };
}

export function useHeroEntrance(selector: string) {
  const reduced = prefersReducedMotion();

  useEffect(() => {
    const elements = document.querySelectorAll<HTMLElement>(selector);

    if (reduced) {
      // Immediately show for reduced motion
      elements.forEach(el => {
        el.style.opacity = "1";
        el.style.transform = "none";
      });
      return;
    }

    // Enhanced pop-out animation with spring physics
    animate(selector, {
      opacity: [0, 1],
      translateY: [40, 0],
      scale: [0.95, 1],
      duration: 900,
      ease: "out(3)",
      delay: stagger(120, { start: 100 }),
    });
  }, [selector, reduced]);
}

export function useScrollReveal(selector: string) {
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const elements = document.querySelectorAll<HTMLElement>(selector);
    if (!elements.length) return;

    // Set initial state
    elements.forEach(el => {
      if (!reduced) {
        el.style.opacity = "0";
        el.style.transform = "translateY(40px)";
      }
    });

    // CSS fallback: ensure content shows after 2 seconds even if IntersectionObserver fails
    const fallbackTimeout = setTimeout(() => {
      elements.forEach(el => {
        if (el.style.opacity === "0") {
          el.style.transition = "opacity 0.6s ease, transform 0.6s ease";
          el.style.opacity = "1";
          el.style.transform = "none";
        }
      });
    }, 2000);

    if (reduced) {
      // Immediately show for reduced motion
      elements.forEach(el => {
        el.style.opacity = "1";
        el.style.transform = "none";
      });
      return () => clearTimeout(fallbackTimeout);
    }

    // Use IntersectionObserver for reliable scroll detection
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const target = entry.target as HTMLElement;

            // Enhanced pop-out animation with spring effect
            animate(target, {
              opacity: [0, 1],
              translateY: [40, 0],
              scale: [0.92, 1],
              duration: 700,
              ease: "out(3)",
            });

            observer.unobserve(target);
          }
        });
      },
      {
        threshold: 0.1,
        rootMargin: "0px 0px -50px 0px",
      }
    );

    elements.forEach(el => observer.observe(el));

    return () => {
      clearTimeout(fallbackTimeout);
      observer.disconnect();
    };
  }, [selector, reduced]);
}

export function useChipDrift(selector: string) {
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const anim = animate(selector, {
      translateY: [0, -10, 0],
      rotate: [0, 2, 0, -2, 0],
      duration: 4000,
      ease: "inOutSine",
      loop: true,
      delay: stagger(300),
    });
    return () => {
      anim?.pause?.();
    };
  }, [selector, reduced]);
}

// New hook for section-specific pop-out effects
export function useSectionPop(selector: string) {
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const elements = document.querySelectorAll<HTMLElement>(selector);
    if (!elements.length) return;

    if (reduced) {
      elements.forEach(el => {
        el.style.opacity = "1";
        el.style.transform = "none";
      });
      return;
    }

    // Set initial state
    elements.forEach(el => {
      el.style.opacity = "0";
      el.style.transform = "scale(0.9) translateY(30px)";
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const target = entry.target as HTMLElement;

            // Dramatic pop-out with glow effect
            animate(target, {
              opacity: [0, 1],
              translateY: [30, 0],
              scale: [0.9, 1.02, 1],
              duration: 800,
              ease: "spring(1, 80, 12, 0)",
            });

            observer.unobserve(target);
          }
        });
      },
      {
        threshold: 0.15,
        rootMargin: "0px 0px -80px 0px",
      }
    );

    elements.forEach(el => observer.observe(el));

    return () => {
      observer.disconnect();
    };
  }, [selector, reduced]);
}

// Staggered list animation hook
export function useStaggeredReveal(containerSelector: string, itemSelector: string) {
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const containers = document.querySelectorAll<HTMLElement>(containerSelector);
    if (!containers.length) return;

    containers.forEach(container => {
      const items = container.querySelectorAll<HTMLElement>(itemSelector);

      if (reduced) {
        items.forEach(item => {
          item.style.opacity = "1";
          item.style.transform = "none";
        });
        return;
      }

      // Set initial state
      items.forEach(item => {
        item.style.opacity = "0";
        item.style.transform = "translateY(20px) scale(0.95)";
      });
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const container = entry.target as HTMLElement;
            const items = container.querySelectorAll<HTMLElement>(itemSelector);

            animate(items, {
              opacity: [0, 1],
              translateY: [20, 0],
              scale: [0.95, 1],
              duration: 600,
              ease: "outExpo",
              delay: stagger(80),
            });

            observer.unobserve(container);
          }
        });
      },
      {
        threshold: 0.1,
      }
    );

    containers.forEach(container => observer.observe(container));

    return () => {
      observer.disconnect();
    };
  }, [containerSelector, itemSelector, reduced]);
}

export function useReducedMotion() {
  return prefersReducedMotion();
}

