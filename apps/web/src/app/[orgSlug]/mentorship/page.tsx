import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { getOrgContext } from "@/lib/auth/roles";
import { MentorshipAdminPanel } from "@/components/mentorship/MentorshipAdminPanel";
import { MentorPairManager } from "@/components/mentorship/MentorPairManager";
import { MenteeStatusToggle } from "@/components/mentorship/MenteeStatusToggle";
import { MentorshipPairsList } from "@/components/mentorship/MentorshipPairsList";
import { resolveLabel } from "@/lib/navigation/label-resolver";
import type { NavConfig } from "@/lib/navigation/nav-items";

interface MentorshipPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function MentorshipPage({ params }: MentorshipPageProps) {
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);
  const supabase = await createClient();

  if (!orgCtx.organization) return null;

  const orgId = orgCtx.organization.id;

  const { data: pairs } = await supabase
    .from("mentorship_pairs")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  const pairIds = pairs?.map((p) => p.id) || [];

  const { data: logs } =
    pairIds.length > 0
      ? await supabase
          .from("mentorship_logs")
          .select("*")
          .eq("organization_id", orgId)
          .in("pair_id", pairIds)
          .order("entry_date", { ascending: false })
          .order("created_at", { ascending: false })
      : { data: [] };

  const userIds = new Set<string>();
  pairs?.forEach((p) => {
    userIds.add(p.mentor_user_id);
    userIds.add(p.mentee_user_id);
  });

  const { data: users } =
    userIds.size > 0
      ? await supabase.from("users").select("id,name,email").in("id", Array.from(userIds))
      : { data: [] };

  const filteredPairs =
    orgCtx.isAdmin
      ? pairs || []
      : (pairs || []).filter((p) =>
          orgCtx.role === "active_member"
            ? p.mentee_user_id === orgCtx.userId
            : p.mentor_user_id === orgCtx.userId
        );

  // Prepare logs for the client component
  const logsForClient = (logs || []).map((log) => ({
    id: log.id,
    pair_id: log.pair_id,
    entry_date: log.entry_date,
    notes: log.notes,
    progress_metric: log.progress_metric,
    created_by: log.created_by,
  }));

  // Prepare users for the client component
  const usersForClient = (users || []).map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
  }));

  const navConfig = orgCtx.organization.nav_config as NavConfig | null;
  const pageLabel = resolveLabel("/mentorship", navConfig);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={pageLabel}
        description={`Manage and track ${pageLabel.toLowerCase()} pairs`}
      />

      {orgCtx.role === "active_member" && <MenteeStatusToggle orgId={orgId} />}

      {orgCtx.isAdmin && <MentorshipAdminPanel orgId={orgId} orgSlug={orgSlug} />}
      {!orgCtx.isAdmin && orgCtx.role === "alumni" && (
        <MentorPairManager orgId={orgId} orgSlug={orgSlug} />
      )}

      <MentorshipPairsList
        initialPairs={filteredPairs}
        logs={logsForClient}
        users={usersForClient}
        isAdmin={orgCtx.isAdmin}
        canLogActivity={orgCtx.isAdmin || orgCtx.isActiveMember}
        orgId={orgId}
      />
    </div>
  );
}
