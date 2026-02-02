import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { CreateSubOrgForm } from "@/components/enterprise/CreateSubOrgForm";
import { getEnterpriseContext } from "@/lib/auth/enterprise-context";
import { getEnterprisePermissions } from "@/types/enterprise";

interface NewOrganizationPageProps {
  params: Promise<{ enterpriseSlug: string }>;
}

export default async function NewOrganizationPage({ params }: NewOrganizationPageProps) {
  const { enterpriseSlug } = await params;
  const context = await getEnterpriseContext(enterpriseSlug);

  if (!context) {
    redirect("/app?error=no_enterprise_access");
  }

  const { role } = context;
  const permissions = getEnterprisePermissions(role);

  if (!permissions.canCreateSubOrg) {
    redirect(`/enterprise/${enterpriseSlug}/organizations`);
  }

  return (
    <div className="animate-fade-in max-w-2xl mx-auto">
      <PageHeader
        title="Create Organization"
        description="Create a new organization under this enterprise"
        backHref={`/enterprise/${enterpriseSlug}/organizations`}
      />

      <CreateSubOrgForm enterpriseSlug={enterpriseSlug} />
    </div>
  );
}
