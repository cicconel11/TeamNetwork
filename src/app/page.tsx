import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui";

type TermsSection = {
  number: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
};

const termsSections: TermsSection[] = [
  {
    number: "1",
    title: "Acceptance of Terms",
    paragraphs: [
      "By accessing or using TeamNetwork (\"the Service\"), operated by McKillop LLC, you agree to comply with and be bound by these Terms of Service (\"Terms\"). If you do not agree, you may not use the Service.",
    ],
  },
  {
    number: "2",
    title: "Eligibility",
    paragraphs: [
      "You must be at least 16 years old to use the Service. By using the Service, you represent and warrant that you meet this age requirement.",
    ],
  },
  {
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
    number: "6",
    title: "Payments and Subscriptions",
    paragraphs: [
      "Certain features may require payment; all fees are non-refundable unless required by law.",
      "TeamNetwork may adjust fees with notice.",
      "Unauthorized use or sharing of paid content is strictly prohibited.",
    ],
  },
  {
    number: "7",
    title: "Donations and Mentorship",
    paragraphs: [
      "The Service may include options to donate to teams or programs, or participate in mentorship opportunities. Users understand that all donations are voluntary and may be subject to separate terms and conditions.",
      "TeamNetwork does not guarantee mentorship outcomes or engagement levels; participation is at the discretion of mentors and teams.",
    ],
  },
  {
    number: "8",
    title: "Termination",
    paragraphs: [
      "TeamNetwork may suspend or terminate accounts at any time for violations of these Terms.",
      "Upon termination, your access to content and the Service is revoked, and no refunds will be provided.",
    ],
  },
  {
    number: "9",
    title: "Disclaimers",
    paragraphs: [
      "The Service is provided \"as is\" and \"as available\" without warranties of any kind.",
      "TeamNetwork disclaims all warranties, including merchantability, fitness for a particular purpose, and non-infringement.",
      "Use of the Service is at your own risk.",
    ],
  },
  {
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
    number: "11",
    title: "Indemnification",
    paragraphs: [
      "You agree to indemnify, defend, and hold harmless TeamNetwork, McKillop LLC, and their affiliates from any claims, damages, or expenses arising from:",
    ],
    bullets: [
      "Your use of the Service.",
      "Your violation of these Terms.",
      "Your violation of intellectual property or other rights.",
    ],
  },
  {
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
    number: "13",
    title: "Changes to Terms",
    paragraphs: [
      "TeamNetwork may modify these Terms at any time. Changes will be effective when posted. Continued use of the Service constitutes acceptance of the updated Terms.",
    ],
  },
  {
    number: "14",
    title: "Governing Law",
    paragraphs: [
      "These Terms are governed by the laws of the State of New York, without regard to conflict of law principles.",
    ],
  },
  {
    number: "15",
    title: "Contact Information",
    paragraphs: [
      "Email: mckillopm25@gmail.com",
    ],
  },
];

