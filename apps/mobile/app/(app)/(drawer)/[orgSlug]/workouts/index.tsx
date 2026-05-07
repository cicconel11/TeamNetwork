import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useRouter, useNavigation } from "expo-router";
import {
  Calendar,
  ChevronRight,
  Dumbbell,
  ExternalLink,
  Pencil,
  Plus,
} from "lucide-react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useAuth } from "@/hooks/useAuth";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS, SEMANTIC } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatLocalDateString } from "@/lib/date-format";
import { openHttpsUrl } from "@/lib/url-safety";
import type { Workout, WorkoutLog, WorkoutStatus } from "@teammeet/types";

const STATUS_OPTIONS: Array<{ value: WorkoutStatus; label: string }> = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
];

const SECTION_ICONS: Record<string, boolean> = {
  warmup: true,
  power: true,
  "main lifts": true,
  accessories: true,
  "core/neck": true,
  core: true,
  conditioning: true,
  weekly: true,
  cooldown: true,
  notes: true,
};

interface ParsedSection {
  label: string;
  content: string;
}

function parseWorkoutDescription(description: string): ParsedSection[] {
  const lines = description.split("\n").filter((l) => l.trim());
  const sections: ParsedSection[] = [];

  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0 && colonIndex < 30) {
      const possibleLabel = line.slice(0, colonIndex).trim().toLowerCase();
      if (SECTION_ICONS[possibleLabel] || possibleLabel.length < 20) {
        sections.push({
          label: line.slice(0, colonIndex).trim(),
          content: line.slice(colonIndex + 1).trim(),
        });
        continue;
      }
    }
    // No label — append to last section or create a generic one
    if (sections.length > 0) {
      const last = sections[sections.length - 1];
      sections[sections.length - 1] = {
        ...last,
        content: last.content + "\n" + line.trim(),
      };
    } else {
      sections.push({ label: "", content: line.trim() });
    }
  }

  return sections;
}

function statusColor(status: WorkoutStatus): string {
  if (status === "completed") return SEMANTIC.success;
  if (status === "in_progress") return SEMANTIC.warning;
  return "#94a3b8";
}

