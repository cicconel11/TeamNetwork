import React, { useState, useMemo, useCallback, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Pressable,
  Image,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useRouter, useNavigation } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";
import { ChevronLeft, Check } from "lucide-react-native";
import { useOrg } from "@/contexts/OrgContext";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { APP_CHROME } from "@/lib/chrome";
import { spacing, borderRadius, fontSize, fontWeight } from "@/lib/theme";
import type { OccurrenceType } from "@teammeet/types";

const SCHEDULE_COLORS = {
  background: "#ffffff",
  sectionBackground: "#f8fafc",
  primaryText: "#0f172a",
  secondaryText: "#64748b",
  mutedText: "#94a3b8",
  border: "#e2e8f0",
  card: "#ffffff",
  primaryCTA: "#059669",
  primaryCTAText: "#ffffff",
  error: "#ef4444",
  errorBg: "#fee2e2",
  inputBg: "#f8fafc",
};

const DAYS_OF_WEEK = [
  { label: "Sunday", value: 0 },
  { label: "Monday", value: 1 },
  { label: "Tuesday", value: 2 },
  { label: "Wednesday", value: 3 },
  { label: "Thursday", value: 4 },
  { label: "Friday", value: 5 },
  { label: "Saturday", value: 6 },
];

const OCCURRENCE_OPTIONS: { label: string; value: OccurrenceType }[] = [
  { label: "Single event", value: "single" },
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
  { label: "Monthly", value: "monthly" },
];