export default async function LandingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // If user is already logged in, redirect to /app (org picker)
  if (user) {
    redirect("/app");
  }

  return (
    <div id="top" className="min-h-screen bg-background">
      {/* Hero Section */}
      <div className="relative overflow-hidden min-h-screen flex flex-col">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" />
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-50" />
        
        {/* Header */}
        <header className="relative z-10 p-6">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <h1 className="text-2xl font-bold text-white">
              Team<span className="text-emerald-400">Network</span>
            </h1>
            <div className="flex items-center gap-4">
              <Link href="#terms-of-service" className="text-sm text-slate-200 hover:text-white">
                Terms
              </Link>
              <Link href="/auth/login">
                <Button variant="ghost" className="text-white hover:bg-white/10">
                  Sign In
                </Button>
              </Link>
              <Link href="/auth/signup">
                <Button className="bg-emerald-500 hover:bg-emerald-600 text-white">
                  Get Started
                </Button>
              </Link>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <div className="relative flex-1 flex items-center justify-center px-6">
          <div className="text-center max-w-3xl animate-fade-in">
            <h2 className="text-5xl sm:text-6xl font-bold text-white mb-6 tracking-tight">
              Your Team&apos;s
              <br />
              <span className="text-emerald-400">Hub for Everything</span>
            </h2>
            <p className="text-xl text-slate-300 max-w-2xl mx-auto mb-10">
              Member directories, events, donations, philanthropy, and records — all in one place. 
              Built for sports teams, a cappella groups, clubs, and organizations of all kinds.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/auth/signup">
                <Button size="lg" className="bg-emerald-500 hover:bg-emerald-600 text-white px-8">
                  Create Your Organization
                </Button>
              </Link>
              <Link href="/auth/login">
                <Button size="lg" variant="secondary" className="bg-white/10 text-white hover:bg-white/20 px-8">
                  Sign In
                </Button>
              </Link>
            </div>
            
            {/* Invite Code Section */}
            <div className="mt-10 pt-8 border-t border-white/10">
              <p className="text-slate-400 mb-3">Have an invite code?</p>
              <Link href="/auth/login?redirect=/app/join">
                <Button variant="ghost" className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10">
                  <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                  </svg>
                  Join an Organization
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Features Preview */}
        <div className="relative z-10 pb-20">
          <div className="max-w-6xl mx-auto px-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <FeatureCard
                icon={<UsersIcon />}
                title="Member Directory"
                description="Track active members and alumni with profiles, positions, and contact info"
              />
              <FeatureCard
                icon={<CalendarIcon />}
                title="Events & Calendar"
                description="Games, meetings, socials, and philanthropy events all organized"
              />
              <FeatureCard
                icon={<DollarIcon />}
                title="Donations"
                description="Track donations, campaigns, and donor information"
              />
              <FeatureCard
                icon={<TrophyIcon />}
                title="Records & Awards"
                description="Record books, competition leaderboards, and achievement tracking"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Terms of Service */}
      <section id="terms-of-service" className="bg-slate-950 border-t border-slate-900 py-16">
        <div className="max-w-6xl mx-auto px-6 space-y-10">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-300">Legal</p>
              <h3 className="text-3xl font-bold text-white mt-2">TeamNetwork Terms of Service</h3>
              <p className="text-sm text-slate-400 mt-1">Last Updated: December 8, 2025</p>
            </div>
            <Link href="#top" className="text-sm text-emerald-300 hover:text-emerald-200">
              Back to top
            </Link>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {termsSections.map((section) => (
              <div key={section.number} className="bg-white/[0.04] backdrop-blur-sm rounded-2xl p-5 border border-white/10">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-lg bg-emerald-500/10 text-emerald-300 flex items-center justify-center font-semibold">
                    {section.number}
                  </div>
                  <div className="space-y-3">
                    <h4 className="text-lg font-semibold text-white">{section.title}</h4>
                    {section.paragraphs.map((paragraph, index) => (
                      <p key={`${section.number}-paragraph-${index}`} className="text-sm text-slate-300 leading-relaxed">
                        {paragraph}
                      </p>
                    ))}
                    {section.bullets && (
                      <ul className="list-disc list-inside text-sm text-slate-300 space-y-1 pl-1">
                        {section.bullets.map((bullet, index) => (
                          <li key={`${section.number}-bullet-${index}`}>{bullet}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 border-t border-slate-800 py-8">
        <div className="max-w-6xl mx-auto px-6 text-center text-sm text-slate-400">
          <p>© {new Date().getFullYear()} TeamNetwork. Built with Next.js and Supabase.</p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
      <div className="h-10 w-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-400 mb-4">
        {icon}
      </div>
      <h3 className="font-semibold text-white mb-2">{title}</h3>
      <p className="text-sm text-slate-400">{description}</p>
    </div>
  );
}

function UsersIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
    </svg>
  );
}

function DollarIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m3.044-1.35a6.726 6.726 0 01-2.748 1.35m0 0a6.772 6.772 0 01-3.044 0" />
    </svg>
  );
}