export default function WorkoutsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { orgId, orgSlug, orgName, orgLogoUrl } = useOrg();
  const { user } = useAuth();
  const { isAdmin, isActiveMember } = useOrgRole();
  const { neutral, semantic } = useAppColorScheme();
  const isMountedRef = useRef(true);

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available - no-op
    }
  }, [navigation]);

  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  const toggleExpanded = useCallback((workoutId: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(workoutId)) {
        next.delete(workoutId);
      } else {
        next.add(workoutId);
      }
      return next;
    });
  }, []);

  const fetchWorkouts = useCallback(
    async (isRefresh = false) => {
      if (!orgId) {
        if (isMountedRef.current) {
          setWorkouts([]);
          setLogs([]);
          setLoading(false);
          setRefreshing(false);
        }
        return;
      }

      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const workoutsQuery = supabase
          .from("workouts")
          .select("*")
          .eq("organization_id", orgId)
          .order("workout_date", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false });

        const logsQuery = user?.id
          ? supabase
              .from("workout_logs")
              .select("*")
              .eq("organization_id", orgId)
              .eq("user_id", user.id)
          : Promise.resolve({ data: [] as WorkoutLog[], error: null });

        const [{ data: workoutsData, error: workoutsError }, { data: logsData, error: logsError }] =
          await Promise.all([workoutsQuery, logsQuery]);

        if (workoutsError) throw workoutsError;
        if (logsError) throw logsError;

        if (isMountedRef.current) {
          setWorkouts((workoutsData || []) as Workout[]);
          setLogs((logsData || []) as WorkoutLog[]);
          setError(null);
        }
      } catch (fetchError) {
        if (isMountedRef.current) {
          setError((fetchError as Error).message || "Failed to load workouts.");
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [orgId, user?.id]
  );

  useEffect(() => {
    isMountedRef.current = true;
    fetchWorkouts();
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchWorkouts]);

  useEffect(() => {
    if (!orgId) return;
    const workoutsChannel = createPostgresChangesChannel(`workouts:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workouts",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchWorkouts();
        }
      )
      .subscribe();

    const logsChannel = createPostgresChangesChannel(`workout_logs:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workout_logs",
          filter: `organization_id=eq.${orgId}`,
        },
        (payload) => {
          if (!user?.id) return;
          const record = (payload.new || payload.old) as WorkoutLog | null;
          if (record?.user_id !== user.id) return;
          fetchWorkouts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(workoutsChannel);
      supabase.removeChannel(logsChannel);
    };
  }, [orgId, user?.id, fetchWorkouts]);

  const handleRefresh = useCallback(() => fetchWorkouts(true), [fetchWorkouts]);

  const logByWorkout = useMemo(() => {
    const map = new Map<string, WorkoutLog>();
    logs.forEach((log) => map.set(log.workout_id, log));
    return map;
  }, [logs]);

  const handleLogSaved = useCallback((nextLog: WorkoutLog) => {
    setLogs((prev) => {
      const index = prev.findIndex((log) => log.id === nextLog.id);
      if (index >= 0) {
        const clone = [...prev];
        clone[index] = nextLog;
        return clone;
      }
      return [nextLog, ...prev];
    });
  }, []);

  const handleCreateWorkout = useCallback(() => {
    router.push(`/(app)/${orgSlug}/workouts/new`);
  }, [router, orgSlug]);

  const handleEditWorkout = useCallback(
    (workoutId: string) => {
      router.push(`/(app)/${orgSlug}/workouts/${workoutId}/edit`);
    },
    [router, orgSlug]
  );

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
    headerAction: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
      paddingVertical: SPACING.xs + 2,
      paddingHorizontal: SPACING.sm + 4,
      borderRadius: RADIUS.md,
      backgroundColor: SEMANTIC.success,
      borderCurve: "continuous" as const,
    },
    headerActionPressed: {
      opacity: 0.9,
    },
    headerActionText: {
      ...TYPOGRAPHY.labelMedium,
      color: "#ffffff",
    },
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
    },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: 96,
      gap: SPACING.md,
    },
    // Error state
    errorCard: {
      backgroundColor: `${s.error}14`,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
      gap: SPACING.sm,
      borderWidth: 1,
      borderColor: `${s.error}55`,
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
    retryButtonPressed: {
      opacity: 0.85,
    },
    retryButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: "#ffffff",
    },
    // Loading
    loadingState: {
      alignItems: "center" as const,
      gap: SPACING.sm,
      paddingTop: SPACING.xxl,
    },
    loadingText: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
    },
    // Empty state
    emptyCard: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.lg,
      gap: SPACING.md,
      alignItems: "center" as const,
    },
    emptyIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: `${SEMANTIC.success}14`,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      marginBottom: SPACING.xs,
    },
    emptyTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: n.foreground,
      textAlign: "center" as const,
    },
    emptySubtitle: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
      textAlign: "center" as const,
    },
    // Workout card
    card: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: n.border,
      overflow: "hidden" as const,
      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    },
    cardHeader: {
      flexDirection: "row" as const,
      alignItems: "flex-start" as const,
      justifyContent: "space-between" as const,
      padding: SPACING.md,
      gap: SPACING.sm,
    },
    cardHeaderLeft: {
      flex: 1,
      gap: SPACING.xs,
    },
    cardTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: n.foreground,
    },
    cardMeta: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
    },
    cardMetaText: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
    },
    cardActions: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
    },
    statusBadge: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xxs + 1,
      borderRadius: RADIUS.full,
    },
    statusBadgeText: {
      ...TYPOGRAPHY.labelSmall,
    },
    editButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xxs,
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xxs + 1,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
    },
    editButtonPressed: {
      opacity: 0.8,
    },
    editButtonText: {
      ...TYPOGRAPHY.labelSmall,
      color: SEMANTIC.success,
    },
    // Workout sections
    sectionsContainer: {
      paddingHorizontal: SPACING.md,
      paddingBottom: SPACING.md,
      gap: SPACING.sm,
    },
    section: {
      backgroundColor: n.background,
      borderRadius: RADIUS.md,
      borderCurve: "continuous" as const,
      padding: SPACING.sm + 2,
      gap: SPACING.xxs,
    },
    sectionLabel: {
      ...TYPOGRAPHY.overline,
      color: SEMANTIC.success,
      marginBottom: SPACING.xxs,
    },
    sectionContent: {
      ...TYPOGRAPHY.bodySmall,
      color: n.foreground,
    },
    plainDescription: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
      paddingHorizontal: SPACING.md,
      paddingBottom: SPACING.md,
    },
    // Expand/collapse
    expandButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      paddingVertical: SPACING.sm,
      borderTopWidth: 1,
      borderTopColor: n.divider,
      gap: SPACING.xxs,
    },
    expandButtonPressed: {
      opacity: 0.7,
    },
    expandButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.secondary,
    },
    // External link
    linkButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xxs,
      paddingHorizontal: SPACING.md,
      paddingBottom: SPACING.sm,
    },
    linkButtonPressed: {
      opacity: 0.7,
    },
    linkText: {
      ...TYPOGRAPHY.labelMedium,
      color: SEMANTIC.success,
    },
    // Read only
    readOnlyText: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
      paddingHorizontal: SPACING.md,
      paddingBottom: SPACING.md,
    },
    // Log editor
    logEditor: {
      paddingHorizontal: SPACING.md,
      paddingBottom: SPACING.md,
      gap: SPACING.sm,
      borderTopWidth: 1,
      borderTopColor: n.divider,
      paddingTop: SPACING.sm,
    },
    fieldGroup: {
      gap: SPACING.xs,
    },
    fieldLabel: {
      ...TYPOGRAPHY.labelMedium,
      color: n.secondary,
    },
    statusRow: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: SPACING.sm,
    },
    statusChip: {
      paddingHorizontal: SPACING.sm + 2,
      paddingVertical: SPACING.xs + 1,
      borderRadius: RADIUS.full,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    statusChipPressed: {
      opacity: 0.85,
    },
    statusChipText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
    },
    input: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      backgroundColor: n.background,
    },
    textArea: {
      minHeight: 80,
    },
    primaryButton: {
      backgroundColor: SEMANTIC.success,
      borderRadius: RADIUS.md,
      borderCurve: "continuous" as const,
      paddingVertical: SPACING.sm,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    primaryButtonPressed: {
      opacity: 0.9,
    },
    primaryButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: "#ffffff",
    },
    buttonDisabled: {
      opacity: 0.6,
    },
  }));

  const renderStatusBadge = (status: WorkoutStatus) => {
    const label = STATUS_OPTIONS.find((o) => o.value === status)?.label || status;
    const color = statusColor(status);
    return (
      <View style={[styles.statusBadge, { backgroundColor: `${color}18` }]}>
        <Text style={[styles.statusBadgeText, { color }]}>{label}</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {orgLogoUrl ? (
                <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0]}</Text>
                </View>
              )}
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Workouts</Text>
              <Text style={styles.headerMeta}>
                {workouts.length} {workouts.length === 1 ? "workout" : "workouts"}
              </Text>
            </View>
            {isAdmin ? (
              <Pressable
                onPress={handleCreateWorkout}
                style={({ pressed }) => [
                  styles.headerAction,
                  pressed && styles.headerActionPressed,
                ]}
              >
                <Plus size={16} color="#ffffff" />
                <Text style={styles.headerActionText}>Post</Text>
              </Pressable>
            ) : null}
          </View>
        </SafeAreaView>
      </LinearGradient>

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
          {error ? (
            <View style={styles.errorCard}>
              <Text selectable style={styles.errorText}>{error}</Text>
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

          {loading && workouts.length === 0 ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color={SEMANTIC.success} />
              <Text style={styles.loadingText}>Loading workouts...</Text>
            </View>
          ) : workouts.length === 0 ? (
            <Animated.View entering={FadeIn.duration(300)} style={styles.emptyCard}>
              <View style={styles.emptyIcon}>
                <Dumbbell size={28} color={SEMANTIC.success} />
              </View>
              <Text style={styles.emptyTitle}>No workouts yet</Text>
              <Text style={styles.emptySubtitle}>
                Workouts will appear here once posted.
              </Text>
              {isAdmin ? (
                <Pressable
                  onPress={handleCreateWorkout}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    { alignSelf: "center" as const, paddingHorizontal: SPACING.lg },
                    pressed && styles.primaryButtonPressed,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>Post first workout</Text>
                </Pressable>
              ) : null}
            </Animated.View>
          ) : (
            workouts.map((workout, index) => {
              const log = logByWorkout.get(workout.id);
              const isExpanded = expandedCards.has(workout.id);
              const sections = workout.description
                ? parseWorkoutDescription(workout.description)
                : [];
              const hasSections = sections.length > 0;
              const previewSections = sections.slice(0, 2);
              const remainingSections = sections.slice(2);
              const hasMore = remainingSections.length > 0;

              return (
                <Animated.View
                  key={workout.id}
                  entering={FadeInDown.delay(index * 60).duration(300)}
                  style={styles.card}
                >
                  {/* Card header */}
                  <View style={styles.cardHeader}>
                    <View style={styles.cardHeaderLeft}>
                      <Text style={styles.cardTitle}>{workout.title}</Text>
                      {workout.workout_date ? (
                        <View style={styles.cardMeta}>
                          <Calendar size={13} color={neutral.muted} />
                          <Text style={styles.cardMetaText}>
                            {formatLocalDateString(workout.workout_date)}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.cardActions}>
                      {log ? renderStatusBadge(log.status as WorkoutStatus) : null}
                      {isAdmin ? (
                        <Pressable
                          onPress={() => handleEditWorkout(workout.id)}
                          style={({ pressed }) => [
                            styles.editButton,
                            pressed && styles.editButtonPressed,
                          ]}
                        >
                          <Pencil size={12} color={SEMANTIC.success} />
                          <Text style={styles.editButtonText}>Edit</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>

                  {/* Workout content — parsed sections */}
                  {hasSections ? (
                    <View style={styles.sectionsContainer}>
                      {previewSections.map((section, i) => (
                        <View key={i} style={styles.section}>
                          {section.label ? (
                            <Text style={styles.sectionLabel}>{section.label}</Text>
                          ) : null}
                          <Text selectable style={styles.sectionContent}>
                            {section.content}
                          </Text>
                        </View>
                      ))}
                      {isExpanded
                        ? remainingSections.map((section, i) => (
                            <Animated.View
                              key={`exp-${i}`}
                              entering={FadeIn.duration(200)}
                              style={styles.section}
                            >
                              {section.label ? (
                                <Text style={styles.sectionLabel}>{section.label}</Text>
                              ) : null}
                              <Text selectable style={styles.sectionContent}>
                                {section.content}
                              </Text>
                            </Animated.View>
                          ))
                        : null}
                    </View>
                  ) : workout.description ? (
                    <Text selectable style={styles.plainDescription}>
                      {workout.description}
                    </Text>
                  ) : null}

                  {/* Expand/collapse toggle */}
                  {hasMore ? (
                    <Pressable
                      onPress={() => toggleExpanded(workout.id)}
                      style={({ pressed }) => [
                        styles.expandButton,
                        pressed && styles.expandButtonPressed,
                      ]}
                    >
                      <Text style={styles.expandButtonText}>
                        {isExpanded
                          ? "Show less"
                          : `${remainingSections.length} more section${remainingSections.length > 1 ? "s" : ""}`}
                      </Text>
                      <ChevronRight
                        size={14}
                        color={neutral.secondary}
                        style={{
                          transform: [{ rotate: isExpanded ? "-90deg" : "90deg" }],
                        }}
                      />
                    </Pressable>
                  ) : null}

                  {/* External URL */}
                  {workout.external_url ? (
                    <Pressable
                      onPress={() => {
                        void openHttpsUrl(workout.external_url || "");
                      }}
                      style={({ pressed }) => [
                        styles.linkButton,
                        pressed && styles.linkButtonPressed,
                      ]}
                    >
                      <ExternalLink size={14} color={SEMANTIC.success} />
                      <Text style={styles.linkText}>Open external workout</Text>
                    </Pressable>
                  ) : null}

                  {/* Log editor or read-only */}
                  {isActiveMember ? (
                    <WorkoutLogEditor
                      orgId={orgId || ""}
                      workoutId={workout.id}
                      log={log}
                      onSaved={handleLogSaved}
                      styles={styles}
                      neutral={neutral}
                    />
                  ) : (
                    <Text style={styles.readOnlyText}>
                      {isAdmin
                        ? "Admins can post workouts and view member progress."
                        : "View-only access for alumni."}
                    </Text>
                  )}
                </Animated.View>
              );
            })
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function WorkoutLogEditor({
  orgId,
  workoutId,
  log,
  onSaved,
  styles,
  neutral,
}: {
  orgId: string;
  workoutId: string;
  log?: WorkoutLog;
  onSaved: (nextLog: WorkoutLog) => void;
  styles: ReturnType<typeof useThemedStyles<any>>;
  neutral: { muted: string; [key: string]: string };
}) {
  const { user } = useAuth();
  const [status, setStatus] = useState<WorkoutStatus>(
    (log?.status as WorkoutStatus) || "not_started"
  );
  const [notes, setNotes] = useState(log?.notes || "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStatus((log?.status as WorkoutStatus) || "not_started");
    setNotes(log?.notes || "");
  }, [log?.id, log?.notes, log?.status]);

  const handleSave = async () => {
    if (!user) {
      setError("You must be signed in to update progress.");
      return;
    }

    setIsSaving(true);
    setError(null);

    const payload = {
      organization_id: orgId,
      workout_id: workoutId,
      user_id: user.id,
      status,
      notes: notes.trim() || null,
    };

    const { data, error: upsertError } = log?.id
      ? await supabase
          .from("workout_logs")
          .update(payload)
          .eq("id", log.id)
          .select()
          .maybeSingle()
      : await supabase.from("workout_logs").insert(payload).select().maybeSingle();

    if (upsertError) {
      setError(upsertError.message);
      setIsSaving(false);
      return;
    }

    if (data) {
      onSaved(data as WorkoutLog);
    }
    setIsSaving(false);
  };

  return (
    <View style={styles.logEditor}>
      {error ? (
        <Text selectable style={styles.errorText}>
          {error}
        </Text>
      ) : null}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Your status</Text>
        <View style={styles.statusRow}>
          {STATUS_OPTIONS.map((option) => {
            const isSelected = status === option.value;
            const color = statusColor(option.value);
            return (
              <Pressable
                key={option.value}
                onPress={() => setStatus(option.value)}
                style={({ pressed }) => [
                  styles.statusChip,
                  isSelected && {
                    backgroundColor: `${color}18`,
                    borderColor: color,
                  },
                  pressed && styles.statusChipPressed,
                ]}
              >
                <Text
                  style={[
                    styles.statusChipText,
                    isSelected && { color },
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Notes (optional)</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Add time, reps, or other details"
          placeholderTextColor={neutral.muted}
          multiline
          textAlignVertical="top"
          style={[styles.input, styles.textArea]}
        />
      </View>
      <Pressable
        onPress={handleSave}
        disabled={isSaving}
        style={({ pressed }) => [
          styles.primaryButton,
          pressed && styles.primaryButtonPressed,
          isSaving && styles.buttonDisabled,
        ]}
      >
        {isSaving ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.primaryButtonText}>Save progress</Text>
        )}
      </Pressable>
    </View>
  );
}
