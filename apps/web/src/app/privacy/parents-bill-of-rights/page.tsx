import Link from "next/link";
import "../../landing-styles.css";

export const revalidate = 3600;

const rights = [
  "Student personally identifiable information is not sold and is not used for commercial advertising.",
  "Parents and eligible students have the right to inspect and review education records through the school, generally within 45 days of a FERPA request.",
  "Requests to correct school-maintained education records should be directed to the school or district because the educational agency remains the records holder.",
  "Safeguards such as encryption, access controls, audit logging, and password protections must protect student data in storage and transit.",
  "Parents and eligible students can raise privacy complaints with the school first and, where applicable, with the New York State Education Department Privacy Office.",
];

export default function ParentsBillOfRightsPage() {
  return (
    <div className="landing-page min-h-screen bg-landing-navy text-landing-cream relative noise-overlay">
      <div className="fixed inset-0 stripe-pattern pointer-events-none" />
      <div className="relative z-10 mx-auto max-w-4xl px-6 py-16">
        <Link href="/privacy" className="text-sm text-landing-cream/60 transition-colors hover:text-landing-cream">
          ← Back to Privacy Policy
        </Link>

        <div className="mt-10 rounded-3xl border border-landing-cream/10 bg-landing-navy-light/60 p-8 backdrop-blur-sm">
          <p className="text-xs uppercase tracking-[0.18em] text-landing-green/80">New York</p>
          <h1 className="mt-3 font-display text-4xl font-bold">Parents&apos; Bill of Rights Summary</h1>
          <p className="mt-4 max-w-3xl text-landing-cream/65 leading-relaxed">
            This page summarizes the protections TeamNetwork expects to support when a New York district evaluates the
            service under Education Law § 2-d. District-specific contracts may require supplemental information and a
            school-published Parents&apos; Bill of Rights alongside this summary.
          </p>
          <p className="mt-3 text-sm text-landing-cream/45">Last Updated: April 20, 2026</p>
        </div>

        <section className="mt-8 rounded-3xl border border-landing-cream/10 bg-landing-navy-light/50 p-8 backdrop-blur-sm">
          <h2 className="font-display text-2xl font-bold">Core Rights We Support</h2>
          <ul className="mt-5 space-y-3">
            {rights.map((right) => (
              <li key={right} className="flex items-start gap-3 text-landing-cream/70">
                <span className="mt-1 text-landing-green">•</span>
                <span className="leading-relaxed">{right}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-6 rounded-3xl border border-landing-cream/10 bg-landing-navy-light/50 p-8 backdrop-blur-sm">
          <h2 className="font-display text-2xl font-bold">How TeamNetwork Handles District Requests</h2>
          <div className="mt-4 space-y-4 text-landing-cream/70">
            <p>
              TeamNetwork documents request source, requester relationship, routing method, acknowledgement method, and
              resolution method so a district can show whether a parent request was redirected to the school or handled
              through an authorized school owner.
            </p>
            <p>
              We maintain a unified DSR request log for intake evidence while leaving execution details in the existing
              deletion and audit tables. That split keeps the audit trail reportable without weakening the underlying
              controls for export and deletion workflows.
            </p>
          </div>
        </section>

        <section className="mt-6 rounded-3xl border border-landing-green/20 bg-landing-green/10 p-8">
          <h2 className="font-display text-2xl font-bold">Complaint and Reference Links</h2>
          <div className="mt-4 space-y-3 text-landing-cream/75">
            <p>
              NYSED Parents and Students privacy resources:{" "}
              <a
                href="https://www.nysed.gov/data-privacy-security/parents-and-students"
                className="underline decoration-landing-green/60 underline-offset-4"
              >
                nysed.gov/data-privacy-security/parents-and-students
              </a>
            </p>
            <p>
              NYSED privacy complaint process:{" "}
              <a
                href="https://www.nysed.gov/data-privacy-security/parents-and-students-file-privacy-complaint"
                className="underline decoration-landing-green/60 underline-offset-4"
              >
                nysed.gov/data-privacy-security/parents-and-students-file-privacy-complaint
              </a>
            </p>
            <p>
              TeamNetwork privacy contact for school and district reviewers:{" "}
              <a className="underline decoration-landing-green/60 underline-offset-4" href="mailto:privacy@myteamnetwork.com">
                privacy@myteamnetwork.com
              </a>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
