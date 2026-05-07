import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { canDevAdminPerform } from "@/lib/auth/dev-admin";
import { getCurrentUser } from "@/lib/auth/roles";
import { AssistantLayout } from "@/components/assistant/AssistantLayout";

interface AssistantPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function AssistantPage({ params }: AssistantPageProps) {
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);

  if (!orgCtx.organization) return notFound();

  const user = await getCurrentUser();
  const isDevAdmin = canDevAdminPerform(user, "view_org");
  const isAdmin = orgCtx.role === "admin" || isDevAdmin;

  // Only admins can access the full-page assistant
  if (!isAdmin) return notFound();

  return <AssistantLayout orgId={orgCtx.organization.id} orgSlug={orgSlug} />;
}
