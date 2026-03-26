"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ButtonLink } from "@/components/ui";

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "/demos", label: "Demos" },
  { href: "#faq", label: "FAQ" },
  { href: "/terms", label: "Terms" },
] as const;

function useActiveSection(): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const sectionIds = NAV_LINKS
      .filter((link) => link.href.startsWith("#"))
      .map((link) => link.href.slice(1));

    const sections = sectionIds
      .map((id) => document.getElementById(id))
      .filter(Boolean) as HTMLElement[];

    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length > 0) {
          setActive(`#${visible[0].target.id}`);
        }
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: 0 }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  return active;
}

export function LandingHeader() {
  const [open, setOpen] = useState(false);
  const [overlayTopPx, setOverlayTopPx] = useState(64);
  const headerRef = useRef<HTMLElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const activeSection = useActiveSection();

  const close = useCallback(() => setOpen(false), []);

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;

    function measure() {
      const h = headerRef.current;
      if (!h) return;
      setOverlayTopPx(h.getBoundingClientRect().height);
    }

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, close]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;

    function handleClick(e: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        close();
      }
    }

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, close]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header
      ref={headerRef}
      className="relative z-20 sticky top-0 border-b border-landing-cream/10 bg-landing-navy/95 pt-[env(safe-area-inset-top,0px)] backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 sm:px-6 py-3 sm:py-4">
        <Link href="#top" className="group flex min-w-0 max-w-[min(100%,14rem)] items-center gap-2 sm:gap-2.5 sm:max-w-none">
          <Image
            src="/TeamNetwor.png"
            alt=""
            width={541}
            height={303}
            sizes="28px"
            className="h-7 w-auto shrink-0 object-contain"
            aria-hidden="true"
          />
          <span className="font-display truncate text-base font-bold tracking-tight text-landing-cream sm:text-xl">
            <span className="text-landing-green">Team</span>
            <span className="text-landing-cream">Network</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-8 text-sm">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`transition-colors ${
                activeSection === link.href
                  ? "nav-link-active"
                  : "text-landing-cream/70 hover:text-landing-cream"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Auth + menu: below md, only menu — CTAs live in drawer so narrow phones match dev */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2 md:gap-3">
          <div className="hidden items-center gap-2 md:flex md:gap-3">
            <ButtonLink
              href="/auth/login"
              variant="custom"
              size="sm"
              className="text-landing-cream/80 hover:bg-landing-cream/10 hover:text-landing-cream sm:px-4 sm:py-2.5"
            >
              Sign In
            </ButtonLink>
            <ButtonLink
              href="/auth/signup"
              variant="custom"
              className="bg-landing-green-dark px-3 font-semibold text-white hover:bg-[#15803d] sm:px-5"
            >
              Get Started
            </ButtonLink>
          </div>

          {/* Hamburger — mobile / tablet below md */}
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 text-landing-cream/70 transition-colors hover:bg-landing-cream/10 hover:text-landing-cream md:hidden"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              {open ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile drawer overlay */}
      {open && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 bg-black/60 md:hidden"
          style={{ top: overlayTopPx }}
        >
          <div
            ref={drawerRef}
            className="animate-slide-in-right absolute right-0 top-0 h-full w-72 max-w-[85vw] border-l border-landing-cream/10 bg-landing-navy shadow-2xl"
          >
            <nav className="flex flex-col gap-1 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-6">
              <div className="flex flex-col gap-2 border-b border-landing-cream/10 pb-4">
                <ButtonLink
                  href="/auth/login"
                  variant="custom"
                  onClick={close}
                  className="min-h-[44px] w-full justify-center text-center text-landing-cream/90 hover:bg-landing-cream/10"
                >
                  Sign In
                </ButtonLink>
                <ButtonLink
                  href="/auth/signup"
                  variant="custom"
                  onClick={close}
                  className="min-h-[44px] w-full justify-center bg-landing-green-dark text-center font-semibold text-white hover:bg-[#15803d]"
                >
                  Get Started
                </ButtonLink>
              </div>
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={close}
                  className="min-h-[44px] rounded-lg px-4 py-3 text-base font-medium text-landing-cream/70 transition-colors hover:bg-landing-cream/5 hover:text-landing-cream"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Slide-in animation */}
          <style jsx>{`
            @keyframes slideInRight {
              from {
                transform: translateX(100%);
              }
              to {
                transform: translateX(0);
              }
            }
            .animate-slide-in-right {
              animation: slideInRight 0.25s cubic-bezier(0.4, 0, 0.2, 1) forwards;
            }
          `}</style>
        </div>
      )}
    </header>
  );
}
