import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { Card, Badge, EmptyState } from "@/components/ui";
import { getOrgContext } from "@/lib/auth/roles";
import { MentorshipAdminPanel } from "@/components/mentorship/MentorshipAdminPanel";
import { MentorshipLogForm } from "@/components/mentorship/MentorshipLogForm";
import { MentorPairManager } from "@/components/mentorship/MentorPairManager";
import { MenteeStatusToggle } from "@/components/mentorship/MenteeStatusToggle";

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

  const userLabel = (id: string) => {
    const u = users?.find((user) => user.id === id);
    return u?.name || u?.email || "Unknown";
  };

  const filteredPairs =
    orgCtx.isAdmin
      ? pairs || []
      : (pairs || []).filter((p) =>
          orgCtx.role === "active_member"
            ? p.mentee_user_id === orgCtx.userId
            : p.mentor_user_id === orgCtx.userId
        );

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Mentorship"
        description="Manage and track mentorship pairs"
      />

      {orgCtx.role === "active_member" && <MenteeStatusToggle orgId={orgId} />}

      {orgCtx.isAdmin && <MentorshipAdminPanel orgId={orgId} orgSlug={orgSlug} />}
      {!orgCtx.isAdmin && orgCtx.role === "alumni" && (
        <MentorPairManager orgId={orgId} orgSlug={orgSlug} />
      )}

      {filteredPairs.length === 0 ? (
        <Card>
          <EmptyState
            title="No mentorship pairs yet"
            description="Pairs will appear here once created."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredPairs.map((pair) => {
            const pairLogs = logs?.filter((l) => l.pair_id === pair.id) || [];
            return (
              <Card key={pair.id} className="p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-foreground">{userLabel(pair.mentor_user_id)}</h3>
                    <p className="text-sm text-muted-foreground">Mentor</p>
                  </div>
                  <div className="text-center">
                    <Badge variant="primary">{pair.status}</Badge>
                  </div>
                  <div className="text-right">
                    <h3 className="font-semibold text-foreground">{userLabel(pair.mentee_user_id)}</h3>
                    <p className="text-sm text-muted-foreground">Mentee</p>
                  </div>
                </div>

                {pairLogs.length > 0 ? (
                  <div className="space-y-3">
                    {pairLogs.slice(0, 5).map((log) => (
                      <div key={log.id} className="p-3 rounded-xl bg-muted/50 space-y-1">
                        <div className="flex items-center justify-between text-sm text-muted-foreground">
                          <span>{new Date(log.entry_date).toLocaleDateString()}</span>
                          <span>by {userLabel(log.created_by)}</span>
                        </div>
                        {log.notes && <p className="text-foreground">{log.notes}</p>}
                        {log.progress_metric !== null && (
                          <p className="text-xs text-muted-foreground">Progress: {log.progress_metric}</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No activity logged yet.</p>
                )}

                {(orgCtx.isAdmin || orgCtx.isActiveMember) && (
                  <div className="pt-2 border-t border-border">
                    <MentorshipLogForm orgId={orgId} pairId={pair.id} />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
