import { redirect } from "next/navigation";
import { getEnterpriseContext } from "@/lib/auth/enterprise-context";
import { InvitesClient } from "./InvitesClient";

interface PageProps {
  params: Promise<{ enterpriseSlug: string }>;
}

export default async function EnterpriseInvitesPage({ params }: PageProps) {
  const { enterpriseSlug } = await params;
  const context = await getEnterpriseContext(enterpriseSlug);

  if (!context) {
    redirect("/app?error=no_enterprise_access");
  }

  return <InvitesClient enterpriseId={context.enterprise.id} />;
}
