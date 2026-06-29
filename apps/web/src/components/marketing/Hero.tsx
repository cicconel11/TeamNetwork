import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { Container } from "./Container";
import { HeroOrgCard } from "./LandingClientComponents";

export function Hero() {
  return (
    <section className="landing-hero-stage relative z-10 overflow-hidden pt-16 pb-24 sm:pt-20 sm:pb-32 lg:pt-20 lg:pb-40">
      <Container size="xl" className="relative z-10">
        <div className="grid min-w-0 grid-cols-1 items-start gap-14 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
          <div className="w-full min-w-0 max-w-full text-center lg:text-left">
            <div className="hero-animate mb-7 flex justify-center lg:justify-start">
              <span className="eyebrow-label">Built for clubs, teams &amp; communities</span>
            </div>

            <h1 className="hero-animate display-hero mb-7 text-balance text-landing-cream">
              <span className="sr-only">
                TeamNetwork — build your network and keep it connected, past and present.
              </span>
              <span aria-hidden="true">
                Build your network.
                <br />
                Keep it <span className="accent-italic">connected.</span>
              </span>
            </h1>

            <p className="hero-animate mx-auto mb-10 max-w-[34ch] text-lg leading-relaxed text-landing-cream/65 sm:max-w-xl sm:text-xl lg:mx-0">
              One home for current members, alumni, supporters, and families — directories, events,
              records, and funding, kept in sync as your community grows.
            </p>

            <div className="hero-animate mx-0 flex w-full max-w-full flex-col items-stretch gap-4 sm:mx-auto sm:max-w-md sm:flex-row sm:justify-center lg:mx-0 lg:max-w-none lg:justify-start">
              <ButtonLink
                href="/contact"
                variant="landingPrimary"
                size="xl"
                className="w-full sm:w-auto"
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

            <div className="hero-animate mt-5">
              <Link
                href="/auth/login"
                className="text-sm text-landing-cream/45 transition-colors hover:text-landing-cream/70"
              >
                Already a member? <span className="underline underline-offset-4">Sign in</span>
              </Link>
            </div>
          </div>

          <HeroOrgCard />
        </div>
      </Container>
    </section>
  );
}
