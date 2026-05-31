import type { Metadata } from "next";
import Link from "next/link";
import "../landing-styles.css";

export const metadata: Metadata = {
  title: "Support — TeamNetwork",
  description: "Get help with TeamNetwork. Contact our support team for assistance.",
};

const SUPPORT_EMAIL = "mleonard@myteamnetwork.com";

export default function SupportPage() {
  return (
    <div className="landing-page min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="pricing-card rounded-2xl p-10">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/15 flex items-center justify-center mx-auto mb-6">
            <svg
              className="w-6 h-6 text-emerald-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"
              />
            </svg>
          </div>

          <h1 className="font-display text-3xl font-bold text-landing-cream mb-3">
            Support
          </h1>
          <p className="text-landing-cream/60 mb-8 text-sm leading-relaxed">
            Need help with TeamNetwork? Email our support team and we&apos;ll get
            back to you within one business day.
          </p>

          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=TeamNetwork%20Support%20Request`}
            className="inline-block w-full bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 font-semibold py-3 px-8 rounded-xl transition-all text-sm mb-2"
          >
            Email Support &rarr;
          </a>
          <p className="text-landing-cream/40 text-xs mb-6">{SUPPORT_EMAIL}</p>

          <Link
            href="/"
            className="block text-landing-cream/40 hover:text-landing-cream/70 transition-colors text-sm"
          >
            &larr; Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
