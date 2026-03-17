import { buildLeaderboard, buildPointHistory } from "@/hooks/competitionHelpers";
import type { CompetitionPoint, CompetitionTeam } from "@teammeet/types";

// Minimal factory helpers
function makeTeam(overrides: Partial<CompetitionTeam> & { id: string; name: string }): CompetitionTeam {
  return {
    competition_id: "comp-1",
    created_at: "2026-01-01T00:00:00Z",
    organization_id: "org-1",
    ...overrides,
  };
}

function makePoint(overrides: Partial<CompetitionPoint> & { id: string; points: number }): CompetitionPoint {
  return {
    competition_id: "comp-1",
    created_at: "2026-01-01T00:00:00Z",
    created_by: null,
    deleted_at: null,
    member_id: null,
    notes: null,
    organization_id: "org-1",
    reason: null,
    team_id: null,
    team_name: null,
    ...overrides,
  };
}

describe("buildLeaderboard", () => {
  it("returns empty array for empty inputs", () => {
    expect(buildLeaderboard([], [])).toEqual([]);
  });

  it("returns empty array when there are teams but no points", () => {
    const teams = [makeTeam({ id: "t1", name: "Alpha" })];
    expect(buildLeaderboard([], teams)).toEqual([]);
  });

  it("aggregates points correctly by team_id lookup", () => {
    const teams = [
      makeTeam({ id: "t1", name: "Alpha" }),
      makeTeam({ id: "t2", name: "Beta" }),
    ];
    const points = [
      makePoint({ id: "p1", points: 10, team_id: "t1" }),
      makePoint({ id: "p2", points: 5, team_id: "t1" }),
      makePoint({ id: "p3", points: 20, team_id: "t2" }),
    ];

    const result = buildLeaderboard(points, teams);
    expect(result).toEqual([
      { name: "Beta", total_points: 20 },
      { name: "Alpha", total_points: 15 },
    ]);
  });

  it("sorts descending by total_points", () => {
    const teams = [
      makeTeam({ id: "t1", name: "Low" }),
      makeTeam({ id: "t2", name: "Mid" }),
      makeTeam({ id: "t3", name: "High" }),
    ];
    const points = [
      makePoint({ id: "p1", points: 5, team_id: "t1" }),
      makePoint({ id: "p2", points: 15, team_id: "t2" }),
      makePoint({ id: "p3", points: 30, team_id: "t3" }),
    ];

    const result = buildLeaderboard(points, teams);
    expect(result[0].name).toBe("High");
    expect(result[1].name).toBe("Mid");
    expect(result[2].name).toBe("Low");
  });

  it("falls back to point.team_name when team_id is null", () => {
    const teams: CompetitionTeam[] = [];
    const points = [
      makePoint({ id: "p1", points: 10, team_id: null, team_name: "Wildcards" }),
    ];

    const result = buildLeaderboard(points, teams);
    expect(result).toEqual([{ name: "Wildcards", total_points: 10 }]);
  });

  it('uses "Unassigned" when neither team_id nor team_name resolves', () => {
    const teams: CompetitionTeam[] = [];
    const points = [
      makePoint({ id: "p1", points: 7, team_id: null, team_name: null }),
    ];

    const result = buildLeaderboard(points, teams);
    expect(result).toEqual([{ name: "Unassigned", total_points: 7 }]);
  });

  it("falls back to team_name when team_id does not match any team", () => {
    const teams = [makeTeam({ id: "t1", name: "Alpha" })];
    const points = [
      makePoint({ id: "p1", points: 10, team_id: "nonexistent", team_name: "Legacy" }),
    ];

    const result = buildLeaderboard(points, teams);
    expect(result).toEqual([{ name: "Legacy", total_points: 10 }]);
  });
});

describe("buildPointHistory", () => {
  it("maps notes correctly", () => {
    const teams = [makeTeam({ id: "t1", name: "Alpha" })];
    const points = [
      makePoint({ id: "p1", points: 5, team_id: "t1", notes: "Great performance" }),
    ];

    const result = buildPointHistory(points, teams);
    expect(result[0].notes).toBe("Great performance");
  });

  it("falls back to reason when notes is null", () => {
    const teams = [makeTeam({ id: "t1", name: "Alpha" })];
    const points = [
      makePoint({ id: "p1", points: 5, team_id: "t1", notes: null, reason: "Weekly bonus" }),
    ];

    const result = buildPointHistory(points, teams);
    expect(result[0].notes).toBe("Weekly bonus");
  });

  it("handles null created_at", () => {
    const teams = [makeTeam({ id: "t1", name: "Alpha" })];
    const points = [
      makePoint({ id: "p1", points: 5, team_id: "t1", created_at: null }),
    ];

    const result = buildPointHistory(points, teams);
    expect(result[0].created_at).toBeNull();
  });

  it("preserves input order", () => {
    const teams = [makeTeam({ id: "t1", name: "Alpha" })];
    const points = [
      makePoint({ id: "p1", points: 10, team_id: "t1", created_at: "2026-01-03T00:00:00Z" }),
      makePoint({ id: "p2", points: 5, team_id: "t1", created_at: "2026-01-01T00:00:00Z" }),
      makePoint({ id: "p3", points: 8, team_id: "t1", created_at: "2026-01-02T00:00:00Z" }),
    ];

    const result = buildPointHistory(points, teams);
    expect(result.map((r) => r.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("returns empty array for empty inputs", () => {
    expect(buildPointHistory([], [])).toEqual([]);
  });

  it("resolves team name from team_id", () => {
    const teams = [makeTeam({ id: "t1", name: "Alpha" })];
    const points = [makePoint({ id: "p1", points: 5, team_id: "t1" })];

    const result = buildPointHistory(points, teams);
    expect(result[0].team_name).toBe("Alpha");
  });

  it('uses "Unassigned" when team_id lookup fails and team_name is null', () => {
    const points = [makePoint({ id: "p1", points: 5, team_id: "missing", team_name: null })];

    const result = buildPointHistory(points, []);
    expect(result[0].team_name).toBe("Unassigned");
  });
});
