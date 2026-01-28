import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
  StyleSheet,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatDatePickerLabel, formatTimePickerLabel } from "@/lib/date-format";
import type { ThemeColors } from "@/lib/theme";

type Audience = "members" | "alumni" | "both";
type EventType = "general" | "philanthropy" | "game" | "meeting" | "social" | "fundraiser";
type PickerTarget = "start-date" | "start-time" | "end-date" | "end-time";

const AUDIENCE_OPTIONS: { value: Audience; label: string }[] = [
  { value: "both", label: "Members + Alumni" },
  { value: "members", label: "Members" },
  { value: "alumni", label: "Alumni" },
];

const EVENT_TYPE_OPTIONS: { value: EventType; label: string }[] = [
  { value: "general", label: "General" },
  { value: "meeting", label: "Meeting" },
  { value: "game", label: "Game" },
  { value: "social", label: "Social" },
  { value: "fundraiser", label: "Fundraiser" },
  { value: "philanthropy", label: "Philanthropy" },
];

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

export default function EditEventScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const router = useRouter();
  const { orgId, orgSlug } = useOrg();
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [endTime, setEndTime] = useState<Date | null>(null);
  const [location, setLocation] = useState("");
  const [eventType, setEventType] = useState<EventType>("general");
  const [audience, setAudience] = useState<Audience>("both");
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePicker, setActivePicker] = useState<PickerTarget | null>(null);

  // Fetch existing event data
  useEffect(() => {
    async function fetchEvent() {
      if (!eventId || !orgId) return;

      try {
        setLoading(true);
        const { data, error: fetchError } = await supabase
          .from("events")
          .select("*")
          .eq("id", eventId)
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .single();

        if (fetchError) throw fetchError;
        if (!data) throw new Error("Event not found");

        // Populate form with existing data
        setTitle(data.title || "");
        setDescription(data.description || "");
        setLocation(data.location || "");
        setEventType((data.event_type as EventType) || "general");
        setAudience((data.audience as Audience) || "both");

        // Parse dates
        if (data.start_date) {
          const start = new Date(data.start_date);
          setStartDate(start);
          setStartTime(start);
        }
        if (data.end_date) {
          const end = new Date(data.end_date);
          setEndDate(end);
          setEndTime(end);
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }

    fetchEvent();
  }, [eventId, orgId]);

  const pickerMode = activePicker?.includes("date") ? "date" : "time";
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

  const openPicker = (target: PickerTarget) => {
    setActivePicker(target);
  };

  const handlePickerChange = (_event: unknown, selectedDate?: Date) => {
    if (!selectedDate) {
      if (Platform.OS === "android") {
        setActivePicker(null);
      }
      return;
    }

    switch (activePicker) {
      case "start-date":
        setStartDate(selectedDate);
        if (!startTime) setStartTime(selectedDate);
        break;
      case "start-time":
        setStartTime(selectedDate);
        if (!startDate) setStartDate(selectedDate);
        break;
      case "end-date":
        setEndDate(selectedDate);
        if (!endTime) setEndTime(selectedDate);
        break;
      case "end-time":
        setEndTime(selectedDate);
        if (!endDate) setEndDate(selectedDate);
        break;
      default:
        break;
    }

    if (Platform.OS === "android") {
      setActivePicker(null);
    }
  };

  const handleSubmit = useCallback(async () => {
    if (!orgId || !eventId) {
      setError("Organization or event not loaded.");
      return;
    }

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }

    if (!startDate || !startTime) {
      setError("Start date and time are required.");
      return;
    }

    const startDateTimeValue = mergeDateAndTime(startDate, startTime);
    const startDateTime = startDateTimeValue.toISOString();

    let endDateTime: string | null = null;
    if (endDate || endTime) {
      if (!endDate || !endTime) {
        setError("End date and time must both be provided.");
        return;
      }
      const endValue = mergeDateAndTime(endDate, endTime);
      if (endValue.getTime() < startDateTimeValue.getTime()) {
        setError("End time must be after the start time.");
        return;
      }
      endDateTime = endValue.toISOString();
    }

    setIsSaving(true);
    setError(null);

    try {
      const { error: updateError } = await supabase
        .from("events")
        .update({
          title: title.trim(),
          description: description.trim() || null,
          start_date: startDateTime,
          end_date: endDateTime,
          location: location.trim() || null,
          event_type: eventType,
          is_philanthropy: eventType === "philanthropy",
          audience,
          updated_at: new Date().toISOString(),
        })
        .eq("id", eventId)
        .eq("organization_id", orgId);

      if (updateError) throw updateError;

      Alert.alert("Success", "Event updated successfully", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (e) {
      setError((e as Error).message || "Failed to update event.");
    } finally {
      setIsSaving(false);
    }
  }, [orgId, eventId, title, description, startDate, startTime, endDate, endTime, location, eventType, audience, router]);

  const fieldStyle = {
    flex: 1,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    backgroundColor: NEUTRAL.surface,
    justifyContent: "center" as const,
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Title */}
      <View style={styles.field}>
        <Text style={styles.label}>Event title *</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Team Meeting"
          placeholderTextColor={NEUTRAL.placeholder}
          style={styles.input}
        />
      </View>

      {/* Description */}
      <View style={styles.field}>
        <Text style={styles.label}>Description</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Add event details..."
          placeholderTextColor={NEUTRAL.placeholder}
          multiline
          textAlignVertical="top"
          style={[styles.input, styles.textArea]}
        />
      </View>

      {/* Start Date/Time */}
      <View style={styles.field}>
        <Text style={styles.label}>Start *</Text>
        <View style={styles.dateTimeRow}>
          <Pressable onPress={() => openPicker("start-date")} style={fieldStyle}>
            <Text style={[styles.dateText, !startDate && styles.placeholderText]}>
              {formatDateLabel(startDate)}
            </Text>
          </Pressable>
          <Pressable onPress={() => openPicker("start-time")} style={fieldStyle}>
            <Text style={[styles.dateText, !startTime && styles.placeholderText]}>
              {formatTimeLabel(startTime)}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* End Date/Time */}
      <View style={styles.field}>
        <Text style={styles.label}>End (optional)</Text>
        <View style={styles.dateTimeRow}>
          <Pressable onPress={() => openPicker("end-date")} style={fieldStyle}>
            <Text style={[styles.dateText, !endDate && styles.placeholderText]}>
              {formatDateLabel(endDate)}
            </Text>
          </Pressable>
          <Pressable onPress={() => openPicker("end-time")} style={fieldStyle}>
            <Text style={[styles.dateText, !endTime && styles.placeholderText]}>
              {formatTimeLabel(endTime)}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Date/Time Picker */}
      {activePicker && (
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
          {Platform.OS === "ios" && (
            <Pressable
              onPress={() => setActivePicker(null)}
              style={styles.pickerDoneButton}
            >
              <Text style={styles.pickerDoneText}>Done</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Location */}
      <View style={styles.field}>
        <Text style={styles.label}>Location</Text>
        <TextInput
          value={location}
          onChangeText={setLocation}
          placeholder="Team facility or address"
          placeholderTextColor={NEUTRAL.placeholder}
          style={styles.input}
        />
      </View>

      {/* Event Type */}
      <View style={styles.field}>
        <Text style={styles.label}>Event type</Text>
        <View style={styles.chipRow}>
          {EVENT_TYPE_OPTIONS.map((option) => {
            const selected = eventType === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => setEventType(option.value)}
                style={[styles.chip, selected && styles.chipSelected]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Audience */}
      <View style={styles.field}>
        <Text style={styles.label}>Audience</Text>
        <View style={styles.chipRow}>
          {AUDIENCE_OPTIONS.map((option) => {
            const selected = audience === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => setAudience(option.value)}
                style={[styles.chip, selected && styles.chipSelected]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Submit Button */}
      <Pressable
        onPress={handleSubmit}
        disabled={isSaving}
        style={({ pressed }) => [styles.submitButton, isSaving && styles.submitButtonDisabled, pressed && { opacity: 0.7 }]}
      >
        {isSaving ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.submitButtonText}>Save Changes</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: NEUTRAL.background,
    },
    content: {
      padding: SPACING.md,
      gap: SPACING.lg,
      paddingBottom: SPACING.xxl,
    },
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: SPACING.lg,
    },
    errorContainer: {
      backgroundColor: SEMANTIC.errorLight,
      borderRadius: RADIUS.md,
      padding: SPACING.sm,
      borderWidth: 1,
      borderColor: SEMANTIC.error,
    },
    errorText: {
      ...TYPOGRAPHY.bodySmall,
      color: SEMANTIC.error,
    },
    field: {
      gap: SPACING.sm,
    },
    label: {
      ...TYPOGRAPHY.labelMedium,
      color: NEUTRAL.secondary,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    input: {
      backgroundColor: NEUTRAL.surface,
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm + 2,
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.foreground,
    },
    textArea: {
      minHeight: 120,
      textAlignVertical: "top",
    },
    dateTimeRow: {
      flexDirection: "row",
      gap: SPACING.sm,
    },
    dateText: {
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.foreground,
    },
    placeholderText: {
      color: NEUTRAL.placeholder,
    },
    pickerContainer: {
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      borderRadius: RADIUS.md,
      overflow: "hidden",
      backgroundColor: NEUTRAL.surface,
    },
    pickerDoneButton: {
      paddingVertical: SPACING.sm,
      alignItems: "center",
      borderTopWidth: 1,
      borderTopColor: NEUTRAL.border,
    },
    pickerDoneText: {
      ...TYPOGRAPHY.labelLarge,
      color: colors.primary,
    },
    chipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: SPACING.sm,
    },
    chip: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs,
      borderRadius: RADIUS.full,
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      backgroundColor: NEUTRAL.surface,
    },
    chipSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primaryLight || SEMANTIC.successLight,
    },
    chipText: {
      ...TYPOGRAPHY.labelMedium,
      color: NEUTRAL.foreground,
    },
    chipTextSelected: {
      color: colors.primaryForeground || NEUTRAL.foreground,
      fontWeight: "600",
    },
    submitButton: {
      backgroundColor: colors.primary,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.md,
      alignItems: "center",
      marginTop: SPACING.md,
      ...SHADOWS.sm,
    },
    submitButtonDisabled: {
      opacity: 0.7,
    },
    submitButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: colors.primaryForeground || "#ffffff",
      fontWeight: "600",
    },
  });
