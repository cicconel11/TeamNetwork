"use client";

import { useEffect, useRef, useState } from "react";
import { loadAnime } from "./anime-loader";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useAnimationScope() {
  const scopeRef = useRef<{ revert: () => void } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let isMounted = true;

    loadAnime().then((anime) => {
      if (!isMounted || !containerRef.current) return;
      const scope = anime.createScope({ root: containerRef.current });
      scopeRef.current = scope;
    });

    return () => {
      isMounted = false;
      scopeRef.current?.revert();
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
    loadAnime().then((anime) => {
      anime.animate(selector, {
        opacity: [0, 1],
        translateY: [40, 0],
        scale: [0.95, 1],
        duration: 900,
        ease: "out(3)",
        delay: anime.stagger(120, { start: 100 }),
      });
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
            loadAnime().then((anime) => {
              anime.animate(target, {
                opacity: [0, 1],
                translateY: [40, 0],
                scale: [0.92, 1],
                duration: 700,
                ease: "out(3)",
              });
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
    let anim: { pause?: () => void } | null = null;

    loadAnime().then((anime) => {
      anim = anime.animate(selector, {
        translateY: [0, -10, 0],
        rotate: [0, 2, 0, -2, 0],
        duration: 4000,
        ease: "inOutSine",
        loop: true,
        delay: anime.stagger(300),
      });
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
            loadAnime().then((anime) => {
              anime.animate(target, {
                opacity: [0, 1],
                translateY: [30, 0],
                scale: [0.9, 1.02, 1],
                duration: 800,
                ease: "spring(1, 80, 12, 0)",
              });
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

            loadAnime().then((anime) => {
              anime.animate(items, {
                opacity: [0, 1],
                translateY: [20, 0],
                scale: [0.95, 1],
                duration: 600,
                ease: "outExpo",
                delay: anime.stagger(80),
              });
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

// Stadium light sweep animation
export function useStadiumLights(beamSelector: string) {
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const beams = document.querySelectorAll<HTMLElement>(beamSelector);
    if (!beams.length) return;

    if (reduced) {
      beams.forEach((beam) => {
        beam.style.opacity = "0.15";
        beam.style.transform = "rotate(5deg) translateY(0)";
      });
      return;
    }

    loadAnime().then((anime) => {
      anime.animate(beamSelector, {
        opacity: [0, 0.25, 0.15],
        rotate: [-25, 8],
        translateY: ["-30%", "0%"],
        duration: 1800,
        ease: "out(3)",
        delay: anime.stagger(200, { start: 200 }),
      });
    });
  }, [beamSelector, reduced]);
}

// Counting number animation for scoreboard
export function useCountUp(
  elementRef: React.RefObject<HTMLElement | null>,
  finalValue: number,
  options?: { duration?: number; prefix?: string; suffix?: string }
) {
  const reduced = prefersReducedMotion();
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!elementRef.current || hasAnimated.current) return;

    const { duration = 2000, prefix = "", suffix = "" } = options || {};

    if (reduced) {
      elementRef.current.textContent = `${prefix}${finalValue.toLocaleString()}${suffix}`;
      return;
    }

    // Custom easing function (ease out expo)
    const easeOutExpo = (t: number): number => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

    const animateValue = (start: number, end: number, dur: number, onUpdate: (val: number) => void) => {
      const startTime = performance.now();
      function step(currentTime: number) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / dur, 1);
        const easedProgress = easeOutExpo(progress);
        const currentValue = Math.round(start + (end - start) * easedProgress);
        onUpdate(currentValue);
        if (progress < 1) {
          requestAnimationFrame(step);
        }
      }
      requestAnimationFrame(step);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && elementRef.current && !hasAnimated.current) {
            hasAnimated.current = true;

            animateValue(0, finalValue, duration, (val) => {
              if (elementRef.current) {
                elementRef.current.textContent = `${prefix}${val.toLocaleString()}${suffix}`;
              }
            });

            observer.disconnect();
          }
        });
      },
      { threshold: 0.3 }
    );

    observer.observe(elementRef.current);

    return () => observer.disconnect();
  }, [elementRef, finalValue, options, reduced]);
}

// Banner drop animation with swing physics
export function useBannerDrop(selector: string) {
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const banners = document.querySelectorAll<HTMLElement>(selector);
    if (!banners.length) return;

    if (reduced) {
      banners.forEach((banner) => {
        banner.style.opacity = "1";
        banner.style.transform = "none";
      });
      return;
    }

    // Set initial state
    banners.forEach((banner) => {
      banner.style.opacity = "0";
      banner.style.transform = "translateY(-100%) rotate(-2deg)";
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const container = entry.target as HTMLElement;
            const items = container.querySelectorAll<HTMLElement>(selector);

            loadAnime().then((anime) => {
              anime.animate(items, {
                opacity: [0, 1],
                translateY: ["-100%", "5px", "-2px", "0"],
                rotate: ["-2deg", "1deg", "-0.5deg", "0"],
                duration: 800,
                ease: "spring(1, 80, 12, 0)",
                delay: anime.stagger(100),
              });
            });

            observer.unobserve(container);
          }
        });
      },
      { threshold: 0.1 }
    );

    // Observe the parent container
    const parent = banners[0]?.parentElement;
    if (parent) {
      observer.observe(parent);
    }

    return () => observer.disconnect();
  }, [selector, reduced]);
}

// Confetti burst trigger
export function useConfettiBurst(containerRef: React.RefObject<HTMLElement | null>) {
  const [shouldBurst, setShouldBurst] = useState(false);
  const hasTriggered = useRef(false);

  useEffect(() => {
    if (!containerRef.current || hasTriggered.current) return;

    const reduced = prefersReducedMotion();
    if (reduced) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !hasTriggered.current) {
            hasTriggered.current = true;
            setShouldBurst(true);
            observer.disconnect();
          }
        });
      },
      { threshold: 0.5 }
    );

    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, [containerRef]);

  return shouldBurst;
}

// Trophy bounce animation
export function useTrophyBounce(selector: string) {
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const elements = document.querySelectorAll<HTMLElement>(selector);
    if (!elements.length) return;

    if (reduced) {
      elements.forEach((el) => {
        el.style.opacity = "1";
        el.style.transform = "scale(1)";
      });
      return;
    }

    // Set initial state
    elements.forEach((el) => {
      el.style.opacity = "0";
      el.style.transform = "scale(0) rotate(-10deg)";
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const target = entry.target as HTMLElement;

            loadAnime().then((anime) => {
              anime.animate(target, {
                opacity: [0, 1],
                scale: [0, 1.2, 0.9, 1],
                rotate: ["-10deg", "5deg", "-2deg", "0"],
                duration: 800,
                ease: "spring(1, 80, 12, 0)",
              });
            });

            observer.unobserve(target);
          }
        });
      },
      { threshold: 0.3 }
    );

    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [selector, reduced]);
}

