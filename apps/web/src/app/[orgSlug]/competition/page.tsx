import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { Card, Badge, Button, EmptyState, SoftDeleteButton } from "@/components/ui";
import { getOrgContext } from "@/lib/auth/roles";

interface CompetitionPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function CompetitionPage({ params }: CompetitionPageProps) {
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);
  const supabase = await createClient();

  if (!orgCtx.organization) return null;

  const orgId = orgCtx.organization.id;
  const isAdmin = orgCtx.isAdmin;

  const { data: competitions } = await supabase
    .from("competitions")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(1);

  const competition = competitions?.[0];

  const teams =
    competition
      ? (await supabase
          .from("competition_teams")
          .select("*")
          .eq("competition_id", competition.id)
          .order("name")).data ?? []
      : [];

  const points =
    competition
      ? (await supabase
          .from("competition_points")
          .select("*")
          .eq("competition_id", competition.id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })).data ?? []
      : [];

  const teamLookup = new Map<string, string>();
  teams.forEach((t) => teamLookup.set(t.id, t.name));

  const leaderboardMap = new Map<string, number>();
  points.forEach((p) => {
    const teamName = p.team_id ? teamLookup.get(p.team_id) : p.team_name || "Unassigned";
    if (!teamName) return;
    leaderboardMap.set(teamName, (leaderboardMap.get(teamName) || 0) + Number(p.points));
  });

  const leaderboard = Array.from(leaderboardMap.entries())
    .map(([name, total_points]) => ({ name, total_points }))
    .sort((a, b) => b.total_points - a.total_points);

  const pointHistory = points.map((entry) => ({
    id: entry.id,
    team_name: entry.team_id ? teamLookup.get(entry.team_id) : entry.team_name || "Unassigned",
    points: entry.points,
    notes: entry.notes || entry.reason || null,
    created_at: entry.created_at,
  }));

  const topTeam = leaderboard[0];

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={competition?.name || "Intersquad Competition & Point Tracker"}
        description={competition?.description || "Track team standings and points"}
        actions={
          isAdmin && (
            <div className="flex flex-wrap gap-2">
              <Link href={`/${orgSlug}/competitions/new`}>
                <Button variant="secondary">New Competition</Button>
              </Link>
              {competition && (
                <>
                  <Link href={`/${orgSlug}/competition/add-team`}>
                    <Button variant="secondary">Add Team</Button>
                  </Link>
                  <Link href={`/${orgSlug}/competition/add-points`}>
                    <Button>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      Add Points
                    </Button>
                  </Link>
                </>
              )}
            </div>
          )
        }
      />

      {!competition ? (
        <Card>
          <EmptyState
            title="No competition yet"
            description="Create a competition to start tracking standings."
            action={
              isAdmin && (
                <Link href={`/${orgSlug}/competitions/new`}>
                  <Button>Create Competition</Button>
                </Link>
              )
            }
          />
        </Card>
      ) : (
        <>
          {topTeam && (
            <Card className="p-6 mb-8 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border-amber-500/20">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
                  <svg className="h-8 w-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m3.044-1.35a6.726 6.726 0 01-2.748 1.35m0 0a6.772 6.772 0 01-3.044 0" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Current Leader</p>
                  <h2 className="text-2xl font-bold text-foreground">{topTeam.name}</h2>
                  <p className="text-3xl font-bold text-amber-600 dark:text-amber-400 font-mono">
                    {topTeam.total_points} points
                  </p>
                </div>
              </div>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2 overflow-hidden">
              <div className="p-4 border-b border-border">
                <h3 className="font-semibold text-foreground">Leaderboard</h3>
                {competition.season && (
                  <p className="text-sm text-muted-foreground">Season {competition.season}</p>
                )}
              </div>

              {leaderboard.length > 0 ? (
                <div className="divide-y divide-border">
                  {leaderboard.map((team, index) => (
                    <div
                      key={team.name}
                      className={`p-4 flex items-center gap-4 ${index === 0 ? "bg-amber-50/50 dark:bg-amber-900/10" : ""}`}
                    >
                      <div
                        className={`h-10 w-10 rounded-full flex items-center justify-center font-bold ${
                          index === 0
                            ? "bg-amber-500 text-white"
                            : index === 1
                            ? "bg-slate-400 text-white"
                            : index === 2
                            ? "bg-amber-700 text-white"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {index + 1}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-foreground">{team.name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-foreground font-mono">{team.total_points}</p>
                        <p className="text-xs text-muted-foreground">points</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No points recorded yet"
                  description="Add points to see the leaderboard"
                />
              )}
            </Card>

            <Card className="lg:col-span-1 overflow-hidden">
              <div className="p-4 border-b border-border">
                <h3 className="font-semibold text-foreground">Recent Activity</h3>
              </div>

              {pointHistory.length > 0 ? (
                <div className="divide-y divide-border max-h-96 overflow-y-auto">
                  {pointHistory.map((entry) => (
                    <div key={entry.id} className="p-4 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-foreground">{entry.team_name}</p>
                        <div className="flex items-center gap-2">
                          <Badge variant={entry.points > 0 ? "success" : "error"}>
                            {entry.points > 0 ? "+" : ""}
                            {entry.points}
                          </Badge>
                          {isAdmin && (
                            <SoftDeleteButton
                              table="competition_points"
                              id={entry.id}
                              organizationField="competition_id"
                              organizationId={competition.id}
                              redirectTo={`/${orgSlug}/competition`}
                              label="Delete"
                            />
                          )}
                        </div>
                      </div>
                      {entry.notes && <p className="text-sm text-muted-foreground">{entry.notes}</p>}
                      <p className="text-xs text-muted-foreground">
                        {new Date(entry.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-muted-foreground">No activity yet</div>
              )}
            </Card>
          </div>

          <Card className="mt-6">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground">Teams</h3>
                <p className="text-sm text-muted-foreground">Active teams in this competition</p>
              </div>
              {isAdmin && (
                <Link href={`/${orgSlug}/competition/add-team`}>
                  <Button variant="secondary">Add Team</Button>
                </Link>
              )}
            </div>
            {teams.length > 0 ? (
              <div className="divide-y divide-border">
                {teams.map((team) => (
                  <div key={team.id} className="p-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-foreground">{team.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Created {new Date(team.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge variant="muted">
                      {leaderboard.find((l) => l.name === team.name)?.total_points || 0} pts
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-muted-foreground">No teams yet</div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

