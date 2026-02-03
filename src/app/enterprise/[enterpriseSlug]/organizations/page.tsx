import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, Button } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { SubOrgList } from "@/components/enterprise/SubOrgList";
import { getEnterpriseContext } from "@/lib/auth/enterprise-context";
import { getEnterprisePermissions } from "@/types/enterprise";
import { createServiceClient } from "@/lib/supabase/service";
import type { EnterpriseRelationshipType, SubOrgBillingType } from "@/types/enterprise";

interface OrganizationsPageProps {
  params: Promise<{ enterpriseSlug: string }>;
}

export default async function OrganizationsPage({ params }: OrganizationsPageProps) {
  const { enterpriseSlug } = await params;
  const context = await getEnterpriseContext(enterpriseSlug);

  if (!context) {
    redirect("/app?error=no_enterprise_access");
  }

  const { enterprise, role } = context;
  const permissions = getEnterprisePermissions(role);

  // Fetch organizations with alumni counts
  const serviceSupabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: organizations } = await (serviceSupabase as any)
    .from("organizations")
    .select(`
      id,
      name,
      slug,
      enterprise_relationship_type,
      organization_subscriptions (
        status
      )
    `)
    .eq("enterprise_id", enterprise.id)
    .order("name");

  type OrgRow = {
    id: string;
    name: string;
    slug: string;
    enterprise_relationship_type: string | null;
    organization_subscriptions: { status: string }[] | null;
  };
  const typedOrgs = (organizations ?? []) as OrgRow[];

  // Get alumni counts for each org
  const orgIds = typedOrgs.map((o) => o.id);
  const { data: alumniCounts } = orgIds.length > 0
    ? await serviceSupabase
        .from("alumni")
        .select("organization_id")
        .in("organization_id", orgIds)
        .is("deleted_at", null)
    : { data: [] };

  // Build count map
  const countMap: Record<string, number> = {};
  (alumniCounts ?? []).forEach((a: { organization_id: string }) => {
    countMap[a.organization_id] = (countMap[a.organization_id] || 0) + 1;
  });

  // Transform for SubOrgList
  const orgs = typedOrgs.map((org) => {
    const subscriptionStatus = org.organization_subscriptions?.[0]?.status ?? null;
    const billingType: SubOrgBillingType = subscriptionStatus === "enterprise_managed"
      ? "enterprise_managed"
      : "independent";

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      alumniCount: countMap[org.id] || 0,
      relationshipType: (org.enterprise_relationship_type || "created") as EnterpriseRelationshipType,
      billingType,
    };
  });

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Organizations"
        description={`${orgs.length} organization${orgs.length !== 1 ? "s" : ""} in this enterprise`}
        actions={
          <div className="flex gap-2">
            {permissions.canAdoptOrg && (
              <Link href={`/enterprise/${enterpriseSlug}/organizations/adopt`}>
                <Button variant="secondary">
                  <AdoptIcon className="h-4 w-4" />
                  Adopt Existing
                </Button>
              </Link>
            )}
            {permissions.canCreateSubOrg && (
              <Link href={`/enterprise/${enterpriseSlug}/organizations/new`}>
                <Button>
                  <PlusIcon className="h-4 w-4" />
                  Create New
                </Button>
              </Link>
            )}
          </div>
        }
      />

      <Card>
        <SubOrgList orgs={orgs} />
      </Card>
    </div>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function AdoptIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
      />
    </svg>
  );
}
