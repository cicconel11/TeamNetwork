import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Platform,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import { supabase } from "@/lib/supabase";
import { borderRadius, fontSize, fontWeight, spacing, type ThemeColors } from "@/lib/theme";
import type { Workout } from "@teammeet/types";

export default function EditWorkoutScreen() {
  const router = useRouter();
  const { workoutId } = useLocalSearchParams<{ workoutId?: string }>();
  const { orgId, orgSlug } = useOrg();
  const { isAdmin, isLoading: roleLoading } = useOrgRole();
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [isFetching, setIsFetching] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [workoutDate, setWorkoutDate] = useState<Date | null>(null);
  const [externalUrl, setExternalUrl] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadWorkout = async () => {
      if (!orgId || !workoutId) {
        if (isMounted) {
          setError("Workout not found.");
          setIsFetching(false);
        }
        return;
      }

      setIsFetching(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("workouts")
        .select("*")
        .eq("id", workoutId)
        .eq("organization_id", orgId)
        .single();

      if (!isMounted) return;

      if (fetchError || !data) {
        setError(fetchError?.message || "Workout not found.");
        setIsFetching(false);
        return;
      }

      const workout = data as Workout;
      setTitle(workout.title || "");
      setDescription(workout.description || "");
      setWorkoutDate(workout.workout_date ? parseLocalDate(workout.workout_date) : null);
      setExternalUrl(workout.external_url || "");
      setIsFetching(false);
    };

    loadWorkout();
    return () => {
      isMounted = false;
    };
  }, [orgId, workoutId]);

  const handleSubmit = async () => {
    if (!orgId || !orgSlug || !workoutId) {
      setError("Workout not found.");
      return;
    }
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    const trimmedExternal = externalUrl.trim();
    if (trimmedExternal && !isValidHttpsUrl(trimmedExternal)) {
      setError("Please provide a valid https:// URL.");
      return;
    }

    setIsSaving(true);
    setError(null);

    const { error: updateError } = await supabase
      .from("workouts")
      .update({
        title: title.trim(),
        description: description.trim() || null,
        workout_date: workoutDate ? formatLocalDate(workoutDate) : null,
        external_url: trimmedExternal || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", workoutId)
      .eq("organization_id", orgId);

    if (updateError) {
      setError(updateError.message);
      setIsSaving(false);
      return;
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
        <Stack.Screen options={{ title: "Edit Workout" }} />
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
        <Stack.Screen options={{ title: "Edit Workout" }} />
        <View style={styles.errorCard}>
          <Text selectable style={styles.errorText}>
            You do not have access to edit workouts.
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
      <Stack.Screen options={{ title: "Edit Workout" }} />
      {isFetching ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>Loading workout...</Text>
        </View>
      ) : (
        <>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Edit workout</Text>
            <Text style={styles.headerSubtitle}>Update workout details</Text>
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
              <Text style={styles.primaryButtonText}>Save changes</Text>
            )}
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

function formatDateLabel(date: Date) {
  return date.toLocaleDateString();
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value: string) {
  const datePart = value.split("T")[0];
  const [year, month, day] = datePart.split("-").map(Number);
  if (!year || !month || !day) return new Date(value);
  return new Date(year, month - 1, day);
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
    loadingState: {
      alignItems: "center",
      gap: spacing.sm,
    },
    loadingText: {
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
