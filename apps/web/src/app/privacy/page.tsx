import { Container } from "@/components/marketing/Container";
import { Section, SectionEyebrow } from "@/components/marketing/Section";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import "../landing-styles.css";

// Static content — ISR revalidates every hour
export const revalidate = 3600;

type PrivacySection = {
  id: string;
  number: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
};

const privacySections: PrivacySection[] = [
  {
    id: "introduction",
    number: "1",
    title: "Introduction",
    paragraphs: [
      "TeamNetwork (\"the Service\"), operated by MAC Connect LLC, is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our Service.",
      "By using TeamNetwork, you consent to the data practices described in this policy. If you do not agree with this policy, please do not use the Service.",
    ],
  },
  {
    id: "information-collected",
    number: "2",
    title: "Information We Collect",
    paragraphs: [
      "We collect information you provide directly to us, as well as information collected automatically when you use the Service.",
    ],
    bullets: [
      "Account Information: Name, email address, and password when you create an account.",
      "Profile Information: Organization details, role, and other profile data you choose to provide.",
      "Content: Information you submit through the Service, including events, announcements, forms, and other organizational data.",
      "Payment Information: When you make purchases or contributions, payment details are processed securely by our payment processor (Stripe). We do not store full credit card numbers.",
      "Usage Data (opt-in): With explicit consent, we collect minimal, privacy-first usage events (e.g., route views, navigation clicks, and feature interactions) without identities or content.",
      "Ops/Security Telemetry: Limited error and reliability signals (e.g., API error codes, HTTP status, retryable flags) to keep the Service secure and stable. No content or user identifiers are included.",
      "Device Information: Browser type and device class (mobile/tablet/desktop).",
    ],
  },
  {
    id: "how-we-use",
    number: "3",
    title: "How We Use Your Information",
    paragraphs: [
      "We use the information we collect to:",
    ],
    bullets: [
      "Provide, maintain, and improve the Service.",
      "Process transactions and send related information.",
      "Send administrative messages, updates, and security alerts.",
      "Respond to your comments, questions, and support requests.",
      "Monitor and analyze trends, usage, and activities.",
      "Detect, investigate, and prevent fraudulent transactions and other illegal activities.",
      "Personalize and improve your experience.",
      "Comply with legal obligations.",
    ],
  },
  {
    id: "information-sharing",
    number: "4",
    title: "Information Sharing and Disclosure",
    paragraphs: [
      "We do not sell your personal information. We may share your information in the following circumstances:",
    ],
    bullets: [
      "With Your Organization: Information you provide may be visible to other members of your organization based on your role and permissions.",
      "Service Providers: We share information with third-party vendors who perform services on our behalf, such as payment processing (Stripe), hosting, and analytics.",
      "Legal Requirements: We may disclose information if required by law, regulation, legal process, or governmental request.",
      "Business Transfers: In connection with a merger, acquisition, or sale of assets, your information may be transferred as part of that transaction.",
      "With Your Consent: We may share information with your explicit consent.",
    ],
  },
  {
    id: "third-party-services",
    number: "5",
    title: "Third-Party Services",
    paragraphs: [
      "The Service integrates with third-party services to provide functionality:",
    ],
    bullets: [
      "Supabase: Database and authentication services.",
      "Stripe: Payment processing for subscriptions and contributions.",
      "Google Calendar: Optional calendar synchronization (requires your explicit authorization).",
      "Cloudflare Turnstile: Bot protection and security verification.",
      "These services have their own privacy policies, and we encourage you to review them.",
    ],
  },
  {
    id: "data-security",
    number: "6",
    title: "Data Security",
    paragraphs: [
      "We implement appropriate technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction.",
    ],
    bullets: [
      "Data is encrypted in transit using TLS/SSL.",
      "Access to personal data is restricted to authorized personnel only.",
      "We use Row Level Security (RLS) policies to ensure users can only access data they are authorized to view.",
      "Regular security assessments and updates are performed.",
      "However, no method of transmission over the Internet or electronic storage is 100% secure. We cannot guarantee absolute security.",
    ],
  },
  {
    id: "data-retention",
    number: "7",
    title: "Data Retention",
    paragraphs: [
      "We retain your personal information for as long as your account is active or as needed to provide you services. We may also retain and use your information to comply with legal obligations, resolve disputes, and enforce our agreements.",
      "When you delete your account, we will delete or anonymize your personal information within a reasonable timeframe, except where we are required to retain it by law.",
    ],
  },
  {
    id: "your-rights",
    number: "8",
    title: "Your Rights and Choices",
    paragraphs: [
      "Depending on your location, you may have certain rights regarding your personal information:",
    ],
    bullets: [
      "Access: Request access to the personal information we hold about you.",
      "Correction: Request correction of inaccurate or incomplete information.",
      "Deletion: Request deletion of your personal information, subject to certain exceptions.",
      "Data Portability: Request a copy of your data in a portable format.",
      "Opt-Out: Unsubscribe from marketing communications at any time.",
      "To exercise these rights, please contact us at mleonard@myteamnetwork.com.",
    ],
  },
  {
    id: "cookies",
    number: "9",
    title: "Cookies and Tracking",
    paragraphs: [
      "We use cookies and similar technologies to:",
    ],
    bullets: [
      "Maintain your session and authentication state.",
      "Remember your preferences and settings.",
      "Support opt-in usage analytics (only after you explicitly consent).",
      "You can control cookies through your browser settings. Disabling cookies may affect the functionality of the Service.",
    ],
  },
  {
    id: "usage-analytics",
    number: "10",
    title: "Usage Analytics and Personalization",
    paragraphs: [
      "With your explicit opt-in consent, we collect minimal, privacy-first usage analytics. Behavioral analytics are disabled by default until you accept the in-app consent prompt for a specific organization.",
      "Consent is stored per organization and may be withdrawn at any time by contacting support.",
    ],
    bullets: [
      "What we track (opt-in only): Page/route views, navigation and CTA clicks, feature-level events (e.g., directory view, event open, RSVP update), device class, app version, and a daily-rotating session ID.",
      "What we never track: Names, emails, phone numbers, message bodies, form answers, filenames, raw URLs, search terms, precise timestamps in analytics payloads, or any content you submit.",
      "No user IDs in analytics: Consent is stored using your account ID, but analytics event payloads never include user identifiers.",
      "Ops telemetry (always-on): Error and security events are logged without consent to keep the Service safe. These are minimal and never include content or identities.",
      "Data lifecycle: Behavioral analytics are automatically deleted after 90 days. Ops telemetry is deleted after 30 days.",
      "Account deletion removes all analytics data immediately.",
    ],
  },
  {
    id: "children",
    number: "11",
    title: "Children's Privacy",
    paragraphs: [
      "The Service is not intended for children under 13 years of age. We do not knowingly collect personal information from children under 13. Users who disclose they are under 13 during signup are blocked at our age gate before any personal information is collected or any account is created.",
      "If we learn that we have collected personal information from a child under 13, we will take steps to delete that information promptly. If you believe we have collected information from a child under 13, please contact us at mleonard@myteamnetwork.com.",
    ],
  },
  {
    id: "international",
    number: "12",
    title: "International Data Transfers",
    paragraphs: [
      "Your information may be transferred to and processed in countries other than your country of residence. These countries may have data protection laws that are different from the laws of your country.",
      "By using the Service, you consent to the transfer of your information to the United States and other countries where we operate.",
    ],
  },
  {
    id: "changes",
    number: "13",
    title: "Changes to This Policy",
    paragraphs: [
      "We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the \"Last Updated\" date.",
      "Your continued use of the Service after any changes indicates your acceptance of the updated Privacy Policy.",
    ],
  },
  {
    id: "contact",
    number: "14",
    title: "Contact Us",
    paragraphs: [
      "If you have any questions about this Privacy Policy or our data practices, please contact us:",
      "Email: mleonard@myteamnetwork.com",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <MarketingShell>
      <Section padY="lg">
        <Container size="xl">
          {/* Hero */}
          <div className="mb-16 max-w-3xl">
            <SectionEyebrow>Legal</SectionEyebrow>
            <h1 className="scroll-reveal display-section text-landing-cream">Privacy Policy</h1>
            <p className="scroll-reveal mt-5 text-base text-landing-cream/45">
              Last updated: February 10, 2026
            </p>
          </div>

          <div className="grid gap-12 lg:grid-cols-[260px_1fr]">
            {/* TOC Sidebar */}
            <nav className="hidden lg:block">
              <div className="sticky top-28">
                <p className="eyebrow-label mb-5">Contents</p>
                <ul className="space-y-1">
                  {privacySections.map((s) => (
                    <li key={s.id}>
                      <a
                        href={`#${s.id}`}
                        className="block border-l border-white/10 py-2 pl-4 text-sm text-landing-cream/50 transition-colors hover:border-landing-green hover:text-landing-cream"
                      >
                        <span className="mr-2 text-landing-cream/30">{s.number}.</span>
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </nav>

            {/* Content — de-boxed, hairline-divided */}
            <div className="border-t border-white/10">
              {privacySections.map((section) => (
                <section
                  key={section.id}
                  id={section.id}
                  className="scroll-mt-28 border-b border-white/10 py-10"
                >
                  <div className="flex items-baseline gap-5">
                    <span className="w-10 flex-shrink-0 font-display text-3xl font-bold leading-none text-landing-green/70">
                      {section.number}
                    </span>
                    <div className="min-w-0 flex-1 space-y-4">
                      <h2 className="font-display text-xl font-semibold text-landing-cream">
                        {section.title}
                      </h2>
                      {section.paragraphs.map((paragraph, index) => (
                        <p key={index} className="leading-relaxed text-landing-cream/60">
                          {paragraph}
                        </p>
                      ))}
                      {section.bullets && (
                        <ul className="space-y-2 text-landing-cream/60">
                          {section.bullets.map((bullet, index) => (
                            <li key={index} className="flex items-start gap-3">
                              <span className="mt-1.5 text-landing-green">•</span>
                              <span className="leading-relaxed">{bullet}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </section>
              ))}

              {/* Back to top */}
              <div className="pt-8">
                <a
                  href="#top"
                  className="group inline-flex items-center gap-2 text-sm text-landing-cream/45 transition-colors hover:text-landing-cream"
                >
                  <svg
                    className="h-4 w-4 transition-transform group-hover:-translate-y-0.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                  </svg>
                  Back to top
                </a>
              </div>
            </div>
          </div>
        </Container>
      </Section>
    </MarketingShell>
  );
}
