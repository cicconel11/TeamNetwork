import Link from "next/link";
import { ButtonLink } from "@/components/ui";

type TermsSection = {
  id: string;
  number: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
};

const termsSections: TermsSection[] = [
  {
    id: "acceptance",
    number: "1",
    title: "Acceptance of Terms",
    paragraphs: [
      "By accessing or using TeamNetwork (\"the Service\"), operated by MAC Connect LLC, you agree to comply with and be bound by these Terms of Service (\"Terms\"). If you do not agree, you may not use the Service.",
    ],
  },
  {
    id: "eligibility",
    number: "2",
    title: "Eligibility",
    paragraphs: [
      "You must be at least 16 years old to use the Service. By using the Service, you represent and warrant that you meet this age requirement.",
    ],
  },
  {
    id: "registration",
    number: "3",
    title: "Account Registration",
    paragraphs: [
      "Users must provide accurate, complete, and current information.",
    ],
    bullets: [
      "You are responsible for maintaining the confidentiality of your account credentials.",
      "You are fully responsible for all activity occurring under your account.",
    ],
  },
  {
    id: "conduct",
    number: "4",
    title: "User Conduct",
    paragraphs: [
      "You agree not to:",
      "Violation of these rules may result in immediate suspension or termination of your account.",
    ],
    bullets: [
      "Violate any applicable laws or regulations.",
      "Upload or transmit content that is illegal, harmful, threatening, abusive, harassing, defamatory, obscene, infringing, or otherwise objectionable.",
      "Attempt to access accounts, systems, or data not authorized to you.",
      "Reverse engineer, copy, modify, or exploit any portion of the Service or its technology.",
    ],
  },
  {
    id: "ip",
    number: "5",
    title: "Intellectual Property & License",
    paragraphs: [
      "TeamNetwork and its licensors retain all rights, title, and interest in the Service, including software, content, designs, trademarks, and logos.",
      "Users may not copy, modify, distribute, create derivative works, or reverse engineer any part of the Service.",
      "By submitting content, you grant TeamNetwork a non-exclusive, worldwide, royalty-free license to display and use your content solely to provide the Service.",
      "TeamNetwork reserves the right to remove any content that violates intellectual property rights or these Terms.",
    ],
  },
  {
    id: "payments",
    number: "6",
    title: "Payments and Subscriptions",
    paragraphs: [
      "Certain features may require payment; all fees are non-refundable unless required by law.",
      "TeamNetwork may adjust fees with notice.",
      "Unauthorized use or sharing of paid content is strictly prohibited.",
    ],
  },
  {
    id: "donations",
    number: "7",
    title: "Donations and Mentorship",
    paragraphs: [
      "The Service may include options to donate to teams or programs, or participate in mentorship opportunities. Users understand that all donations are voluntary and may be subject to separate terms and conditions.",
      "TeamNetwork does not guarantee mentorship outcomes or engagement levels; participation is at the discretion of mentors and teams.",
    ],
  },
  {
    id: "termination",
    number: "8",
    title: "Termination",
    paragraphs: [
      "TeamNetwork may suspend or terminate accounts at any time for violations of these Terms.",
      "Upon termination, your access to content and the Service is revoked, and no refunds will be provided.",
    ],
  },
  {
    id: "disclaimers",
    number: "9",
    title: "Disclaimers",
    paragraphs: [
      "The Service is provided \"as is\" and \"as available\" without warranties of any kind.",
      "TeamNetwork disclaims all warranties, including merchantability, fitness for a particular purpose, and non-infringement.",
      "Use of the Service is at your own risk.",
    ],
  },
  {
    id: "liability",
    number: "10",
    title: "Limitation of Liability",
    paragraphs: [
      "To the fullest extent permitted by law, TeamNetwork shall not be liable for:",
    ],
    bullets: [
      "Any direct, indirect, incidental, special, consequential, or punitive damages.",
      "Loss of profits, data, goodwill, or other intangible losses.",
      "Any claim arising from user content or user conduct.",
    ],
  },
  {
    id: "indemnification",
    number: "11",
    title: "Indemnification",
    paragraphs: [
      "You agree to indemnify, defend, and hold harmless TeamNetwork, MAC Connect LLC, and their affiliates from any claims, damages, or expenses arising from:",
    ],
    bullets: [
      "Your use of the Service.",
      "Your violation of these Terms.",
      "Your violation of intellectual property or other rights.",
    ],
  },
  {
    id: "arbitration",
    number: "12",
    title: "Dispute Resolution and Arbitration",
    paragraphs: [],
    bullets: [
      "Binding Arbitration: Any dispute, claim, or controversy arising out of or relating to these Terms or your use of the Service shall be resolved exclusively through final and binding arbitration under the rules of the American Arbitration Association (AAA).",
      "Waiver of Class Actions: You agree that any arbitration shall be conducted only on an individual basis and not as a class, collective, or representative action, and you expressly waive the right to participate in any class, collective, or representative proceeding.",
      "No Jury Trial: You waive any right to a jury trial for any claims related to these Terms or the Service.",
      "Location and Costs: The arbitration will take place in New York, NY, unless we agree otherwise in writing. Each party will bear its own costs and fees, except as provided under the AAA rules.",
      "Enforceability: If any portion of this arbitration clause is found unenforceable, the remaining provisions shall remain in full force and effect.",
    ],
  },
  {
    id: "changes",
    number: "13",
    title: "Changes to Terms",
    paragraphs: [
      "TeamNetwork may modify these Terms at any time. Changes will be effective when posted. Continued use of the Service constitutes acceptance of the updated Terms.",
    ],
  },
  {
    id: "governing-law",
    number: "14",
    title: "Governing Law",
    paragraphs: [
      "These Terms are governed by the laws of the State of New York, without regard to conflict of law principles.",
    ],
  },
  {
    id: "contact",
    number: "15",
    title: "Contact Information",
    paragraphs: [
      "Email: support@myteamnetwork.com",
    ],
  },
];

export default function TermsPage() {
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
          <h1 className="font-display text-4xl sm:text-5xl font-bold mb-4">Terms of Service</h1>
          <p className="text-landing-cream/50">Last Updated: December 8, 2025</p>
        </div>

        <div className="grid lg:grid-cols-[280px_1fr] gap-12">
          {/* TOC Sidebar */}
          <nav className="hidden lg:block">
            <div className="sticky top-28">
              <p className="text-xs uppercase tracking-[0.15em] text-landing-green mb-4 font-semibold">Table of Contents</p>
              <ul className="space-y-1">
                {termsSections.map((s) => (
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
            {termsSections.map((section) => (
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
              <Link href="/privacy" className="hover:text-landing-cream transition-colors">Privacy</Link>
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
