import Link from "next/link";
import Image from "next/image";
import { ButtonLink } from "@/components/ui";
import type { HeroProofPoint } from "@/lib/landing-content";
import { Container } from "./Container";
import {
  BackgroundPaths,
  HeroOrgCard,
  StadiumLightBeams,
} from "./LandingClientComponents";
import { ScrollIndicator } from "./ScrollIndicator";

interface HeroProps {
  proofPoints: ReadonlyArray<HeroProofPoint>;
}

export function Hero({ proofPoints }: HeroProps) {
  return (
    <section className="landing-hero-stage relative z-10 overflow-hidden pt-12 pb-20 sm:pt-16 sm:pb-28 lg:pt-20 lg:pb-32">
      <BackgroundPaths />
      <StadiumLightBeams />

      <Container size="xl" className="relative z-10">
        <div className="grid min-w-0 grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="w-full min-w-0 max-w-full text-center lg:text-left">
            <div className="hero-animate mb-4 flex justify-center lg:justify-start">
              <div className="inline-flex max-w-full items-center justify-center gap-2 rounded-full border border-landing-green/30 bg-landing-green/10 px-3 py-2 shadow-[0_0_40px_rgba(34,197,94,0.12)] sm:px-4">
                <span className="h-2 w-2 shrink-0 rounded-full bg-landing-green gold-shimmer" />
                <span className="min-w-0 text-balance text-center text-sm font-normal tracking-wide leading-snug text-landing-cream/80">
                  Build your network, wherever your community starts
                </span>
              </div>
            </div>

            <h1 className="hero-animate mb-3 flex justify-center lg:justify-start">
              <span className="sr-only">
                TeamNetwork: The platform that keeps your organization connected, past and present
              </span>
              <Image
                src="/TeamNetwork.png"
                alt=""
                width={541}
                height={303}
                className="h-auto w-[min(100%,260px)] drop-shadow-[0_0_40px_rgba(34,197,94,0.15)] sm:w-[320px] lg:w-[340px]"
                aria-hidden="true"
                priority
              />
            </h1>

            <p className="hero-animate mx-auto mb-3 max-w-[12ch] text-balance text-center text-2xl font-semibold tracking-tight text-landing-cream sm:max-w-none sm:text-3xl lg:mx-0 lg:text-left lg:text-[2.75rem] lg:leading-[1.05]">
              Build your network.<br className="hidden sm:block" /> Keep it connected.
            </p>

            <p className="hero-animate mx-auto mb-8 max-w-[32ch] text-base leading-relaxed text-landing-cream/75 sm:max-w-xl sm:text-lg lg:mx-0 lg:mb-6 lg:text-xl">
              Bring together current members, alumni, supporters, and families in one place. Built for{" "}
              <span className="font-medium text-landing-cream">clubs</span>,{" "}
              <span className="font-medium text-landing-cream">organizations</span>,{" "}
              <span className="font-medium text-landing-cream">sports teams</span>, and communities of all kinds.
            </p>

            <div className="hero-animate mx-0 flex w-full max-w-full flex-col items-stretch gap-4 sm:mx-auto sm:flex-row sm:justify-center lg:mx-0 lg:justify-start">
              <ButtonLink
                href="/contact"
                variant="landingPrimary"
                size="xl"
                className="cta-glow w-full sm:w-auto"
              >
                Request Pricing
              </ButtonLink>
              <ButtonLink
                href="/auth/login?redirect=/app/join"
                variant="landingSecondary"
                size="xl"
                className="w-full sm:w-auto"
              >
                Join an Organization
              </ButtonLink>
            </div>

            <div className="hero-animate mt-4">
              <Link
                href="/auth/login"
                className="text-sm text-landing-cream/50 transition-colors hover:text-landing-cream/70"
              >
                Already a member? <span className="underline underline-offset-2">Sign in</span>
              </Link>
            </div>

            <div className="hero-animate mx-auto mt-8 grid max-w-md grid-cols-1 gap-3 sm:max-w-2xl sm:grid-cols-3 lg:mx-0">
              {proofPoints.map((point) => (
                <div
                  key={point.value}
                  className="landing-proof-tile relative overflow-hidden rounded-xl border border-landing-cream/10 bg-landing-cream/[0.04] px-5 py-4 text-left before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-landing-green/60"
                >
                  <p className="font-display text-2xl font-bold leading-none text-landing-cream">
                    {point.value}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-landing-cream/60">{point.label}</p>
                </div>
              ))}
            </div>
          </div>

          <HeroOrgCard />
        </div>
      </Container>

      <ScrollIndicator />
    </section>
  );
}
