import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { Calendar, Plus, Trophy, Users, Trash2 } from "lucide-react-native";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import { supabase } from "@/lib/supabase";
import { borderRadius, fontSize, fontWeight, spacing, type ThemeColors } from "@/lib/theme";
import type { Competition, CompetitionPoint, CompetitionTeam } from "@teammeet/types";

type LeaderboardEntry = { name: string; total_points: number };
type PointHistoryEntry = {
  id: string;
  team_name: string;
  points: number;
  notes: string | null;
  created_at: string;
};

export default function CompetitionScreen() {
  const router = useRouter();
  const { orgId, orgSlug } = useOrg();
  const { isAdmin } = useOrgRole();
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isMountedRef = useRef(true);
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [teams, setTeams] = useState<CompetitionTeam[]>([]);
  const [points, setPoints] = useState<CompetitionPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCompetitionData = useCallback(
    async (isRefresh = false) => {
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

          teamRows = (teamsData || []) as CompetitionTeam[];
          pointRows = (pointsData || []) as CompetitionPoint[];
        }

        if (isMountedRef.current) {
          setCompetition(latestCompetition as Competition | null);
          setTeams(teamRows);
          setPoints(pointRows);
          setError(null);
        }
      } catch (fetchError) {
        if (isMountedRef.current) {
          setError((fetchError as Error).message || "Failed to load competition data.");
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [orgId]
  );

  useEffect(() => {
    isMountedRef.current = true;
    fetchCompetitionData();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchCompetitionData]);

  useEffect(() => {
    if (!orgId) return;
    const competitionsChannel = supabase
      .channel(`competitions:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "competitions",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchCompetitionData();
        }
      )
      .subscribe();

    const teamsChannel = supabase
      .channel(`competition_teams:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "competition_teams",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchCompetitionData();
        }
      )
      .subscribe();

    const pointsChannel = supabase
      .channel(`competition_points:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "competition_points",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchCompetitionData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(competitionsChannel);
      supabase.removeChannel(teamsChannel);
      supabase.removeChannel(pointsChannel);
    };
  }, [orgId, fetchCompetitionData]);

  const handleRefresh = useCallback(
    () => fetchCompetitionData(true),
    [fetchCompetitionData]
  );

  const handleCreateCompetition = useCallback(() => {
    router.push(`/(app)/${orgSlug}/competitions/new`);
  }, [router, orgSlug]);

  const handleAddTeam = useCallback(() => {
    router.push(`/(app)/${orgSlug}/competition/add-team`);
  }, [router, orgSlug]);

  const handleAddPoints = useCallback(() => {
    router.push(`/(app)/${orgSlug}/competition/add-points`);
  }, [router, orgSlug]);

  const handleDeletePoint = useCallback(
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
              const { error: deleteError } = await supabase
                .from("competition_points")
                .update({ deleted_at: new Date().toISOString() })
                .eq("id", pointId)
                .eq("competition_id", competition.id);

              if (deleteError) {
                setError(deleteError.message);
                return;
              }

              fetchCompetitionData();
            },
          },
        ]
      );
    },
    [competition, fetchCompetitionData]
  );

  const { leaderboard, pointHistory, topTeam, teamPoints } = useMemo(() => {
    const teamLookup = new Map<string, string>();
    teams.forEach((team) => teamLookup.set(team.id, team.name));

    const leaderboardMap = new Map<string, number>();
    points.forEach((point) => {
      const teamName = point.team_id
        ? teamLookup.get(point.team_id)
        : point.team_name || "Unassigned";
      if (!teamName) return;
      leaderboardMap.set(teamName, (leaderboardMap.get(teamName) || 0) + Number(point.points));
    });

    const leaderboardList: LeaderboardEntry[] = Array.from(leaderboardMap.entries())
      .map(([name, total_points]) => ({ name, total_points }))
      .sort((a, b) => b.total_points - a.total_points);

    const history: PointHistoryEntry[] = points.map((entry) => ({
      id: entry.id,
      team_name: entry.team_id
        ? teamLookup.get(entry.team_id) || "Unassigned"
        : entry.team_name || "Unassigned",
      points: Number(entry.points),
      notes: entry.notes || entry.reason || null,
      created_at: entry.created_at,
    }));

    const teamPointMap = new Map<string, number>();
    leaderboardList.forEach((item) => teamPointMap.set(item.name, item.total_points));

    return {
      leaderboard: leaderboardList,
      pointHistory: history,
      topTeam: leaderboardList[0],
      teamPoints: teamPointMap,
    };
  }, [points, teams]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={colors.primary}
        />
      }
    >
      <Stack.Screen options={{ title: "Competition" }} />
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>
            {competition?.name || "Intersquad Competition & Point Tracker"}
          </Text>
          <Text style={styles.headerSubtitle}>
            {competition?.description || "Track team standings and points"}
          </Text>
        </View>
        {isAdmin ? (
          <View style={styles.headerActions}>
            <Pressable
              onPress={handleCreateCompetition}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.secondaryButtonPressed,
              ]}
            >
              <Text style={styles.secondaryButtonText}>New</Text>
            </Pressable>
            {competition ? (
              <>
                <Pressable
                  onPress={handleAddTeam}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && styles.secondaryButtonPressed,
                  ]}
                >
                  <Text style={styles.secondaryButtonText}>Add Team</Text>
                </Pressable>
                <Pressable
                  onPress={handleAddPoints}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && styles.primaryButtonPressed,
                  ]}
                >
                  <Plus size={16} color={colors.primaryForeground} />
                  <Text style={styles.primaryButtonText}>Points</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        ) : null}
      </View>

      {error ? (
        <View style={styles.errorCard}>
          <Text selectable style={styles.errorText}>
            {error}
          </Text>
          <Pressable
            onPress={handleRefresh}
            style={({ pressed }) => [
              styles.retryButton,
              pressed && styles.retryButtonPressed,
            ]}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {loading && !competition ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>Loading competition...</Text>
        </View>
      ) : !competition ? (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>No competition yet</Text>
          <Text style={styles.emptySubtitle}>
            Create a competition to start tracking standings.
          </Text>
          {isAdmin ? (
            <Pressable
              onPress={handleCreateCompetition}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.primaryButtonPressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>Create competition</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <>
          {topTeam ? (
            <View style={[styles.card, styles.leaderCard]}>
              <View style={styles.leaderRow}>
                <View style={styles.leaderIcon}>
                  <Trophy size={28} color={colors.primaryForeground} />
                </View>
                <View style={styles.leaderInfo}>
                  <Text style={styles.leaderLabel}>Current Leader</Text>
                  <Text style={styles.leaderName}>{topTeam.name}</Text>
                  <Text style={styles.leaderPoints}>
                    {topTeam.total_points} points
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View>
                <Text style={styles.cardTitle}>Leaderboard</Text>
                {competition.season ? (
                  <Text style={styles.cardSubtitle}>Season {competition.season}</Text>
                ) : null}
              </View>
              <View style={styles.cardHeaderIcon}>
                <Trophy size={18} color={colors.primary} />
              </View>
            </View>

            {leaderboard.length > 0 ? (
              <View style={styles.list}>
                {leaderboard.map((team, index) => (
                  <View
                    key={`${team.name}-${index}`}
                    style={[
                      styles.leaderboardRow,
                      index === 0 && styles.leaderboardRowTop,
                    ]}
                  >
                    {(() => {
                      const badgeStyle = rankBadgeStyle(index, colors);
                      return (
                        <View style={[styles.rankBadge, { backgroundColor: badgeStyle.backgroundColor }]}>
                          <Text style={[styles.rankText, { color: badgeStyle.textColor }]}>
                            {index + 1}
                          </Text>
                        </View>
                      );
                    })()}
                    <View style={styles.leaderboardNameWrap}>
                      <Text style={styles.leaderboardName}>{team.name}</Text>
                    </View>
                    <View style={styles.leaderboardPoints}>
                      <Text style={styles.leaderboardPointsValue}>
                        {team.total_points}
                      </Text>
                      <Text style={styles.leaderboardPointsLabel}>points</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.emptySubtitle}>No points recorded yet.</Text>
            )}
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View>
                <Text style={styles.cardTitle}>Recent Activity</Text>
              </View>
              <View style={styles.cardHeaderIcon}>
                <Calendar size={18} color={colors.primary} />
              </View>
            </View>

            {pointHistory.length > 0 ? (
              <View style={styles.list}>
                {pointHistory.map((entry) => (
                  <View key={entry.id} style={styles.activityRow}>
                    <View style={styles.activityHeader}>
                      <Text style={styles.activityTeam}>{entry.team_name}</Text>
                      <View style={styles.activityActions}>
                        <View
                          style={[
                            styles.pointsBadge,
                            entry.points >= 0 ? styles.pointsBadgePositive : styles.pointsBadgeNegative,
                          ]}
                        >
                          <Text style={styles.pointsBadgeText}>
                            {entry.points > 0 ? "+" : ""}
                            {entry.points}
                          </Text>
                        </View>
                        {isAdmin ? (
                          <Pressable
                            onPress={() => handleDeletePoint(entry.id)}
                            style={({ pressed }) => [
                              styles.deleteButton,
                              pressed && styles.deleteButtonPressed,
                            ]}
                          >
                            <Trash2 size={14} color={colors.error} />
                            <Text style={styles.deleteButtonText}>Delete</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                    {entry.notes ? (
                      <Text style={styles.activityNotes}>{entry.notes}</Text>
                    ) : null}
                    <Text style={styles.activityDate}>
                      {formatDate(entry.created_at)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.emptySubtitle}>No activity yet.</Text>
            )}
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View>
                <Text style={styles.cardTitle}>Teams</Text>
                <Text style={styles.cardSubtitle}>
                  Active teams in this competition
                </Text>
              </View>
              <View style={styles.cardHeaderIcon}>
                <Users size={18} color={colors.primary} />
              </View>
            </View>
            {teams.length > 0 ? (
              <View style={styles.list}>
                {teams.map((team) => (
                  <View key={team.id} style={styles.teamRow}>
                    <View>
                      <Text style={styles.teamName}>{team.name}</Text>
                      <Text style={styles.teamMeta}>
                        Created {formatDate(team.created_at)}
                      </Text>
                    </View>
                    <View style={styles.teamPointsBadge}>
                      <Text style={styles.teamPointsText}>
                        {teamPoints.get(team.name) || 0} pts
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.emptySubtitle}>No teams yet.</Text>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function formatDate(value: string) {
  const datePart = value.split("T")[0];
  const [year, month, day] = datePart.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString();
}

function rankBadgeStyle(index: number, colors: ThemeColors) {
  if (index === 0) {
    return { backgroundColor: colors.primary, textColor: colors.primaryForeground };
  }
  if (index === 1) {
    return { backgroundColor: colors.mutedSurface, textColor: colors.foreground };
  }
  if (index === 2) {
    return { backgroundColor: colors.secondary, textColor: colors.secondaryForeground };
  }
  return { backgroundColor: colors.mutedSurface, textColor: colors.mutedForeground };
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      padding: spacing.md,
      paddingBottom: spacing.xl,
      gap: spacing.lg,
    },
    header: {
      gap: spacing.sm,
    },
    headerText: {
      gap: spacing.xs,
    },
    headerTitle: {
      fontSize: fontSize["2xl"],
      fontWeight: fontWeight.bold,
      color: colors.foreground,
    },
    headerSubtitle: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    headerActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    errorCard: {
      backgroundColor: `${colors.error}14`,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: `${colors.error}55`,
      gap: spacing.sm,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: colors.error,
    },
    retryButton: {
      alignSelf: "flex-start",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      borderRadius: borderRadius.md,
      backgroundColor: colors.error,
    },
    retryButtonPressed: {
      opacity: 0.85,
    },
    retryButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: "#ffffff",
    },
    loadingState: {
      alignItems: "center",
      gap: spacing.sm,
    },
    loadingText: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: borderRadius.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      gap: spacing.md,
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)",
    },
    leaderCard: {
      backgroundColor: `${colors.primary}12`,
      borderColor: `${colors.primary}30`,
    },
    leaderRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    leaderIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    leaderInfo: {
      flex: 1,
      gap: spacing.xs,
    },
    leaderLabel: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    leaderName: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      color: colors.foreground,
    },
    leaderPoints: {
      fontSize: fontSize.xl,
      fontWeight: fontWeight.bold,
      color: colors.primary,
      fontVariant: ["tabular-nums"],
    },
    cardHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    cardTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    cardSubtitle: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    cardHeaderIcon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.mutedSurface,
      alignItems: "center",
      justifyContent: "center",
    },
    list: {
      gap: spacing.sm,
    },
    leaderboardRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      padding: spacing.sm,
      borderRadius: borderRadius.md,
      backgroundColor: colors.mutedSurface,
    },
    leaderboardRowTop: {
      backgroundColor: `${colors.primary}12`,
    },
    rankBadge: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    rankText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.bold,
    },
    leaderboardNameWrap: {
      flex: 1,
    },
    leaderboardName: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    leaderboardPoints: {
      alignItems: "flex-end",
    },
    leaderboardPointsValue: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      color: colors.foreground,
      fontVariant: ["tabular-nums"],
    },
    leaderboardPointsLabel: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
    },
    activityRow: {
      padding: spacing.sm,
      borderRadius: borderRadius.md,
      backgroundColor: colors.mutedSurface,
      gap: spacing.xs,
    },
    activityHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    activityTeam: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      flex: 1,
    },
    activityActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    pointsBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: 999,
    },
    pointsBadgePositive: {
      backgroundColor: `${colors.success}22`,
    },
    pointsBadgeNegative: {
      backgroundColor: `${colors.error}22`,
    },
    pointsBadgeText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      fontVariant: ["tabular-nums"],
    },
    deleteButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: borderRadius.md,
      backgroundColor: `${colors.error}14`,
    },
    deleteButtonPressed: {
      opacity: 0.8,
    },
    deleteButtonText: {
      fontSize: fontSize.xs,
      color: colors.error,
      fontWeight: fontWeight.semibold,
    },
    activityNotes: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    activityDate: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
    },
    teamRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      padding: spacing.sm,
      borderRadius: borderRadius.md,
      backgroundColor: colors.mutedSurface,
    },
    teamName: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    teamMeta: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
    },
    teamPointsBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: 999,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    teamPointsText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      fontVariant: ["tabular-nums"],
    },
    emptyTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    emptySubtitle: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    primaryButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      backgroundColor: colors.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.xs + 2,
      paddingHorizontal: spacing.md,
      borderCurve: "continuous",
    },
    primaryButtonPressed: {
      opacity: 0.9,
    },
    primaryButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: colors.primaryForeground,
    },
    secondaryButton: {
      paddingVertical: spacing.xs + 2,
      paddingHorizontal: spacing.md,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    secondaryButtonPressed: {
      opacity: 0.85,
    },
    secondaryButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
  });
