import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getOrgContext } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/supabase/service";
import { CHAT_ELIGIBLE_ORG_ROLES } from "@/lib/chat/recipient-eligibility";
import {
  getViewerConnectionSuggestions,
  CONNECTIONS_PAGE_DISPLAY_LIMIT,
} from "@/lib/connections/viewer-suggestions";
import { PageHeader } from "@/components/layout";
import { EmptyState } from "@/components/ui";
import { SuggestedConnectionCard } from "@/components/connections/SuggestedConnectionCard";

interface PageProps {
  params: Promise<{ orgSlug: string }>;
}

// /[orgSlug]/connections — "People You Should Meet", the primary connection
// surface. Gated to chat-eligible roles (a member feature). Suggestions come from
// the shared source-from-viewer helper, so the page can only ever show people the
// viewer is already a peer of (R5).
export default async function ConnectionsPage({ params }: PageProps) {
  const t = await getTranslations("pages.connections");
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);

  if (!orgCtx.organization) {
    return notFound();
  }

  // orgCtx.role is already normalized; gate on chat eligibility (not admin-only).
  const role = orgCtx.role;
  const isEligible =
    orgCtx.status === "active" &&
    role !== null &&
    (CHAT_ELIGIBLE_ORG_ROLES as readonly string[]).includes(role);
  if (!isEligible || !orgCtx.userId) {
    return notFound();
  }

  const org = orgCtx.organization;
  const serviceSupabase = createServiceClient();

  const { state, suggestions } = await getViewerConnectionSuggestions({
    serviceSupabase,
    orgId: org.id,
    viewerUserId: orgCtx.userId,
    displayLimit: CONNECTIONS_PAGE_DISPLAY_LIMIT,
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      {state === "no_source" ? (
        <EmptyState title={t("noSourceTitle")} description={t("noSourceDescription")} />
      ) : suggestions.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {suggestions.map((suggestion) => (
            <SuggestedConnectionCard
              key={`${suggestion.person_type}:${suggestion.person_id}`}
              suggestion={suggestion}
              orgId={org.id}
              orgSlug={orgSlug}
              messageLabel={t("message")}
            />
          ))}
        </div>
      )}
    </div>
  );
}
