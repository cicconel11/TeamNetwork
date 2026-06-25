import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { canDevAdminPerform } from "@/lib/auth/dev-admin";
import { getCurrentUser } from "@/lib/auth/roles";
import { AssistantLayout } from "@/components/assistant/AssistantLayout";
import { CHAT_ELIGIBLE_ORG_ROLES } from "@/lib/chat/recipient-eligibility";

interface AssistantPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function AssistantPage({ params }: AssistantPageProps) {
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);

  if (!orgCtx.organization) return notFound();

  const user = await getCurrentUser();
  const isDevAdmin = canDevAdminPerform(user, "view_org");
  // Chat-eligible org roles (admin, active_member, alumni, parent) and dev admins
  // can access the full-page assistant.
  const canAccessAssistant =
    isDevAdmin ||
    (orgCtx.role != null && (CHAT_ELIGIBLE_ORG_ROLES as readonly string[]).includes(orgCtx.role));
  if (!canAccessAssistant) return notFound();

  return <AssistantLayout orgId={orgCtx.organization.id} orgSlug={orgSlug} />;
}
