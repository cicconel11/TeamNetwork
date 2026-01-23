import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useRouter, useNavigation } from "expo-router";
import { Calendar, ExternalLink, Pencil, Plus } from "lucide-react-native";
import { useAuth } from "@/hooks/useAuth";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { supabase } from "@/lib/supabase";
import { APP_CHROME } from "@/lib/chrome";
import { borderRadius, fontSize, fontWeight, spacing } from "@/lib/theme";
import type { Workout, WorkoutLog, WorkoutStatus } from "@teammeet/types";

// Fixed color palette
const WORKOUTS_COLORS = {
  background: "#f8fafc",
  primaryText: "#0f172a",
  secondaryText: "#64748b",
  mutedText: "#94a3b8",
  border: "#e2e8f0",
  card: "#ffffff",
  primary: "#059669",
  primaryForeground: "#ffffff",
  error: "#ef4444",
  success: "#22c55e",
  warning: "#f59e0b",
};

const STATUS_OPTIONS: Array<{ value: WorkoutStatus; label: string }> = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
];

export default function WorkoutsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { orgId, orgSlug, orgName, orgLogoUrl } = useOrg();
  const { user } = useAuth();
  const { isAdmin, isActiveMember } = useOrgRole();
  const styles = useMemo(() => createStyles(), []);
  const isMountedRef = useRef(true);

  // Safe drawer toggle - only dispatch if drawer is available
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
          : Promise.resolve({ data: [] as WorkoutLog[] });

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
    const workoutsChannel = supabase
      .channel(`workouts:${orgId}`)
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

    const logsChannel = supabase
      .channel(`workout_logs:${orgId}`)
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

  const renderStatusBadge = (status: WorkoutStatus) => {
    const label = STATUS_OPTIONS.find((option) => option.value === status)?.label || status;
    const statusColor =
      status === "completed"
        ? WORKOUTS_COLORS.success
        : status === "in_progress"
          ? WORKOUTS_COLORS.warning
          : WORKOUTS_COLORS.mutedText;

    return (
      <View style={[styles.statusBadge, { backgroundColor: `${statusColor}22` }]}>
        <Text style={[styles.statusBadgeText, { color: statusColor }]}>{label}</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Custom Gradient Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {orgLogoUrl ? (
                <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
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
                <Plus size={18} color={WORKOUTS_COLORS.primaryForeground} />
                <Text style={styles.headerActionText}>Post</Text>
              </Pressable>
            ) : null}
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
              tintColor={WORKOUTS_COLORS.primary}
            />
          }
        >

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

          {loading && workouts.length === 0 ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color={WORKOUTS_COLORS.primary} />
              <Text style={styles.loadingText}>Loading workouts...</Text>
            </View>
          ) : workouts.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.emptyTitle}>No workouts yet</Text>
              <Text style={styles.emptySubtitle}>Workouts will appear here once posted.</Text>
              {isAdmin ? (
                <Pressable
                  onPress={handleCreateWorkout}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && styles.primaryButtonPressed,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>Post first workout</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View style={styles.list}>
              {workouts.map((workout) => {
                const log = logByWorkout.get(workout.id);
                return (
                  <View key={workout.id} style={styles.card}>
                    <View style={styles.cardHeader}>
                      <View style={styles.cardHeaderText}>
                        <Text style={styles.cardTitle}>{workout.title}</Text>
                        {workout.description ? (
                          <Text style={styles.cardDescription}>{workout.description}</Text>
                        ) : null}
                        <View style={styles.metaRow}>
                          {workout.workout_date ? (
                            <View style={styles.metaItem}>
                              <Calendar size={14} color={WORKOUTS_COLORS.mutedText} />
                              <Text style={styles.metaText}>
                                {formatDateLabel(workout.workout_date)}
                              </Text>
                            </View>
                          ) : null}
                          {workout.external_url ? (
                            <Pressable
                              onPress={() => Linking.openURL(workout.external_url || "")}
                              style={({ pressed }) => [
                                styles.linkButton,
                                pressed && styles.linkButtonPressed,
                              ]}
                            >
                              <ExternalLink size={14} color={WORKOUTS_COLORS.primary} />
                              <Text style={styles.linkText}>External workout</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                      <View style={styles.cardHeaderActions}>
                        {log ? renderStatusBadge(log.status as WorkoutStatus) : null}
                        {isAdmin ? (
                          <Pressable
                            onPress={() => handleEditWorkout(workout.id)}
                            style={({ pressed }) => [
                              styles.editButton,
                              pressed && styles.editButtonPressed,
                            ]}
                          >
                            <Pencil size={14} color={WORKOUTS_COLORS.primary} />
                            <Text style={styles.editButtonText}>Edit</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>

                    {isActiveMember ? (
                      <WorkoutLogEditor
                        orgId={orgId || ""}
                        workoutId={workout.id}
                        log={log}
                        onSaved={handleLogSaved}
                        styles={styles}
                      />
                    ) : (
                      <Text style={styles.readOnlyText}>
                        {isAdmin
                          ? "Admins can post workouts and view member progress."
                          : "View-only access for alumni."}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
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
}: {
  orgId: string;
  workoutId: string;
  log?: WorkoutLog;
  onSaved: (nextLog: WorkoutLog) => void;
  styles: ReturnType<typeof createStyles>;
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
            return (
              <Pressable
                key={option.value}
                onPress={() => setStatus(option.value)}
                style={({ pressed }) => [
                  styles.statusChip,
                  isSelected && { backgroundColor: WORKOUTS_COLORS.primary, borderColor: WORKOUTS_COLORS.primary },
                  pressed && styles.statusChipPressed,
                ]}
              >
                <Text
                  style={[
                    styles.statusChipText,
                    isSelected && { color: WORKOUTS_COLORS.primaryForeground },
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
          placeholderTextColor={WORKOUTS_COLORS.mutedText}
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
          <ActivityIndicator color={WORKOUTS_COLORS.primaryForeground} />
        ) : (
          <Text style={styles.primaryButtonText}>Save progress</Text>
        )}
      </Pressable>
    </View>
  );
}

function formatDateLabel(value: string) {
  const datePart = value.split("T")[0];
  const [year, month, day] = datePart.split("-").map(Number);
  if (!year || !month || !day) return value;
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString();
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: WORKOUTS_COLORS.background,
    },
    // Gradient header styles
    headerGradient: {
      paddingBottom: spacing.md,
    },
    headerSafeArea: {
      // SafeAreaView handles top inset
    },
    headerContent: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      minHeight: 40,
      gap: spacing.sm,
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
      alignItems: "center",
      justifyContent: "center",
    },
    orgAvatarText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.bold,
      color: APP_CHROME.avatarText,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: APP_CHROME.headerTitle,
    },
    headerMeta: {
      fontSize: fontSize.xs,
      color: APP_CHROME.headerMeta,
      marginTop: 2,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: WORKOUTS_COLORS.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      marginTop: -16,
      overflow: "hidden",
    },
    scrollContent: {
      padding: spacing.md,
      paddingBottom: spacing.xl,
      gap: spacing.lg,
    },
    headerAction: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingVertical: spacing.xs + 2,
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.md,
      backgroundColor: WORKOUTS_COLORS.primary,
      borderCurve: "continuous",
    },
    headerActionPressed: {
      opacity: 0.9,
    },
    headerActionText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: WORKOUTS_COLORS.primaryForeground,
    },
    errorCard: {
      backgroundColor: `${WORKOUTS_COLORS.error}14`,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      gap: spacing.sm,
      borderWidth: 1,
      borderColor: `${WORKOUTS_COLORS.error}55`,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: WORKOUTS_COLORS.error,
    },
    retryButton: {
      alignSelf: "flex-start",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      borderRadius: borderRadius.md,
      backgroundColor: WORKOUTS_COLORS.error,
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
      color: WORKOUTS_COLORS.mutedText,
    },
    list: {
      gap: spacing.md,
    },
    card: {
      backgroundColor: WORKOUTS_COLORS.card,
      borderRadius: borderRadius.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: WORKOUTS_COLORS.border,
      padding: spacing.md,
      gap: spacing.md,
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)",
    },
    cardHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    cardHeaderText: {
      flex: 1,
      gap: spacing.xs,
    },
    cardHeaderActions: {
      alignItems: "flex-end",
      gap: spacing.xs,
    },
    cardTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: WORKOUTS_COLORS.primaryText,
    },
    cardDescription: {
      fontSize: fontSize.sm,
      color: WORKOUTS_COLORS.secondaryText,
    },
    metaRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    metaItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    metaText: {
      fontSize: fontSize.sm,
      color: WORKOUTS_COLORS.secondaryText,
    },
    linkButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    linkButtonPressed: {
      opacity: 0.7,
    },
    linkText: {
      fontSize: fontSize.sm,
      color: WORKOUTS_COLORS.primary,
      fontWeight: fontWeight.medium,
    },
    statusBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: 999,
    },
    statusBadgeText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
    },
    editButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: WORKOUTS_COLORS.border,
    },
    editButtonPressed: {
      opacity: 0.8,
    },
    editButtonText: {
      fontSize: fontSize.xs,
      color: WORKOUTS_COLORS.primary,
      fontWeight: fontWeight.semibold,
    },
    readOnlyText: {
      fontSize: fontSize.sm,
      color: WORKOUTS_COLORS.secondaryText,
    },
    emptyTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: WORKOUTS_COLORS.primaryText,
    },
    emptySubtitle: {
      fontSize: fontSize.sm,
      color: WORKOUTS_COLORS.secondaryText,
    },
    logEditor: {
      gap: spacing.sm,
    },
    fieldGroup: {
      gap: spacing.xs,
    },
    fieldLabel: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: WORKOUTS_COLORS.secondaryText,
    },
    statusRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    statusChip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: WORKOUTS_COLORS.border,
      backgroundColor: WORKOUTS_COLORS.card,
    },
    statusChipPressed: {
      opacity: 0.85,
    },
    statusChipText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: WORKOUTS_COLORS.primaryText,
    },
    input: {
      borderWidth: 1,
      borderColor: WORKOUTS_COLORS.border,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: fontSize.base,
      color: WORKOUTS_COLORS.primaryText,
      backgroundColor: WORKOUTS_COLORS.background,
    },
    textArea: {
      minHeight: 90,
    },
    primaryButton: {
      backgroundColor: WORKOUTS_COLORS.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.sm,
      alignItems: "center",
      justifyContent: "center",
      borderCurve: "continuous",
    },
    primaryButtonPressed: {
      opacity: 0.9,
    },
    primaryButtonText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: WORKOUTS_COLORS.primaryForeground,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
  });
