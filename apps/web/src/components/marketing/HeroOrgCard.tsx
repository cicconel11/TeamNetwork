import Image from "next/image";

/**
 * Hero product preview — the real TeamNetwork dashboard framed as a floating app
 * window, with a smaller live snippet layered in front for depth (air.inc-style).
 * On lg the window is oversized and bleeds off the right edge; the hero section
 * clips it (overflow-hidden). On mobile it is contained full-width.
 */
export function HeroOrgCard() {
  return (
    <div className="hero-animate relative w-full">
      {/* Soft ambient glow behind the window */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-10 -z-10 bg-[radial-gradient(60%_60%_at_60%_35%,rgba(34,197,94,0.14),transparent_70%)]"
      />

      {/* Primary app window — bleeds off the right edge on large screens */}
      <div className="app-window mx-auto w-full max-w-xl lg:mx-0 lg:mt-2 lg:w-[132%] lg:max-w-none">
        <div className="app-window-bar">
          <span className="app-window-dot" />
          <span className="app-window-dot" />
          <span className="app-window-dot" />
          <span className="ml-2 truncate rounded-md bg-white/[0.04] px-3 py-1 text-xs text-landing-cream/40">
            app.myteamnetwork.com
          </span>
        </div>

        <Image
          src="/app-screenshot.png"
          alt="The TeamNetwork dashboard — member feed, organization overview, and upcoming events."
          width={1319}
          height={816}
          sizes="(min-width: 1024px) 60vw, 100vw"
          className="block h-auto w-full"
          priority
        />
      </div>

      {/* Secondary snippet layered in front — reintroduces the brand green */}
      <div className="hero-float-chip absolute -bottom-5 left-2 hidden w-[260px] rounded-2xl p-4 sm:left-4 sm:block lg:-bottom-6 lg:-left-6">
        <div className="flex items-center gap-3">
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-landing-green/15 text-sm font-semibold text-landing-green">
            MC
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#13151a] bg-landing-green" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-landing-cream">Maya Chen joined</p>
            <p className="truncate text-xs text-landing-cream/50">Alumni · Class of 2018</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3 text-xs text-landing-cream/55">
          <svg className="h-3.5 w-3.5 text-landing-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          <span>AI matched a mentor · 96%</span>
        </div>
      </div>
    </div>
  );
}
