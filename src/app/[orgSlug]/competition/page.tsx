import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { Card, Badge, Button, EmptyState, SoftDeleteButton } from "@/components/ui";
import { getOrgContext } from "@/lib/auth/roles";

interface CompetitionPageProps {
  params: Promise<{ orgSlug: string }>;
}

const RECENT_ACTIVITY_LIMIT = 10;

function getRelativeTime(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
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
          .is("deleted_at", null)
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

  const pointHistory = points.slice(0, RECENT_ACTIVITY_LIMIT).map((entry) => ({
    id: entry.id,
    team_name: entry.team_id ? teamLookup.get(entry.team_id) : entry.team_name || "Unassigned",
    points: entry.points,
    notes: entry.notes || entry.reason || null,
    created_at: entry.created_at,
  }));

  const topTeam = leaderboard[0];
  const maxPoints = Math.max(topTeam?.total_points ?? 0, 1);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={competition?.name || "Competition"}
        description={competition?.description || "Track team standings and points"}
        actions={
          isAdmin && !competition && (
            <Link href={`/${orgSlug}/competitions/new`}>
              <Button variant="secondary">New Competition</Button>
            </Link>
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
          {/* Hero Leader Banner - Scoreboard Style */}
          {topTeam && (
            <div className="scoreboard hero-scoreboard rounded-2xl p-6 md:p-8 mb-8">
              <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-5">
                  <div className="trophy-bounce h-16 w-16 md:h-20 md:w-20 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg">
                    <svg aria-hidden="true" className="h-8 w-8 md:h-10 md:w-10 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m3.044-1.35a6.726 6.726 0 01-2.748 1.35m0 0a6.772 6.772 0 01-3.044 0" />
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="live-indicator inline-block h-2 w-2 rounded-full bg-emerald-400"></span>
                      <span className="text-xs font-medium uppercase tracking-wider text-emerald-400">Current Leader</span>
                    </div>
                    <h2 className="text-2xl md:text-3xl font-bold text-white font-display">{topTeam.name}</h2>
                  </div>
                </div>
                <div className="text-center md:text-right">
                  <p className="scoreboard-number text-4xl md:text-5xl font-bold">
                    {topTeam.total_points.toLocaleString()}
                  </p>
                  <p className="text-sm text-slate-400 mt-1">points</p>
                </div>
              </div>
            </div>
          )}

          {/* Full-Width Leaderboard */}
          <Card className="overflow-hidden mb-8">
            <div className="p-4 md:p-6 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Leaderboard</h3>
                {competition.season && (
                  <p className="text-sm text-muted-foreground">Season {competition.season}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="live-indicator inline-block h-2 w-2 rounded-full bg-emerald-500"></span>
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Live</span>
              </div>
            </div>

            {leaderboard.length > 0 ? (
              <div className="divide-y divide-border stagger-children">
                {leaderboard.map((team, index) => {
                  const percentage = (team.total_points / maxPoints) * 100;
                  const rankClass = index === 0 ? "rank-gold" : index === 1 ? "rank-silver" : index === 2 ? "rank-bronze" : "";

                  return (
                    <div
                      key={team.name}
                      className={`leaderboard-row p-4 md:p-5 flex items-center gap-4 ${
                        index === 0 ? "bg-amber-50/30 dark:bg-amber-900/10" : ""
                      }`}
                    >
                      {/* Rank Badge */}
                      <div
                        className={`h-10 w-10 md:h-12 md:w-12 rounded-full flex items-center justify-center font-bold text-white shrink-0 ${
                          rankClass || "bg-muted text-muted-foreground"
                        }`}
                      >
                        <span className="font-mono text-lg">{index + 1}</span>
                      </div>

                      {/* Team Name & Progress Bar */}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground truncate mb-2">{team.name}</p>
                        <div className="standings-bar">
                          <div
                            className="standings-bar-fill"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>

                      {/* Points */}
                      <div className="text-right shrink-0">
                        <p className="text-2xl md:text-3xl font-bold text-foreground font-mono">
                          {team.total_points.toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">pts</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                title="No points recorded yet"
                description="Add points to see the leaderboard"
              />
            )}
          </Card>

          {/* Two-Column Grid: Live Feed + Teams */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Live Feed */}
            <Card className="overflow-hidden">
              <div className="p-4 border-b border-border flex items-center gap-2">
                <span className="live-indicator inline-block h-2 w-2 rounded-full bg-red-500"></span>
                <h3 className="font-semibold text-foreground">Live Feed</h3>
              </div>

              {pointHistory.length > 0 ? (
                <div className="divide-y divide-border max-h-96 overflow-y-auto">
                  {pointHistory.map((entry, idx) => (
                    <div
                      key={entry.id}
                      className="activity-entry p-4 space-y-1"
                      style={{ animationDelay: `${idx * 0.05}s` }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-foreground">{entry.team_name}</p>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={entry.points > 0 ? "success" : "error"}
                            className={entry.points > 0 ? "points-positive" : "points-negative"}
                          >
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
                      {entry.notes && (
                        <p className="text-sm text-muted-foreground">{entry.notes}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {getRelativeTime(entry.created_at)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-muted-foreground">
                  <p>No activity yet</p>
                  <p className="text-sm mt-1">Points will appear here as they&apos;re added</p>
                </div>
              )}
            </Card>

            {/* Teams */}
            <Card className="overflow-hidden">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-foreground">Teams</h3>
                  <p className="text-sm text-muted-foreground">{teams.length} active</p>
                </div>
                {isAdmin && (
                  <Link href={`/${orgSlug}/competition/add-team`}>
                    <Button variant="secondary" size="sm">
                      <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      Add Team
                    </Button>
                  </Link>
                )}
              </div>
              {teams.length > 0 ? (
                <div className="divide-y divide-border max-h-96 overflow-y-auto">
                  {teams.map((team) => {
                    const teamPoints = leaderboard.find((l) => l.name === team.name)?.total_points || 0;
                    return (
                      <div key={team.id} className="p-4 flex items-center justify-between">
                        <div>
                          <p className="font-medium text-foreground">{team.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Created {new Date(team.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <span className="font-mono text-sm font-medium text-muted-foreground">
                          {teamPoints.toLocaleString()} pts
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-6 text-center text-muted-foreground">
                  <p>No teams yet</p>
                  {isAdmin && (
                    <p className="text-sm mt-1">Add a team to get started</p>
                  )}
                </div>
              )}
            </Card>
          </div>

          {/* Floating Action Button - Add Points (Admin Only) */}
          {isAdmin && (
            <Link
              href={`/${orgSlug}/competition/add-points`}
              className="fab"
            >
              <Button className="h-14 w-14 rounded-full shadow-lg p-0 flex items-center justify-center">
                <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                <span className="sr-only">Add Points</span>
              </Button>
            </Link>
          )}
        </>
      )}
    </div>
  );
}
