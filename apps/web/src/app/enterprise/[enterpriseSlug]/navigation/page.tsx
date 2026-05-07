import { redirect } from "next/navigation";
import { getEnterpriseContext } from "@/lib/auth/enterprise-context";
import { NavigationClient } from "./NavigationClient";

interface PageProps {
  params: Promise<{ enterpriseSlug: string }>;
}

export default async function EnterpriseNavigationPage({ params }: PageProps) {
  const { enterpriseSlug } = await params;
  const context = await getEnterpriseContext(enterpriseSlug);

  if (!context) {
    redirect("/app?error=no_enterprise_access");
  }

  return <NavigationClient enterpriseId={context.enterprise.id} />;
}
