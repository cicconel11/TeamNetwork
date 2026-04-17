"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ButtonLink } from "@/components/ui";

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "/demos", label: "Demos" },
  { href: "#faq", label: "FAQ" },
  { href: "/blog", label: "Blog" },
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
  const drawerRef = useRef<HTMLDivElement>(null);
  const activeSection = useActiveSection();

  const close = useCallback(() => setOpen(false), []);

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
    <>
    <header className="relative z-20 sticky top-0 bg-landing-navy/95 backdrop-blur-md border-b border-landing-cream/10">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 sm:px-6 py-3 sm:py-4">
        <Link href="#top" className="group flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5">
          <Image
            src="/TeamNetwor.png"
            alt=""
            width={541}
            height={303}
            sizes="28px"
            className="h-8 w-auto shrink-0 object-contain sm:h-7"
            aria-hidden="true"
          />
          {/* Wordmark hidden on very narrow screens — avoids "TeamNe…" truncation; logo is enough */}
          <span className="font-display hidden text-base font-bold tracking-tight text-landing-cream sm:inline sm:text-xl">
            <span className="text-landing-green">Team</span>
            <span className="text-landing-cream">Network</span>
          </span>
          <span className="sr-only">TeamNetwork</span>
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

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          <ButtonLink
            href="/auth/login"
            variant="custom"
            size="sm"
            className="hidden whitespace-nowrap px-2 py-2 text-sm text-landing-cream/80 hover:bg-landing-cream/10 hover:text-landing-cream sm:inline-flex sm:px-4 sm:py-2.5"
          >
            Sign In
          </ButtonLink>
          <ButtonLink
            href="/auth/signup"
            variant="custom"
            className="whitespace-nowrap bg-landing-green-dark px-2.5 py-2 text-sm font-semibold text-white hover:bg-[#15803d] sm:px-5 sm:text-base"
          >
            Get Started
          </ButtonLink>

          {/* Hamburger button — mobile only */}
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            className="md:hidden -mr-1 inline-flex min-h-[40px] min-w-[40px] shrink-0 items-center justify-center rounded-lg p-2 text-landing-cream/70 transition-colors hover:bg-landing-cream/10 hover:text-landing-cream"
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
    </header>

    {/* Mobile drawer overlay — rendered outside <header> so `fixed` resolves against the
        viewport. The header uses `backdrop-filter`, which creates a containing block for
        fixed descendants and would otherwise clip the drawer to the header's height. */}
    {open && (
      <div className="fixed inset-0 z-50 bg-black/60 md:hidden">
        <div
          ref={drawerRef}
          className="absolute right-0 top-0 h-full w-72 max-w-[80vw] bg-landing-navy border-l border-landing-cream/10 shadow-2xl animate-slide-in-right flex flex-col"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-landing-cream/10">
            <Link
              href="#top"
              onClick={close}
              className="flex items-center gap-2"
              aria-label="TeamNetwork home"
            >
              <Image
                src="/TeamNetwor.png"
                alt=""
                width={541}
                height={303}
                sizes="28px"
                className="h-7 w-auto object-contain"
                aria-hidden="true"
              />
              <span className="font-display text-base font-bold tracking-tight">
                <span className="text-landing-green">Team</span>
                <span className="text-landing-cream">Network</span>
              </span>
            </Link>
            <button
              type="button"
              onClick={close}
              aria-label="Close menu"
              className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-landing-cream/70 hover:bg-landing-cream/10 hover:text-landing-cream"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <nav className="flex flex-col p-6 gap-1 overflow-y-auto">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={close}
                className="px-4 py-3 rounded-lg text-landing-cream/70 hover:text-landing-cream hover:bg-landing-cream/5 transition-colors text-base font-medium"
              >
                {link.label}
              </Link>
            ))}

            <div className="border-t border-landing-cream/10 mt-4 pt-4 flex flex-col gap-2">
              <ButtonLink
                href="/auth/login"
                variant="custom"
                className="w-full border border-landing-cream/20 bg-landing-cream/5 text-landing-cream text-center hover:bg-landing-cream/10"
              >
                Sign In
              </ButtonLink>
              <ButtonLink
                href="/auth/signup"
                variant="custom"
                className="w-full bg-landing-green-dark hover:bg-[#15803d] text-white font-semibold text-center"
              >
                Get Started
              </ButtonLink>
            </div>
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
    </>
  );
}
