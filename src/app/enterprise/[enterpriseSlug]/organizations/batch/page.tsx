import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout";
import { BatchOrgWizard } from "@/components/enterprise/BatchOrgWizard";
import { getEnterpriseContext } from "@/lib/auth/enterprise-context";
import { getEnterprisePermissions } from "@/types/enterprise";

interface BatchOrganizationsPageProps {
  params: Promise<{ enterpriseSlug: string }>;
}

export default async function BatchOrganizationsPage({ params }: BatchOrganizationsPageProps) {
  const { enterpriseSlug } = await params;
  const context = await getEnterpriseContext(enterpriseSlug);

  if (!context) {
    redirect("/app?error=no_enterprise_access");
  }

  const { enterprise, role, subscription } = context;
  const permissions = getEnterprisePermissions(role);

  if (!permissions.canCreateSubOrg) {
    redirect(`/enterprise/${enterpriseSlug}/organizations`);
  }

  return (
    <div className="animate-fade-in max-w-4xl mx-auto">
      <PageHeader
        title="Create Multiple Organizations"
        description="Set up multiple organizations at once and assign members"
        backHref={`/enterprise/${enterpriseSlug}/organizations`}
      />

      <BatchOrgWizard
        enterpriseId={enterprise.id}
        enterpriseSlug={enterpriseSlug}
        initialQuota={{
          currentCount: 0,
          maxAllowed: subscription?.sub_org_quantity ?? null,
          remaining: subscription?.sub_org_quantity != null ? subscription.sub_org_quantity : null,
        }}
      />
    </div>
  );
}
