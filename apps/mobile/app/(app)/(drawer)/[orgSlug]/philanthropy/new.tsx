import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronLeft } from "lucide-react-native";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { supabase } from "@/lib/supabase";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { formatDatePickerLabel, formatTimePickerLabel } from "@/lib/date-format";
import { APP_CHROME } from "@/lib/chrome";

type PickerTarget = "start-date" | "start-time" | "end-date" | "end-time";

function mergeDateAndTime(date: Date, time: Date) {
  const value = new Date(date);
  value.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return value;
}

function formatDateLabel(value: Date | null) {
  return formatDatePickerLabel(value, "Select date");
}

function formatTimeLabel(value: Date | null) {
  return formatTimePickerLabel(value, "Select time");
}

export default function NewPhilanthropyEventScreen() {
  const router = useRouter();
  const { orgId, orgSlug } = useOrg();
  const { isAdmin, isActiveMember, isLoading: roleLoading } = useOrgRole();
  const { neutral, semantic } = useAppColorScheme();
  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.background,
    },
    headerGradient: {
      paddingBottom: SPACING.xs,
    },
    headerSafeArea: {},
    navHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.xs,
      minHeight: 40,
      gap: SPACING.sm,
    },
    backButton: {
      padding: SPACING.xs,
      marginLeft: -SPACING.xs,
    },
    navTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
      flex: 1,
    },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: SPACING.xl,
      gap: SPACING.lg,
    },
    header: {
      gap: SPACING.xs,
    },
    headerTitle: {
      ...TYPOGRAPHY.headlineLarge,
      color: n.foreground,
    },
    headerSubtitle: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
    },
    errorCard: {
      backgroundColor: s.errorLight,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
      borderWidth: 1,
      borderColor: s.error,
    },
    errorText: {
      ...TYPOGRAPHY.bodySmall,
      color: s.error,
    },
    loadingState: {
      alignItems: "center" as const,
      gap: SPACING.sm,
    },
    loadingText: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
    },
    fieldGroup: {
      gap: SPACING.xs,
    },
    fieldLabel: {
      ...TYPOGRAPHY.labelMedium,
      color: n.secondary,
    },
    input: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      backgroundColor: n.surface,
    },
    textArea: {
      minHeight: 140,
    },
    inlineRow: {
      flexDirection: "row" as const,
      gap: SPACING.sm,
    },
    selectField: {
      flex: 1,
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      backgroundColor: n.surface,
    },
    selectFieldPressed: {
      opacity: 0.9,
    },
    selectFieldText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
    },
    pickerContainer: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      overflow: "hidden" as const,
      backgroundColor: n.surface,
    },
    ghostButton: {
      alignItems: "center" as const,
      paddingVertical: SPACING.sm,
      borderTopWidth: 1,
      borderTopColor: n.border,
    },
    ghostButtonPressed: {
      opacity: 0.85,
    },
    ghostButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: s.success,
    },
    primaryButton: {
      backgroundColor: s.success,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.md,
      alignItems: "center" as const,
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
  const handleBack = () => {
    router.replace(`/(app)/${orgSlug}/philanthropy`);
  };

  const renderHeader = () => (
    <LinearGradient
      colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
      style={styles.headerGradient}
    >
      <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
        <View style={styles.navHeader}>
          <Pressable
            onPress={handleBack}
            style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="Back to community"
          >
            <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
          </Pressable>
          <Text style={styles.navTitle} numberOfLines={1}>
            New Community Event
          </Text>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );

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
      <View style={styles.container}>
        <Stack.Screen options={{ title: "New Community Event" }} />
        {renderHeader()}
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.loadingState}>
            <ActivityIndicator color={semantic.success} />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (!canEdit) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: "New Community Event" }} />
        {renderHeader()}
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.errorCard}>
            <Text selectable style={styles.errorText}>
              You do not have access to add community events.
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: "New Community Event" }} />
      {renderHeader()}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>New Community Event</Text>
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
          placeholder="e.g., Community 5K Run, Food Bank Volunteering"
          placeholderTextColor={neutral.placeholder}
          style={styles.input}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Description</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Describe the community event, what volunteers will be doing, any requirements..."
          placeholderTextColor={neutral.placeholder}
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
          placeholderTextColor={neutral.placeholder}
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
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.primaryButtonText}>Create event</Text>
        )}
      </Pressable>
      </ScrollView>
    </View>
  );
}
