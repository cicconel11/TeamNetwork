import { useEffect, useState, useRef, useCallback } from "react";
import { Alert } from "react-native";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import { useRequestTracker } from "@/hooks/useRequestTracker";
import * as sentry from "@/lib/analytics/sentry";
import { buildLeaderboard, buildPointHistory } from "@/hooks/competitionHelpers";
import type { LeaderboardEntry, PointHistoryEntry } from "@/hooks/competitionHelpers";
import type { Competition, CompetitionPoint, CompetitionTeam } from "@teammeet/types";

export type { LeaderboardEntry, PointHistoryEntry } from "@/hooks/competitionHelpers";
export { buildLeaderboard, buildPointHistory } from "@/hooks/competitionHelpers";

const STALE_TIME_MS = 30_000;

export interface UseCompetitionReturn {
  competition: Competition | null;
  teams: CompetitionTeam[];
  points: CompetitionPoint[];
  leaderboard: LeaderboardEntry[];
  pointHistory: PointHistoryEntry[];
  topTeam: LeaderboardEntry | null;
  teamPoints: Map<string, number>;
  maxPoints: number;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  refetchIfStale: () => void;
  deletePoint: (pointId: string) => void;
}

export function useCompetition(orgId: string | null): UseCompetitionReturn {
  const isMountedRef = useRef(true);
  const lastFetchTimeRef = useRef<number>(0);
  const { beginRequest, invalidateRequests, isCurrentRequest } = useRequestTracker();

  const [competition, setCompetition] = useState<Competition | null>(null);
  const [teams, setTeams] = useState<CompetitionTeam[]>([]);
  const [points, setPoints] = useState<CompetitionPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    lastFetchTimeRef.current = 0;
    invalidateRequests();
  }, [orgId, invalidateRequests]);

  const fetchData = useCallback(
    async (isRefresh = false) => {
      const requestId = beginRequest();

      if (!orgId) {
        if (isMountedRef.current) {
          setCompetition(null);
          setTeams([]);
          setPoints([]);
          setLoading(false);
          setRefreshing(false);
          setError(null);
        }
        return;
      }

      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const { data: competitions, error: competitionError } = await supabase
          .from("competitions")
          .select("*")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false })
          .limit(1);

        if (competitionError) throw competitionError;
        if (!isCurrentRequest(requestId)) return;

        const latestCompetition = competitions?.[0] ?? null;
        let teamRows: CompetitionTeam[] = [];
        let pointRows: CompetitionPoint[] = [];

        if (latestCompetition) {
          const [{ data: teamsData, error: teamsError }, { data: pointsData, error: pointsError }] =
            await Promise.all([
              supabase
                .from("competition_teams")
                .select("*")
                .eq("competition_id", latestCompetition.id)
                .order("name"),
              supabase
                .from("competition_points")
                .select("*")
                .eq("competition_id", latestCompetition.id)
                .is("deleted_at", null)
                .order("created_at", { ascending: false }),
            ]);

          if (teamsError) throw teamsError;
          if (pointsError) throw pointsError;
          if (!isCurrentRequest(requestId)) return;

          teamRows = (teamsData ?? []) as CompetitionTeam[];
          pointRows = (pointsData ?? []) as CompetitionPoint[];
        }

        if (isMountedRef.current && isCurrentRequest(requestId)) {
          setCompetition(latestCompetition as Competition | null);
          setTeams(teamRows);
          setPoints(pointRows);
          setError(null);
          lastFetchTimeRef.current = Date.now();
        }
      } catch (e) {
        if (isMountedRef.current && isCurrentRequest(requestId)) {
          const message = (e as Error).message || "Failed to load competition data.";
          setError(message);
          sentry.captureException(e as Error, { context: "useCompetition", orgId });
        }
      } finally {
        if (isMountedRef.current && isCurrentRequest(requestId)) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [orgId, beginRequest, isCurrentRequest]
  );

  const refetch = useCallback(async () => {
    await fetchData(false);
  }, [fetchData]);

  const refetchIfStale = useCallback(() => {
    if (Date.now() - lastFetchTimeRef.current > STALE_TIME_MS) {
      fetchData(false);
    }
  }, [fetchData]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchData(false);
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchData]);

  // Realtime subscriptions
  useEffect(() => {
    if (!orgId) return;

    const competitionsChannel = createPostgresChangesChannel(`competitions:${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "competitions", filter: `organization_id=eq.${orgId}` },
        () => fetchData()
      )
      .subscribe();

    const teamsChannel = createPostgresChangesChannel(`competition_teams:${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "competition_teams", filter: `organization_id=eq.${orgId}` },
        () => fetchData()
      )
      .subscribe();

    const pointsChannel = createPostgresChangesChannel(`competition_points:${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "competition_points", filter: `organization_id=eq.${orgId}` },
        () => fetchData()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(competitionsChannel);
      supabase.removeChannel(teamsChannel);
      supabase.removeChannel(pointsChannel);
    };
  }, [orgId, fetchData]);

  // Derived data
  const leaderboard = buildLeaderboard(points, teams);
  const pointHistory = buildPointHistory(points, teams);
  const topTeam = leaderboard[0] ?? null;

  const teamPoints = new Map<string, number>();
  leaderboard.forEach((item) => teamPoints.set(item.name, item.total_points));

  const maxPoints = leaderboard.length > 0 ? leaderboard[0].total_points : 0;

  const deletePoint = useCallback(
    (pointId: string) => {
      if (!competition) return;
      Alert.alert(
        "Delete points?",
        "This will remove the points from the leaderboard.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              try {
                const { error: deleteError } = await supabase
                  .from("competition_points")
                  .update({ deleted_at: new Date().toISOString() })
                  .eq("id", pointId)
                  .eq("competition_id", competition.id);

                if (deleteError) throw deleteError;
                fetchData();
              } catch (e) {
                sentry.captureException(e as Error, { context: "useCompetition.deletePoint" });
                setError((e as Error).message);
              }
            },
          },
        ]
      );
    },
    [competition, fetchData]
  );

  return {
    competition,
    teams,
    points,
    leaderboard,
    pointHistory,
    topTeam,
    teamPoints,
    maxPoints,
    loading,
    refreshing,
    error,
    refetch,
    refetchIfStale,
    deletePoint,
  };
}
