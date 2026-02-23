import { redirect } from "next/navigation";
import { getEnterpriseContext } from "@/lib/auth/enterprise-context";
import { getEnterprisePermissions } from "@/types/enterprise";
import { AdoptClient } from "./AdoptClient";

interface PageProps {
  params: Promise<{ enterpriseSlug: string }>;
}

export default async function AdoptOrganizationPage({ params }: PageProps) {
  const { enterpriseSlug } = await params;
  const context = await getEnterpriseContext(enterpriseSlug);

  if (!context) {
    redirect("/app?error=no_enterprise_access");
  }

  const { role } = context;
  const permissions = getEnterprisePermissions(role);

  if (!permissions.canAdoptOrg) {
    redirect(`/enterprise/${enterpriseSlug}/organizations`);
  }

  return <AdoptClient enterpriseSlug={enterpriseSlug} />;
}
