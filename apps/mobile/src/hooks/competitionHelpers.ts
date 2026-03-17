import type { CompetitionPoint, CompetitionTeam } from "@teammeet/types";

export type LeaderboardEntry = { name: string; total_points: number };
export type PointHistoryEntry = {
  id: string;
  team_name: string;
  points: number;
  notes: string | null;
  created_at: string | null;
};

/** Pure: aggregate points by team into a sorted leaderboard. */
export function buildLeaderboard(
  points: CompetitionPoint[],
  teams: CompetitionTeam[]
): LeaderboardEntry[] {
  const teamLookup = new Map<string, string>();
  teams.forEach((team) => teamLookup.set(team.id, team.name));

  const totals = new Map<string, number>();
  points.forEach((point) => {
    const teamName = point.team_id
      ? teamLookup.get(point.team_id) ?? point.team_name ?? "Unassigned"
      : point.team_name ?? "Unassigned";
    totals.set(teamName, (totals.get(teamName) ?? 0) + Number(point.points));
  });

  return Array.from(totals.entries())
    .map(([name, total_points]) => ({ name, total_points }))
    .sort((a, b) => b.total_points - a.total_points);
}

/** Pure: map raw competition points into display-friendly history entries. */
export function buildPointHistory(
  points: CompetitionPoint[],
  teams: CompetitionTeam[]
): PointHistoryEntry[] {
  const teamLookup = new Map<string, string>();
  teams.forEach((team) => teamLookup.set(team.id, team.name));

  return points.map((entry) => ({
    id: entry.id,
    team_name: entry.team_id
      ? teamLookup.get(entry.team_id) ?? "Unassigned"
      : entry.team_name ?? "Unassigned",
    points: Number(entry.points),
    notes: entry.notes ?? entry.reason ?? null,
    created_at: entry.created_at,
  }));
}
