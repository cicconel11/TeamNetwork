import Link from "next/link";
import Image from "next/image";
import { Container } from "@/components/marketing/Container";

/**
 * Shared marketing footer — 3-column brand / product / legal / contact layout.
 * Used by the landing page and every marketing sub-page (via MarketingShell) so
 * the chrome stays identical across the public site.
 */
export function LandingFooter() {
  return (
    <>
      <div className="h-px bg-gradient-to-r from-transparent via-landing-cream/10 to-transparent" />

      <footer className="relative z-10 py-16 bg-landing-navy">
        <Container size="xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8">
            <div>
              <div className="flex items-center gap-2.5 mb-3">
                <Image
                  src="/TeamNetwork.png"
                  alt="TeamNetwork"
                  width={541}
                  height={303}
                  sizes="32px"
                  className="h-8 w-auto object-contain"
                />
              </div>
              <p className="text-sm text-landing-cream/55 leading-relaxed">
                The platform that keeps your organization connected, past and present.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-landing-cream/30 font-medium mb-3">
                  Product
                </p>
                <nav className="flex flex-col gap-2 text-sm">
                  <Link href="/#features" className="text-landing-cream/65 hover:text-landing-cream transition-colors">
                    Features
                  </Link>
                  <Link href="/#pricing" className="text-landing-cream/65 hover:text-landing-cream transition-colors">
                    Pricing
                  </Link>
                  <Link href="/demos" className="text-landing-cream/65 hover:text-landing-cream transition-colors">
                    Demos
                  </Link>
                  <Link href="/contact" className="text-landing-cream/65 hover:text-landing-cream transition-colors">
                    Contact sales
                  </Link>
                </nav>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-landing-cream/30 font-medium mb-3">
                  Legal
                </p>
                <nav className="flex flex-col gap-2 text-sm">
                  <Link href="/terms" className="text-landing-cream/65 hover:text-landing-cream transition-colors">
                    Terms
                  </Link>
                  <Link href="/privacy" className="text-landing-cream/65 hover:text-landing-cream transition-colors">
                    Privacy
                  </Link>
                  <Link href="/support" className="text-landing-cream/65 hover:text-landing-cream transition-colors">
                    Support
                  </Link>
                </nav>
              </div>
            </div>

            <div className="md:text-right">
              <p className="text-xs uppercase tracking-[0.15em] text-landing-cream/30 font-medium mb-3">
                Contact
              </p>
              <a
                href="mailto:mleonard@myteamnetwork.com"
                className="text-sm text-landing-cream/65 hover:text-landing-cream transition-colors"
              >
                mleonard@myteamnetwork.com
              </a>
              <p className="mt-6 text-sm text-landing-cream/45 italic">
                Built for teams that go the distance.
              </p>
            </div>
          </div>

          <div className="mt-10 pt-6 text-center">
            <div className="h-px bg-gradient-to-r from-transparent via-landing-cream/10 to-transparent mb-6" />
            <p className="text-sm text-landing-cream/45">
              &copy; {new Date().getFullYear()} TeamNetwork
            </p>
          </div>
        </Container>
      </footer>
    </>
  );
}
