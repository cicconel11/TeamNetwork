import Link from "next/link";
import "../../landing-styles.css";

export const revalidate = 3600;

const sections = [
  {
    title: "Who This Notice Is For",
    body: [
      "TeamNetwork is used by schools and school-affiliated organizations to manage membership, communication, events, and alumni engagement.",
      "When a school uses TeamNetwork, the school remains the records holder for student education records. TeamNetwork acts as a service provider supporting the school's documented educational purpose.",
    ],
  },
  {
    title: "Information We Use",
    body: [
      "We use the minimum information needed to operate the service: names, email addresses, organization role, graduation year, and optional profile photos.",
      "We do not store grades, transcripts, attendance records, disciplinary records, Social Security numbers, home addresses, or medical records in TeamNetwork.",
    ],
  },
  {
    title: "How Requests Should Be Routed",
    body: [
      "Parents and guardians should send requests to inspect, correct, export, or delete student information to the school administrator or district privacy contact first.",
      "If a request reaches TeamNetwork directly, we log the request, route it back to the school owner when appropriate, and track acknowledgement and resolution dates so the request is not handled informally.",
    ],
  },
  {
    title: "How We Protect Student Information",
    body: [
      "TeamNetwork applies encrypted transport, encrypted storage, role-based access controls, row-level security, audit logging, and bounded retention for compliance-related logs.",
      "Student information is not sold, not used for advertising, and not redisclosed except as required to provide the contracted service or as required by law.",
    ],
  },
];

export default function ParentNotificationPage() {
  return (
    <div className="landing-page min-h-screen bg-landing-navy text-landing-cream relative noise-overlay">
      <div className="fixed inset-0 stripe-pattern pointer-events-none" />
      <div className="relative z-10 mx-auto max-w-4xl px-6 py-16">
        <Link href="/privacy" className="text-sm text-landing-cream/60 transition-colors hover:text-landing-cream">
          ← Back to Privacy Policy
        </Link>

        <div className="mt-10 rounded-3xl border border-landing-cream/10 bg-landing-navy-light/60 p-8 backdrop-blur-sm">
          <p className="text-xs uppercase tracking-[0.18em] text-landing-green/80">Parent Notice</p>
          <h1 className="mt-3 font-display text-4xl font-bold">Parent Notification Policy</h1>
          <p className="mt-4 max-w-3xl text-landing-cream/65 leading-relaxed">
            Plain-language summary of how TeamNetwork handles student information for school and district customers.
            This page is intended to support district review and parent-facing transparency, not to replace school-issued
            FERPA notices or district-specific contract disclosures.
          </p>
          <p className="mt-3 text-sm text-landing-cream/45">Last Updated: April 20, 2026</p>
        </div>

        <div className="mt-8 space-y-6">
          {sections.map((section) => (
            <section
              key={section.title}
              className="rounded-3xl border border-landing-cream/10 bg-landing-navy-light/50 p-8 backdrop-blur-sm"
            >
              <h2 className="font-display text-2xl font-bold">{section.title}</h2>
              <div className="mt-4 space-y-4">
                {section.body.map((paragraph) => (
                  <p key={paragraph} className="leading-relaxed text-landing-cream/65">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}

          <section className="rounded-3xl border border-landing-green/20 bg-landing-green/10 p-8">
            <h2 className="font-display text-2xl font-bold">Questions</h2>
            <p className="mt-4 leading-relaxed text-landing-cream/70">
              For student-specific questions, contact the school administrator or district privacy office first. For
              TeamNetwork privacy questions, schools may contact{" "}
              <a className="underline decoration-landing-green/60 underline-offset-4" href="mailto:privacy@myteamnetwork.com">
                privacy@myteamnetwork.com
              </a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
