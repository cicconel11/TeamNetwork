import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  Platform,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Stack, useRouter } from "expo-router";
import { useOrg } from "@/contexts/OrgContext";
import { useAuth } from "@/hooks/useAuth";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import { supabase } from "@/lib/supabase";
import { fetchWithAuth } from "@/lib/web-api";
import { borderRadius, fontSize, fontWeight, spacing, type ThemeColors } from "@/lib/theme";
import { formatDefaultDate } from "@/lib/date-format";

type Audience = "members" | "alumni" | "both" | "specific";
type Channel = "email" | "sms" | "both";
type TargetUser = { id: string; label: string };

const AUDIENCE_OPTIONS: Array<{ value: Audience; label: string }> = [
  { value: "both", label: "Members + Alumni" },
  { value: "members", label: "Members only" },
  { value: "alumni", label: "Alumni only" },
  { value: "specific", label: "Specific individuals" },
];

const CHANNEL_OPTIONS: Array<{ value: Channel; label: string }> = [
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "both", label: "Email + SMS" },
];

export default function NewWorkoutScreen() {
  const router = useRouter();
  const { orgId, orgSlug } = useOrg();
  const { user } = useAuth();
  const { isAdmin, isLoading: roleLoading } = useOrgRole();
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [workoutDate, setWorkoutDate] = useState<Date | null>(null);
  const [externalUrl, setExternalUrl] = useState("");
  const [audience, setAudience] = useState<Audience>("both");
  const [channel, setChannel] = useState<Channel>("email");
  const [sendNotification, setSendNotification] = useState(true);
  const [targetUserIds, setTargetUserIds] = useState<string[]>([]);
  const [userOptions, setUserOptions] = useState<TargetUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadUsers = async () => {
      if (!orgId) return;
      setLoadingUsers(true);
      try {
        const { data, error: fetchError } = await supabase
          .from("user_organization_roles")
          .select("user_id, users(name,email)")
          .eq("organization_id", orgId)
          .eq("status", "active");

        if (fetchError) throw fetchError;

        const options =
          data?.map((row) => {
            const userInfo = Array.isArray(row.users) ? row.users[0] : row.users;
            return {
              id: row.user_id,
              label: userInfo?.name || userInfo?.email || "User",
            };
          }) || [];

        if (isMounted) {
          setUserOptions(options);
        }
      } catch (fetchError) {
        if (isMounted) {
          setError((fetchError as Error).message || "Failed to load recipients.");
        }
      } finally {
        if (isMounted) {
          setLoadingUsers(false);
        }
      }
    };

    loadUsers();
    return () => {
      isMounted = false;
    };
  }, [orgId]);

  const toggleTargetUser = useCallback((id: string) => {
    setTargetUserIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }, []);

  const handleSubmit = async () => {
    if (!orgId || !orgSlug) {
      setError("Organization not loaded yet.");
      return;
    }
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (audience === "specific" && targetUserIds.length === 0) {
      setError("Select at least one recipient.");
      return;
    }

    const trimmedExternal = externalUrl.trim();
    if (trimmedExternal && !isValidHttpsUrl(trimmedExternal)) {
      setError("Please provide a valid https:// URL.");
      return;
    }

    setIsSaving(true);
    setError(null);

    const payload = {
      organization_id: orgId,
      title: title.trim(),
      description: description.trim() || null,
      workout_date: workoutDate ? formatLocalDate(workoutDate) : null,
      external_url: trimmedExternal || null,
      created_by: user?.id || null,
    };

    const { data: workout, error: insertError } = await supabase
      .from("workouts")
      .insert(payload)
      .select()
      .maybeSingle();

    if (insertError) {
      setError(insertError.message);
      setIsSaving(false);
      return;
    }

    if (sendNotification && workout) {
      const audienceValue = audience === "specific" ? "both" : audience;
      const targetIds = audience === "specific" ? targetUserIds : null;
      const workoutDateLine = workoutDate ? `Workout date: ${formatLocalDate(workoutDate)}` : "";
      const notificationBody = [description.trim(), workoutDateLine, trimmedExternal ? `Link: ${trimmedExternal}` : ""]
        .filter(Boolean)
        .join("\n\n");

      try {
        const response = await fetchWithAuth("/api/notifications/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: orgId,
            title: `New Workout: ${title.trim()}`,
            body: notificationBody || `Workout posted for ${workoutDate ? formatLocalDate(workoutDate) : "the team"}`,
            channel,
            audience: audienceValue,
            targetUserIds: targetIds || undefined,
          }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          console.warn("Failed to send workout notification:", payload?.error || response.status);
        }
      } catch (notifError) {
        console.warn("Failed to send workout notification:", notifError);
      }
    }

    setIsSaving(false);
    router.push(`/(app)/${orgSlug}/workouts`);
  };

  if (roleLoading) {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
      >
        <Stack.Screen options={{ title: "Post Workout" }} />
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </ScrollView>
    );
  }

  if (!isAdmin) {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
      >
        <Stack.Screen options={{ title: "Post Workout" }} />
        <View style={styles.errorCard}>
          <Text selectable style={styles.errorText}>
            You do not have access to post workouts.
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: "Post Workout" }} />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Post Workout</Text>
        <Text style={styles.headerSubtitle}>Create a new workout for the team</Text>
      </View>

      {error ? (
        <View style={styles.errorCard}>
          <Text selectable style={styles.errorText}>
            {error}
          </Text>
        </View>
      ) : null}

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Title</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Workout title"
          placeholderTextColor={colors.mutedForeground}
          style={styles.input}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Description</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Add workout details"
          placeholderTextColor={colors.mutedForeground}
          multiline
          textAlignVertical="top"
          style={[styles.input, styles.textArea]}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Date</Text>
        <Pressable
          onPress={() => setShowDatePicker(true)}
          style={({ pressed }) => [
            styles.selectField,
            pressed && styles.selectFieldPressed,
          ]}
        >
          <Text style={styles.selectFieldText}>
            {workoutDate ? formatDateLabel(workoutDate) : "Select date"}
          </Text>
        </Pressable>
        {showDatePicker ? (
          <View style={styles.pickerContainer}>
            <DateTimePicker
              value={workoutDate ?? new Date()}
              mode="date"
              display={Platform.OS === "ios" ? "inline" : "default"}
              onChange={(_event, selected) => {
                if (selected) {
                  setWorkoutDate(selected);
                }
                if (Platform.OS !== "ios") {
                  setShowDatePicker(false);
                }
              }}
            />
            {Platform.OS === "ios" ? (
              <Pressable
                onPress={() => setShowDatePicker(false)}
                style={({ pressed }) => [
                  styles.ghostButton,
                  pressed && styles.ghostButtonPressed,
                ]}
              >
                <Text style={styles.ghostButtonText}>Done</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>External workout link (optional)</Text>
        <TextInput
          value={externalUrl}
          onChangeText={setExternalUrl}
          placeholder="https://example.com/workout"
          placeholderTextColor={colors.mutedForeground}
          style={styles.input}
          autoCapitalize="none"
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Audience</Text>
        <View style={styles.chipRow}>
          {AUDIENCE_OPTIONS.map((option) => {
            const isSelected = audience === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => setAudience(option.value)}
                style={({ pressed }) => [
                  styles.chip,
                  isSelected && { backgroundColor: colors.primary, borderColor: colors.primary },
                  pressed && styles.chipPressed,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    isSelected && { color: colors.primaryForeground },
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {audience === "specific" ? (
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Select recipients</Text>
          {loadingUsers ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <View style={styles.recipientList}>
              {userOptions.length === 0 ? (
                <Text style={styles.emptyText}>No users available.</Text>
              ) : (
                userOptions.map((userOption) => {
                  const selected = targetUserIds.includes(userOption.id);
                  return (
                    <Pressable
                      key={userOption.id}
                      onPress={() => toggleTargetUser(userOption.id)}
                      style={({ pressed }) => [
                        styles.recipientRow,
                        selected && {
                          borderColor: colors.primary,
                          backgroundColor: colors.primaryLight,
                        },
                        pressed && styles.recipientRowPressed,
                      ]}
                    >
                      <View
                        style={[
                          styles.recipientIndicator,
                          selected && { borderColor: colors.primary, backgroundColor: colors.primary },
                        ]}
                      />
                      <Text style={styles.recipientLabel}>{userOption.label}</Text>
                    </Pressable>
                  );
                })
              )}
            </View>
          )}
        </View>
      ) : null}

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Notification channel</Text>
        <View style={styles.chipRow}>
          {CHANNEL_OPTIONS.map((option) => {
            const isSelected = channel === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => setChannel(option.value)}
                style={({ pressed }) => [
                  styles.chip,
                  isSelected && { backgroundColor: colors.primary, borderColor: colors.primary },
                  pressed && styles.chipPressed,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    isSelected && { color: colors.primaryForeground },
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Send notifications</Text>
        <Switch
          value={sendNotification}
          onValueChange={setSendNotification}
          trackColor={{ false: colors.border, true: colors.primaryLight }}
          thumbColor={sendNotification ? colors.primary : colors.card}
        />
      </View>

      <Pressable
        onPress={handleSubmit}
        disabled={isSaving}
        style={({ pressed }) => [
          styles.primaryButton,
          pressed && styles.primaryButtonPressed,
          isSaving && styles.buttonDisabled,
        ]}
      >
        {isSaving ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text style={styles.primaryButtonText}>Post workout</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

function formatDateLabel(date: Date) {
  return formatDefaultDate(date);
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
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
    errorCard: {
      backgroundColor: `${colors.error}14`,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: `${colors.error}55`,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: colors.error,
    },
    loadingState: {
      alignItems: "center",
      gap: spacing.sm,
    },
    loadingText: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    fieldGroup: {
      gap: spacing.xs,
    },
    fieldLabel: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: fontSize.base,
      color: colors.foreground,
      backgroundColor: colors.background,
    },
    textArea: {
      minHeight: 120,
    },
    selectField: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.background,
    },
    selectFieldPressed: {
      opacity: 0.9,
    },
    selectFieldText: {
      fontSize: fontSize.base,
      color: colors.foreground,
    },
    pickerContainer: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: borderRadius.md,
      overflow: "hidden",
      backgroundColor: colors.card,
    },
    ghostButton: {
      alignItems: "center",
      paddingVertical: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    ghostButtonPressed: {
      opacity: 0.85,
    },
    ghostButtonText: {
      fontSize: fontSize.base,
      color: colors.primary,
      fontWeight: fontWeight.semibold,
    },
    chipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    chipPressed: {
      opacity: 0.85,
    },
    chipText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    recipientList: {
      gap: spacing.sm,
    },
    recipientRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      padding: spacing.sm,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    recipientRowPressed: {
      opacity: 0.85,
    },
    recipientIndicator: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 2,
      borderColor: colors.mutedForeground,
      backgroundColor: "transparent",
    },
    recipientLabel: {
      fontSize: fontSize.base,
      color: colors.foreground,
      flex: 1,
    },
    emptyText: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    toggleLabel: {
      fontSize: fontSize.base,
      color: colors.foreground,
    },
    primaryButton: {
      backgroundColor: colors.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.sm,
      alignItems: "center",
      borderCurve: "continuous",
    },
    primaryButtonPressed: {
      opacity: 0.9,
    },
    primaryButtonText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.primaryForeground,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
  });