export default function NewScheduleScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { orgSlug, orgName, orgLogoUrl } = useOrg();
  const { user } = useAuth();
  const styles = useMemo(() => createStyles(), []);

  const [orgId, setOrgId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [occurrenceType, setOccurrenceType] = useState<OccurrenceType>("weekly");
  const [startTime, setStartTime] = useState(new Date(2024, 0, 1, 9, 0));
  const [endTime, setEndTime] = useState(new Date(2024, 0, 1, 10, 0));
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [dayOfWeek, setDayOfWeek] = useState<number[]>([1]); // Default Monday
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [notes, setNotes] = useState("");

  const [showStartTimePicker, setShowStartTimePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch org ID
  useEffect(() => {
    if (!orgSlug) return;
    supabase
      .from("organizations")
      .select("id")
      .eq("slug", orgSlug)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setOrgId(data.id);
      });
  }, [orgSlug]);

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // no-op
    }
  }, [navigation]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  };

  const toggleDayOfWeek = (day: number) => {
    setDayOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    const startTimeStr = `${startTime.getHours().toString().padStart(2, "0")}:${startTime.getMinutes().toString().padStart(2, "0")}`;
    const endTimeStr = `${endTime.getHours().toString().padStart(2, "0")}:${endTime.getMinutes().toString().padStart(2, "0")}`;

    if (startTimeStr >= endTimeStr) {
      setError("End time must be after start time");
      return;
    }

    if (endDate && startDate > endDate) {
      setError("End date must be on or after start date");
      return;
    }

    if (occurrenceType === "weekly" && dayOfWeek.length === 0) {
      setError("Select at least one day of the week");
      return;
    }

    if (!orgId || !user) {
      setError("Unable to create schedule");
      return;
    }

    setIsLoading(true);
    setError(null);

    const startDateStr = startDate.toISOString().split("T")[0];
    const endDateStr = endDate ? endDate.toISOString().split("T")[0] : null;

    const insertData: Record<string, unknown> = {
      organization_id: orgId,
      user_id: user.id,
      title: title.trim(),
      occurrence_type: occurrenceType,
      start_time: startTimeStr,
      end_time: endTimeStr,
      start_date: startDateStr,
      end_date: endDateStr,
      notes: notes.trim() || null,
      day_of_week: null,
      day_of_month: null,
    };

    if (occurrenceType === "weekly") {
      insertData.day_of_week = dayOfWeek;
    } else if (occurrenceType === "monthly") {
      insertData.day_of_month = dayOfMonth;
    }

    const { error: insertError } = await supabase
      .from("academic_schedules")
      .insert(insertData);

    if (insertError) {
      setError(insertError.message);
      setIsLoading(false);
      return;
    }

    router.back();
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.navHeader}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
            </TouchableOpacity>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Add Schedule</Text>
              <Text style={styles.headerMeta}>Add a class or academic commitment</Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Title */}
        <View style={styles.field}>
          <Text style={styles.label}>Title *</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g., Biology 101, Work shift"
            placeholderTextColor={SCHEDULE_COLORS.mutedText}
          />
        </View>

        {/* Occurrence Type */}
        <View style={styles.field}>
          <Text style={styles.label}>Occurrence</Text>
          <View style={styles.optionsGrid}>
            {OCCURRENCE_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.optionButton,
                  occurrenceType === option.value && styles.optionButtonActive,
                ]}
                onPress={() => setOccurrenceType(option.value)}
              >
                <Text
                  style={[
                    styles.optionText,
                    occurrenceType === option.value && styles.optionTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Days of Week (for weekly) */}
        {occurrenceType === "weekly" && (
          <View style={styles.field}>
            <Text style={styles.label}>Days of Week</Text>
            <View style={styles.daysGrid}>
              {DAYS_OF_WEEK.map((day) => (
                <TouchableOpacity
                  key={day.value}
                  style={[
                    styles.dayButton,
                    dayOfWeek.includes(day.value) && styles.dayButtonActive,
                  ]}
                  onPress={() => toggleDayOfWeek(day.value)}
                >
                  {dayOfWeek.includes(day.value) && (
                    <Check size={14} color={SCHEDULE_COLORS.primaryCTAText} />
                  )}
                  <Text
                    style={[
                      styles.dayText,
                      dayOfWeek.includes(day.value) && styles.dayTextActive,
                    ]}
                  >
                    {day.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.helperText}>Select all days this schedule repeats.</Text>
          </View>
        )}

        {/* Day of Month (for monthly) */}
        {occurrenceType === "monthly" && (
          <View style={styles.field}>
            <Text style={styles.label}>Day of Month</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.monthDaysRow}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                  <TouchableOpacity
                    key={day}
                    style={[
                      styles.monthDayButton,
                      dayOfMonth === day && styles.monthDayButtonActive,
                    ]}
                    onPress={() => setDayOfMonth(day)}
                  >
                    <Text
                      style={[
                        styles.monthDayText,
                        dayOfMonth === day && styles.monthDayTextActive,
                      ]}
                    >
                      {day}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        )}

        {/* Time Pickers */}
        <View style={styles.row}>
          <View style={[styles.field, styles.halfField]}>
            <Text style={styles.label}>Start Time *</Text>
            <TouchableOpacity
              style={styles.pickerButton}
              onPress={() => setShowStartTimePicker(true)}
            >
              <Text style={styles.pickerText}>{formatTime(startTime)}</Text>
            </TouchableOpacity>
            {showStartTimePicker && (
              <DateTimePicker
                value={startTime}
                mode="time"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                onChange={(event, date) => {
                  setShowStartTimePicker(Platform.OS === "ios");
                  if (date) setStartTime(date);
                }}
              />
            )}
          </View>
          <View style={[styles.field, styles.halfField]}>
            <Text style={styles.label}>End Time *</Text>
            <TouchableOpacity
              style={styles.pickerButton}
              onPress={() => setShowEndTimePicker(true)}
            >
              <Text style={styles.pickerText}>{formatTime(endTime)}</Text>
            </TouchableOpacity>
            {showEndTimePicker && (
              <DateTimePicker
                value={endTime}
                mode="time"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                onChange={(event, date) => {
                  setShowEndTimePicker(Platform.OS === "ios");
                  if (date) setEndTime(date);
                }}
              />
            )}
          </View>
        </View>

        {/* Date Pickers */}
        <View style={styles.row}>
          <View style={[styles.field, styles.halfField]}>
            <Text style={styles.label}>
              {occurrenceType === "single" ? "Date *" : "Start Date *"}
            </Text>
            <TouchableOpacity
              style={styles.pickerButton}
              onPress={() => setShowStartDatePicker(true)}
            >
              <Text style={styles.pickerText}>{formatDate(startDate)}</Text>
            </TouchableOpacity>
            {showStartDatePicker && (
              <DateTimePicker
                value={startDate}
                mode="date"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                onChange={(event, date) => {
                  setShowStartDatePicker(Platform.OS === "ios");
                  if (date) setStartDate(date);
                }}
              />
            )}
          </View>
          {occurrenceType !== "single" && (
            <View style={[styles.field, styles.halfField]}>
              <Text style={styles.label}>End Date (optional)</Text>
              <TouchableOpacity
                style={styles.pickerButton}
                onPress={() => setShowEndDatePicker(true)}
              >
                <Text style={[styles.pickerText, !endDate && styles.placeholderText]}>
                  {endDate ? formatDate(endDate) : "No end date"}
                </Text>
              </TouchableOpacity>
              {showEndDatePicker && (
                <DateTimePicker
                  value={endDate || new Date()}
                  mode="date"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  onChange={(event, date) => {
                    setShowEndDatePicker(Platform.OS === "ios");
                    if (date) setEndDate(date);
                  }}
                />
              )}
            </View>
          )}
        </View>

        {/* Notes */}
        <View style={styles.field}>
          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Room number, professor name, etc."
            placeholderTextColor={SCHEDULE_COLORS.mutedText}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.submitButton, isLoading && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={isLoading}
          >
            <Text style={styles.submitButtonText}>
              {isLoading ? "Adding..." : "Add Schedule"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: SCHEDULE_COLORS.background,
    },
    headerGradient: {
      paddingBottom: spacing.xs,
    },
    headerSafeArea: {},
    navHeader: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      minHeight: 40,
      gap: spacing.sm,
    },
    backButton: {
      padding: spacing.xs,
      marginLeft: -spacing.xs,
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
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      padding: spacing.md,
      paddingBottom: 40,
    },
    errorContainer: {
      padding: spacing.md,
      borderRadius: borderRadius.md,
      backgroundColor: SCHEDULE_COLORS.errorBg,
      marginBottom: spacing.md,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: SCHEDULE_COLORS.error,
    },
    field: {
      marginBottom: spacing.md,
    },
    halfField: {
      flex: 1,
    },
    row: {
      flexDirection: "row",
      gap: spacing.md,
    },
    label: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: SCHEDULE_COLORS.primaryText,
      marginBottom: spacing.xs,
    },
    helperText: {
      fontSize: fontSize.xs,
      color: SCHEDULE_COLORS.mutedText,
      marginTop: spacing.xs,
    },
    input: {
      backgroundColor: SCHEDULE_COLORS.inputBg,
      borderWidth: 1,
      borderColor: SCHEDULE_COLORS.border,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: fontSize.base,
      color: SCHEDULE_COLORS.primaryText,
    },
    textArea: {
      minHeight: 80,
      paddingTop: spacing.sm,
    },
    optionsGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    optionButton: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: borderRadius.md,
      backgroundColor: SCHEDULE_COLORS.inputBg,
      borderWidth: 1,
      borderColor: SCHEDULE_COLORS.border,
    },
    optionButtonActive: {
      backgroundColor: SCHEDULE_COLORS.primaryCTA,
      borderColor: SCHEDULE_COLORS.primaryCTA,
    },
    optionText: {
      fontSize: fontSize.sm,
      color: SCHEDULE_COLORS.primaryText,
    },
    optionTextActive: {
      color: SCHEDULE_COLORS.primaryCTAText,
    },
    daysGrid: {
      gap: spacing.sm,
    },
    dayButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: borderRadius.md,
      backgroundColor: SCHEDULE_COLORS.inputBg,
      borderWidth: 1,
      borderColor: SCHEDULE_COLORS.border,
    },
    dayButtonActive: {
      backgroundColor: SCHEDULE_COLORS.primaryCTA,
      borderColor: SCHEDULE_COLORS.primaryCTA,
    },
    dayText: {
      fontSize: fontSize.sm,
      color: SCHEDULE_COLORS.primaryText,
    },
    dayTextActive: {
      color: SCHEDULE_COLORS.primaryCTAText,
    },
    monthDaysRow: {
      flexDirection: "row",
      gap: spacing.xs,
    },
    monthDayButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: SCHEDULE_COLORS.inputBg,
      borderWidth: 1,
      borderColor: SCHEDULE_COLORS.border,
      alignItems: "center",
      justifyContent: "center",
    },
    monthDayButtonActive: {
      backgroundColor: SCHEDULE_COLORS.primaryCTA,
      borderColor: SCHEDULE_COLORS.primaryCTA,
    },
    monthDayText: {
      fontSize: fontSize.sm,
      color: SCHEDULE_COLORS.primaryText,
    },
    monthDayTextActive: {
      color: SCHEDULE_COLORS.primaryCTAText,
    },
    pickerButton: {
      backgroundColor: SCHEDULE_COLORS.inputBg,
      borderWidth: 1,
      borderColor: SCHEDULE_COLORS.border,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    pickerText: {
      fontSize: fontSize.base,
      color: SCHEDULE_COLORS.primaryText,
    },
    placeholderText: {
      color: SCHEDULE_COLORS.mutedText,
    },
    actions: {
      flexDirection: "row",
      gap: spacing.md,
      marginTop: spacing.lg,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: SCHEDULE_COLORS.border,
    },
    cancelButton: {
      flex: 1,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.md,
      backgroundColor: SCHEDULE_COLORS.inputBg,
      borderWidth: 1,
      borderColor: SCHEDULE_COLORS.border,
      alignItems: "center",
    },
    cancelButtonText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: SCHEDULE_COLORS.primaryText,
    },
    submitButton: {
      flex: 1,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.md,
      backgroundColor: SCHEDULE_COLORS.primaryCTA,
      alignItems: "center",
    },
    submitButtonDisabled: {
      opacity: 0.6,
    },
    submitButtonText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: SCHEDULE_COLORS.primaryCTAText,
    },
  });
