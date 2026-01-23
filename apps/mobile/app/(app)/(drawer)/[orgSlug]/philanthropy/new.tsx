import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Stack, useRouter } from "expo-router";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import { supabase } from "@/lib/supabase";
import { borderRadius, fontSize, fontWeight, spacing, type ThemeColors } from "@/lib/theme";

type PickerTarget = "start-date" | "start-time" | "end-date" | "end-time";

function mergeDateAndTime(date: Date, time: Date) {
  const value = new Date(date);
  value.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return value;
}

function formatDateLabel(value: Date | null) {
  if (!value) return "Select date";
  return value.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimeLabel(value: Date | null) {
  if (!value) return "Select time";
  return value.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function NewPhilanthropyEventScreen() {
  const router = useRouter();
  const { orgId, orgSlug } = useOrg();
  const { isAdmin, isActiveMember, isLoading: roleLoading } = useOrgRole();
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [endTime, setEndTime] = useState<Date | null>(null);
  const [location, setLocation] = useState("");
  const [activePicker, setActivePicker] = useState<PickerTarget | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = isAdmin || isActiveMember;

  const pickerMode = useMemo(() => {
    if (!activePicker) return "date";
    return activePicker.includes("date") ? "date" : "time";
  }, [activePicker]);

  const pickerValue = useMemo(() => {
    switch (activePicker) {
      case "start-date":
        return startDate ?? new Date();
      case "start-time":
        return startTime ?? startDate ?? new Date();
      case "end-date":
        return endDate ?? startDate ?? new Date();
      case "end-time":
        return endTime ?? endDate ?? startDate ?? new Date();
      default:
        return new Date();
    }
  }, [activePicker, startDate, startTime, endDate, endTime]);

  const handlePickerChange = (_event: unknown, selected?: Date) => {
    if (!selected || !activePicker) {
      if (Platform.OS !== "ios") {
        setActivePicker(null);
      }
      return;
    }

    switch (activePicker) {
      case "start-date":
        setStartDate(selected);
        if (!startTime) {
          setStartTime(selected);
        }
        break;
      case "start-time":
        setStartTime(selected);
        if (!startDate) {
          setStartDate(selected);
        }
        break;
      case "end-date":
        setEndDate(selected);
        if (!endTime) {
          setEndTime(selected);
        }
        break;
      case "end-time":
        setEndTime(selected);
        if (!endDate) {
          setEndDate(selected);
        }
        break;
    }

    if (Platform.OS !== "ios") {
      setActivePicker(null);
    }
  };

  const handleSubmit = async () => {
    if (!orgId || !orgSlug) {
      setError("Organization not loaded yet.");
      return;
    }
    if (!title.trim()) {
      setError("Event title is required.");
      return;
    }
    if (!startDate || !startTime) {
      setError("Start date and time are required.");
      return;
    }

    const startDateTime = mergeDateAndTime(startDate, startTime);
    let endDateTime: Date | null = null;

    if (endDate || endTime) {
      if (!endDate || !endTime) {
        setError("End date and time must both be provided.");
        return;
      }
      endDateTime = mergeDateAndTime(endDate, endTime);
      if (endDateTime.getTime() < startDateTime.getTime()) {
        setError("End time must be after the start time.");
        return;
      }
    }

    setIsSaving(true);
    setError(null);

    const { error: insertError } = await supabase.from("events").insert({
      organization_id: orgId,
      title: title.trim(),
      description: description.trim() || null,
      start_date: startDateTime.toISOString(),
      end_date: endDateTime ? endDateTime.toISOString() : null,
      location: location.trim() || null,
      event_type: "philanthropy",
      is_philanthropy: true,
    });

    if (insertError) {
      setError(insertError.message);
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
    router.push(`/(app)/${orgSlug}/philanthropy`);
  };

  if (roleLoading) {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
      >
        <Stack.Screen options={{ title: "New Philanthropy Event" }} />
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </ScrollView>
    );
  }

  if (!canEdit) {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
      >
        <Stack.Screen options={{ title: "New Philanthropy Event" }} />
        <View style={styles.errorCard}>
          <Text selectable style={styles.errorText}>
            You do not have access to add philanthropy events.
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
      <Stack.Screen options={{ title: "New Philanthropy Event" }} />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>New Philanthropy Event</Text>
        <Text style={styles.headerSubtitle}>Add a volunteer or community service event</Text>
      </View>

      {error ? (
        <View style={styles.errorCard}>
          <Text selectable style={styles.errorText}>
            {error}
          </Text>
        </View>
      ) : null}

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Event title</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="e.g., Charity 5K Run, Food Bank Volunteering"
          placeholderTextColor={colors.mutedForeground}
          style={styles.input}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Description</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Describe the philanthropy event, what volunteers will be doing, any requirements..."
          placeholderTextColor={colors.mutedForeground}
          multiline
          textAlignVertical="top"
          style={[styles.input, styles.textArea]}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Start</Text>
        <View style={styles.inlineRow}>
          <Pressable
            onPress={() => setActivePicker("start-date")}
            style={({ pressed }) => [
              styles.selectField,
              pressed && styles.selectFieldPressed,
            ]}
          >
            <Text style={styles.selectFieldText}>{formatDateLabel(startDate)}</Text>
          </Pressable>
          <Pressable
            onPress={() => setActivePicker("start-time")}
            style={({ pressed }) => [
              styles.selectField,
              pressed && styles.selectFieldPressed,
            ]}
          >
            <Text style={styles.selectFieldText}>{formatTimeLabel(startTime)}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>End (optional)</Text>
        <View style={styles.inlineRow}>
          <Pressable
            onPress={() => setActivePicker("end-date")}
            style={({ pressed }) => [
              styles.selectField,
              pressed && styles.selectFieldPressed,
            ]}
          >
            <Text style={styles.selectFieldText}>{formatDateLabel(endDate)}</Text>
          </Pressable>
          <Pressable
            onPress={() => setActivePicker("end-time")}
            style={({ pressed }) => [
              styles.selectField,
              pressed && styles.selectFieldPressed,
            ]}
          >
            <Text style={styles.selectFieldText}>{formatTimeLabel(endTime)}</Text>
          </Pressable>
        </View>
      </View>

      {activePicker ? (
        <View style={styles.pickerContainer}>
          <DateTimePicker
            value={pickerValue}
            mode={pickerMode}
            display={
              Platform.OS === "ios"
                ? pickerMode === "date"
                  ? "inline"
                  : "spinner"
                : "default"
            }
            onChange={handlePickerChange}
          />
          {Platform.OS === "ios" ? (
            <Pressable
              onPress={() => setActivePicker(null)}
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

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Location</Text>
        <TextInput
          value={location}
          onChangeText={setLocation}
          placeholder="e.g., Philadelphia Food Bank, Schuylkill River Trail"
          placeholderTextColor={colors.mutedForeground}
          style={styles.input}
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
          <Text style={styles.primaryButtonText}>Create event</Text>
        )}
      </Pressable>
    </ScrollView>
  );
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
      minHeight: 140,
    },
    inlineRow: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    selectField: {
      flex: 1,
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
