import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Contact Sales — TeamNetwork",
  description: "Get in touch to learn more about TeamNetwork for your enterprise.",
};

export default function ContactPage() {
  return (
    <div className="landing-page min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="pricing-card rounded-2xl p-10">
          <div className="w-12 h-12 rounded-xl bg-amber-500/15 flex items-center justify-center mx-auto mb-6">
            <svg
              className="w-6 h-6 text-amber-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
              />
            </svg>
          </div>

          <h1 className="font-display text-3xl font-bold text-landing-cream mb-3">
            Contact Sales
          </h1>
          <p className="text-landing-cream/60 mb-8 text-sm leading-relaxed">
            Interested in TeamNetwork Enterprise for your organization? Drop us a
            line and we&apos;ll get back to you within one business day.
          </p>

          <a
            href="mailto:sales@myteamnetwork.com?subject=Enterprise%20Inquiry"
            className="inline-block w-full bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300 font-semibold py-3 px-8 rounded-xl transition-all text-sm mb-4"
          >
            Email Sales &rarr;
          </a>

          <Link
            href="/#pricing"
            className="block text-landing-cream/40 hover:text-landing-cream/70 transition-colors text-sm"
          >
            &larr; Back to pricing
          </Link>
        </div>
      </div>
    </div>
  );
}
