import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { PageHeader } from "@/components/layout";
import { CohortConsoleClient } from "./CohortConsoleClient";

interface CohortsPageProps {
  params: Promise<{ orgSlug: string }>;
}

// Admin-only console that segments the org's alumni by reachability state and
// re-invites the unclaimed-with-email cohort. Mirrors the data-health page gate.
export default async function CohortsPage({ params }: CohortsPageProps) {
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);

  if (!orgCtx.organization) return null;
  if (!orgCtx.isAdmin) redirect(`/${orgSlug}`);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Alumni reachability"
        description="Segment alumni by whether they can be reached, and re-invite the unclaimed cohort. Re-invites are limited to one every 14 days per alumnus."
      />
      <CohortConsoleClient organizationId={orgCtx.organization.id} />
    </div>
  );
}
