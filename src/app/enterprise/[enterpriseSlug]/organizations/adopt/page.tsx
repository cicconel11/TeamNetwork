import { redirect } from "next/navigation";
import { getEnterpriseContext } from "@/lib/auth/enterprise-context";
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

  return <AdoptClient enterpriseSlug={enterpriseSlug} />;
}
