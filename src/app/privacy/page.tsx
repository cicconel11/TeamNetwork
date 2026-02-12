import Link from "next/link";
import { ButtonLink } from "@/components/ui";

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
      "Payment Information: When you make purchases or donations, payment details are processed securely by our payment processor (Stripe). We do not store full credit card numbers.",
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
      "Stripe: Payment processing for subscriptions and donations.",
      "Google Calendar: Optional calendar synchronization (requires your explicit authorization).",
      "hCaptcha: Bot protection and security verification.",
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
      "To exercise these rights, please contact us at support@myteamnetwork.com.",
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
      "The Service is not intended for children under 16 years of age. We do not knowingly collect personal information from children under 16. If we learn that we have collected personal information from a child under 16, we will take steps to delete that information promptly.",
      "If you believe we have collected information from a child under 16, please contact us at support@myteamnetwork.com.",
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
      "Email: support@myteamnetwork.com",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <div className="landing-page min-h-screen text-landing-cream relative noise-overlay bg-landing-navy">
      {/* Background */}
      <div className="fixed inset-0 stripe-pattern pointer-events-none" />
      <div className="fixed inset-0 bg-gradient-to-b from-landing-navy via-transparent to-landing-navy/90 pointer-events-none" />

      {/* Header */}
      <header className="relative z-20 sticky top-0 bg-landing-navy/95 backdrop-blur-md border-b border-landing-cream/10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="group flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-landing-green-dark flex items-center justify-center">
              <span className="font-display font-bold text-white text-sm">TN</span>
            </div>
            <span className="font-display text-xl font-bold tracking-tight">
              Team<span className="text-landing-green">Network</span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-landing-cream/60 hover:text-landing-cream transition-colors">
              ← Back to Home
            </Link>
            <ButtonLink href="/auth/signup" className="bg-landing-green-dark hover:bg-[#059669] text-white font-semibold">
              Get Started
            </ButtonLink>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-6xl mx-auto px-6 py-16">
        {/* Hero */}
        <div className="mb-16 max-w-3xl">
          <div className="inline-block px-4 py-1.5 rounded-full bg-landing-cream/5 text-landing-cream/60 text-xs uppercase tracking-[0.2em] mb-6">
            Legal
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-bold mb-4">Privacy Policy</h1>
          <p className="text-landing-cream/50">Last Updated: February 10, 2026</p>
        </div>

        <div className="grid lg:grid-cols-[280px_1fr] gap-12">
          {/* TOC Sidebar */}
          <nav className="hidden lg:block">
            <div className="sticky top-28">
              <p className="text-xs uppercase tracking-[0.15em] text-landing-green mb-4 font-semibold">Table of Contents</p>
              <ul className="space-y-1">
                {privacySections.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="text-sm text-landing-cream/50 hover:text-landing-cream transition-colors block py-2 border-l-2 border-landing-cream/10 pl-4 hover:border-landing-green hover:bg-landing-cream/5"
                    >
                      <span className="text-landing-cream/30 mr-2">{s.number}.</span>
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>

          {/* Content */}
          <div className="space-y-6">
            {privacySections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                className="scroll-mt-28 bg-landing-navy-light/50 backdrop-blur-sm rounded-2xl p-6 lg:p-8 border border-landing-cream/10"
              >
                <div className="flex items-start gap-5">
                  <div className="w-12 h-12 rounded-xl bg-landing-green/10 text-landing-green flex items-center justify-center flex-shrink-0">
                    <span className="font-display font-bold text-lg">{section.number}</span>
                  </div>
                  <div className="space-y-4 min-w-0 flex-1">
                    <h2 className="font-display text-xl font-bold text-landing-cream">{section.title}</h2>
                    {section.paragraphs.map((paragraph, index) => (
                      <p key={index} className="text-landing-cream/60 leading-relaxed">
                        {paragraph}
                      </p>
                    ))}
                    {section.bullets && (
                      <ul className="space-y-2 text-landing-cream/60 pl-1">
                        {section.bullets.map((bullet, index) => (
                          <li key={index} className="flex items-start gap-3">
                            <span className="text-landing-green mt-1.5">•</span>
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
            <div className="pt-8 text-center">
              <a 
                href="#"
                className="inline-flex items-center gap-2 text-sm text-landing-cream/40 hover:text-landing-cream transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
                Back to top
              </a>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-landing-cream/10 py-12 bg-landing-navy mt-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded bg-landing-green-dark flex items-center justify-center">
                <span className="font-display font-bold text-white text-sm">TN</span>
              </div>
              <span className="font-display font-bold">TeamNetwork</span>
            </div>
            
            <div className="flex items-center gap-8 text-sm text-landing-cream/50">
              <Link href="/" className="hover:text-landing-cream transition-colors">Home</Link>
              <Link href="/#pricing" className="hover:text-landing-cream transition-colors">Pricing</Link>
              <Link href="/terms" className="hover:text-landing-cream transition-colors">Terms</Link>
              <a href="mailto:support@myteamnetwork.com" className="hover:text-landing-cream transition-colors">Contact</a>
            </div>
            
            <p className="text-sm text-landing-cream/30">
              © {new Date().getFullYear()} TeamNetwork
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
