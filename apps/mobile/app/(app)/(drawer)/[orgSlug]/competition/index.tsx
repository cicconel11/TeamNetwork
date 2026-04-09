import { useCallback } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useRouter, useNavigation, useFocusEffect } from "expo-router";
import { Plus } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useCompetition } from "@/hooks/useCompetition";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { APP_CHROME } from "@/lib/chrome";
import { RADIUS, SPACING } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import {
  HeroScoreboard,
  LeaderboardCard,
  ActivityFeedCard,
  TeamsCard,
  CompetitionSkeleton,
} from "@/components/competition";

export default function CompetitionScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { orgId, orgSlug, orgName, orgLogoUrl } = useOrg();
  const { isAdmin } = useOrgRole();
  const { neutral, semantic } = useAppColorScheme();

  const {
    competition,
    teams,
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
  } = useCompetition(orgId);

  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.background,
    },
    headerGradient: {
      paddingBottom: SPACING.md,
    },
    headerSafeArea: {},
    headerContent: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.xs,
      minHeight: 40,
      gap: SPACING.sm,
    },
    orgLogoButton: {
      width: 36,
      height: 36,
    },
    orgLogo: {
      width: 36,
      height: 36,
      borderRadius: 18,
    },
    orgAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: APP_CHROME.avatarBackground,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    orgAvatarText: {
      ...TYPOGRAPHY.titleSmall,
      fontWeight: "700" as const,
      color: APP_CHROME.avatarText,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      ...TYPOGRAPHY.headlineSmall,
      color: APP_CHROME.headerTitle,
    },
    headerMeta: {
      ...TYPOGRAPHY.caption,
      color: APP_CHROME.headerMeta,
      marginTop: 2,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
    },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: 96,
      gap: SPACING.lg,
    },
    adminActions: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: SPACING.sm,
    },
    errorCard: {
      backgroundColor: `${s.error}14`,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
      borderWidth: 1,
      borderColor: `${s.error}55`,
      gap: SPACING.sm,
    },
    errorText: {
      ...TYPOGRAPHY.bodySmall,
      color: s.error,
    },
    retryButton: {
      alignSelf: "flex-start" as const,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs + 2,
      borderRadius: RADIUS.md,
      backgroundColor: s.error,
    },
    retryButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: "#ffffff",
    },
    emptyCard: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      gap: SPACING.md,
      boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
    },
    emptyTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
    },
    emptySubtitle: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
    },
    primaryButton: {
      alignSelf: "flex-start" as const,
      backgroundColor: n.dark900,
      borderRadius: RADIUS.md,
      borderCurve: "continuous" as const,
      paddingVertical: SPACING.xs + 2,
      paddingHorizontal: SPACING.md,
    },
    primaryButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: "#ffffff",
    },
    secondaryButton: {
      paddingVertical: SPACING.xs + 2,
      paddingHorizontal: SPACING.md,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    secondaryButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
    },
    buttonPressed: {
      opacity: 0.85,
    },
    fab: {
      position: "absolute" as const,
      bottom: 24,
      right: 24,
    },
    fabInner: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: n.dark900,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
    },
  }));

  useFocusEffect(
    useCallback(() => {
      refetchIfStale();
    }, [refetchIfStale])
  );

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available
    }
  }, [navigation]);

  const handleCreateCompetition = useCallback(() => {
    router.push(`/(app)/${orgSlug}/competitions/new`);
  }, [router, orgSlug]);

  const handleAddTeam = useCallback(() => {
    router.push(`/(app)/${orgSlug}/competition/add-team`);
  }, [router, orgSlug]);

  const handleAddPoints = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/(app)/${orgSlug}/competition/add-points`);
  }, [router, orgSlug]);

  const handleRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return (
    <View style={styles.container}>
      {/* Gradient Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable
              onPress={handleDrawerToggle}
              style={styles.orgLogoButton}
              accessibilityRole="button"
              accessibilityLabel={`Open navigation for ${orgName}`}
            >
              {orgLogoUrl ? (
                <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0]}</Text>
                </View>
              )}
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Competition</Text>
              <Text style={styles.headerMeta}>
                {teams.length} {teams.length === 1 ? "team" : "teams"}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content Sheet */}
      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={neutral.secondary}
            />
          }
        >
          {isAdmin ? (
            <View style={styles.adminActions}>
              <Pressable
                onPress={handleCreateCompetition}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.secondaryButtonText}>New Competition</Text>
              </Pressable>
              {competition ? (
                <Pressable
                  onPress={handleAddTeam}
                  style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
                >
                  <Text style={styles.secondaryButtonText}>Add Team</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {error ? (
            <View style={styles.errorCard}>
              <Text selectable style={styles.errorText}>{error}</Text>
              <Pressable
                onPress={handleRefresh}
                style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}

          {loading && !competition ? (
            <CompetitionSkeleton />
          ) : !competition ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No competition yet</Text>
              <Text style={styles.emptySubtitle}>
                Create a competition to start tracking standings.
              </Text>
              {isAdmin ? (
                <Pressable
                  onPress={handleCreateCompetition}
                  style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
                >
                  <Text style={styles.primaryButtonText}>Create competition</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <>
              {topTeam ? (
                <HeroScoreboard teamName={topTeam.name} points={topTeam.total_points} />
              ) : null}
              <LeaderboardCard
                leaderboard={leaderboard}
                maxPoints={maxPoints}
                season={competition.season}
              />
              <ActivityFeedCard
                pointHistory={pointHistory}
                isAdmin={isAdmin}
                onDelete={deletePoint}
              />
              <TeamsCard
                teams={teams}
                teamPoints={teamPoints}
                isAdmin={isAdmin}
                onAddTeam={handleAddTeam}
              />
            </>
          )}
        </ScrollView>
      </View>

      {/* FAB - Admin only */}
      {isAdmin && competition ? (
        <Animated.View entering={FadeInDown.delay(600)} style={styles.fab}>
          <Pressable
            onPress={handleAddPoints}
            style={({ pressed }) => [styles.fabInner, pressed && styles.buttonPressed]}
            accessibilityLabel="Add points"
            accessibilityRole="button"
          >
            <Plus size={24} color="#ffffff" />
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}
