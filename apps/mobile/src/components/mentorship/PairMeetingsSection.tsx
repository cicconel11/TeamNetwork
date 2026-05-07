import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  StyleSheet,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Plus, Trash2, Calendar, Video, Users } from "lucide-react-native";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";
import { SelectField, SelectModal } from "@/components/ui/SelectField";
import {
  createMeeting,
  deleteMeeting,
  getMeetings,
  type MentorshipMeeting,
} from "@/lib/mentorship-api";
import type { SelectOption } from "@/types/mentorship";

const PLATFORM_OPTIONS: SelectOption[] = [
  { value: "in_person", label: "In person" },
  { value: "zoom", label: "Zoom" },
  { value: "google_meet", label: "Google Meet" },
  { value: "other", label: "Other" },
];

const DURATION_OPTIONS: SelectOption[] = [
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "45", label: "45 min" },
  { value: "60", label: "1 hour" },
  { value: "90", label: "1.5 hours" },
];

export function PairMeetingsSection({
  orgId,
  pairId,
  canEdit,
}: {
  orgId: string;
  pairId: string;
  canEdit: boolean;
}) {
  const styles = useThemedStyles(createStyles);
  const [upcoming, setUpcoming] = useState<MentorshipMeeting[]>([]);
  const [past, setPast] = useState<MentorshipMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState<Date>(new Date(Date.now() + 60 * 60 * 1000));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [duration, setDuration] = useState<string>("30");
  const [platform, setPlatform] = useState<string>("in_person");
  const [activeSelect, setActiveSelect] = useState<"platform" | "duration" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { upcoming: u, past: p } = await getMeetings(orgId, pairId);
      setUpcoming(u);
      setPast(p);
    } catch (err) {
      setError((err as Error).message || "Failed to load meetings.");
    } finally {
      setLoading(false);
    }
  }, [orgId, pairId]);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setTitle("");
    setScheduledAt(new Date(Date.now() + 60 * 60 * 1000));
    setDuration("30");
    setPlatform("in_person");
  };

  const handleCreate = async () => {
    if (!title.trim()) {
      Alert.alert("Title required", "Give the meeting a short title before scheduling.");
      return;
    }
    setSubmitting(true);
    try {
      const { meeting } = await createMeeting(orgId, {
        pair_id: pairId,
        title: title.trim(),
        scheduled_at: scheduledAt.toISOString(),
        duration_minutes: Number.parseInt(duration, 10),
        platform: platform as "zoom" | "google_meet" | "in_person" | "other",
      });
      setUpcoming((prev) => [...prev, meeting].sort((a, b) =>
        a.scheduled_at.localeCompare(b.scheduled_at)
      ));
      resetForm();
      setShowForm(false);
    } catch (err) {
      Alert.alert("Could not schedule", (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (meeting: MentorshipMeeting) => {
    Alert.alert("Cancel meeting?", `Cancel "${meeting.title}"?`, [
      { text: "Keep", style: "cancel" },
      {
        text: "Cancel meeting",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteMeeting(orgId, meeting.id);
            setUpcoming((prev) => prev.filter((m) => m.id !== meeting.id));
            setPast((prev) => prev.filter((m) => m.id !== meeting.id));
          } catch (err) {
            Alert.alert("Could not cancel", (err as Error).message);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={styles.spinnerColor.color} />
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {upcoming.length === 0 && past.length === 0 && !showForm ? (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>No meetings scheduled</Text>
          <Text style={styles.emptySubtitle}>
            Schedule recurring 1:1s and keep momentum.
          </Text>
        </View>
      ) : null}

      {upcoming.length > 0 ? (
        <Text style={styles.sectionLabel}>Upcoming</Text>
      ) : null}
      {upcoming.map((meeting) => (
        <MeetingCard
          key={meeting.id}
          meeting={meeting}
          canEdit={canEdit}
          onDelete={handleDelete}
          styles={styles}
        />
      ))}

      {past.length > 0 ? (
        <Text style={[styles.sectionLabel, { marginTop: SPACING.sm }]}>Past</Text>
      ) : null}
      {past.slice(0, 5).map((meeting) => (
        <MeetingCard
          key={meeting.id}
          meeting={meeting}
          canEdit={false}
          onDelete={handleDelete}
          styles={styles}
        />
      ))}

      {canEdit ? (
        showForm ? (
          <View style={styles.formCard}>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Meeting title"
              placeholderTextColor={styles.placeholderColor.color}
              style={styles.input}
            />

            <View style={styles.dateRow}>
              <Pressable
                onPress={() => setShowDatePicker(true)}
                style={({ pressed }) => [
                  styles.dateButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.dateLabel}>Date</Text>
                <Text style={styles.dateValue}>{formatDate(scheduledAt)}</Text>
              </Pressable>
              <Pressable
                onPress={() => setShowTimePicker(true)}
                style={({ pressed }) => [
                  styles.dateButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.dateLabel}>Time</Text>
                <Text style={styles.dateValue}>{formatTime(scheduledAt)}</Text>
              </Pressable>
            </View>

            {showDatePicker ? (
              <DateTimePicker
                value={scheduledAt}
                mode="date"
                display={Platform.OS === "ios" ? "inline" : "default"}
                onChange={(_, date) => {
                  setShowDatePicker(false);
                  if (date) {
                    const updated = new Date(scheduledAt);
                    updated.setFullYear(date.getFullYear());
                    updated.setMonth(date.getMonth());
                    updated.setDate(date.getDate());
                    setScheduledAt(updated);
                  }
                }}
              />
            ) : null}
            {showTimePicker ? (
              <DateTimePicker
                value={scheduledAt}
                mode="time"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                onChange={(_, date) => {
                  setShowTimePicker(false);
                  if (date) {
                    const updated = new Date(scheduledAt);
                    updated.setHours(date.getHours());
                    updated.setMinutes(date.getMinutes());
                    setScheduledAt(updated);
                  }
                }}
              />
            ) : null}

            <View style={styles.dateRow}>
              <View style={{ flex: 1 }}>
                <SelectField
                  label="Duration"
                  value={
                    DURATION_OPTIONS.find((o) => o.value === duration)?.label || ""
                  }
                  placeholder="Duration"
                  onPress={() => setActiveSelect("duration")}
                />
              </View>
              <View style={{ flex: 1 }}>
                <SelectField
                  label="Platform"
                  value={
                    PLATFORM_OPTIONS.find((o) => o.value === platform)?.label || ""
                  }
                  placeholder="Platform"
                  onPress={() => setActiveSelect("platform")}
                />
              </View>
            </View>

            <View style={styles.formActions}>
              <Pressable
                onPress={() => {
                  setShowForm(false);
                  resetForm();
                }}
                disabled={submitting}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleCreate}
                disabled={submitting}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.buttonPressed,
                  submitting && styles.buttonDisabled,
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Schedule</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => setShowForm(true)}
            style={({ pressed }) => [
              styles.addButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Plus size={16} color="#ffffff" />
            <Text style={styles.addButtonText}>Schedule meeting</Text>
          </Pressable>
        )
      ) : null}

      <SelectModal
        visible={activeSelect === "duration"}
        title="Duration"
        options={DURATION_OPTIONS}
        selectedValue={duration}
        onSelect={(opt) => {
          setDuration(opt.value);
          setActiveSelect(null);
        }}
        onClose={() => setActiveSelect(null)}
      />
      <SelectModal
        visible={activeSelect === "platform"}
        title="Platform"
        options={PLATFORM_OPTIONS}
        selectedValue={platform}
        onSelect={(opt) => {
          setPlatform(opt.value);
          setActiveSelect(null);
        }}
        onClose={() => setActiveSelect(null)}
      />
    </View>
  );
}

function MeetingCard({
  meeting,
  canEdit,
  onDelete,
  styles,
}: {
  meeting: MentorshipMeeting;
  canEdit: boolean;
  onDelete: (m: MentorshipMeeting) => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const PlatformIcon =
    meeting.platform === "in_person" ? Users : meeting.platform === "google_meet" || meeting.platform === "zoom" ? Video : Calendar;
  return (
    <View style={styles.card}>
      <View style={styles.meetingRow}>
        <View style={styles.platformIcon}>
          <PlatformIcon size={18} color={styles.platformIconColor.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.meetingTitle}>{meeting.title}</Text>
          <Text style={styles.meetingMeta}>
            {formatMeetingDate(meeting.scheduled_at)} ·{" "}
            {meeting.duration_minutes} min
          </Text>
          <Text style={styles.meetingMeta}>
            {labelizePlatform(meeting.platform)}
            {meeting.calendar_sync_status === "synced" ? " · synced" : ""}
          </Text>
          {meeting.meeting_link ? (
            <Pressable
              onPress={() => Linking.openURL(meeting.meeting_link!)}
              style={({ pressed }) => pressed && styles.buttonPressed}
            >
              <Text style={styles.meetingLink}>Join meeting</Text>
            </Pressable>
          ) : null}
        </View>
        {canEdit ? (
          <Pressable
            onPress={() => onDelete(meeting)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.deleteButton}
          >
            <Trash2 size={16} color={styles.deleteIcon.color} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function formatDate(d: Date) {
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTime(d: Date) {
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatMeetingDate(iso: string) {
  const d = new Date(iso);
  return `${formatDate(d)} · ${formatTime(d)}`;
}

function labelizePlatform(p: string) {
  if (p === "google_meet") return "Google Meet";
  if (p === "zoom") return "Zoom";
  if (p === "in_person") return "In person";
  return "Other";
}

const createStyles = (n: NeutralColors, s: SemanticColors) =>
  StyleSheet.create({
    list: {
      gap: SPACING.sm,
    },
    sectionLabel: {
      fontSize: 12,
      fontWeight: "700",
      color: n.muted,
      textTransform: "uppercase",
      paddingHorizontal: SPACING.xs,
    },
    card: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
    },
    formCard: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      gap: SPACING.sm,
    },
    meetingRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: SPACING.sm,
    },
    platformIcon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: n.divider,
    },
    platformIconColor: {
      color: n.muted,
    },
    meetingTitle: {
      fontSize: 15,
      fontWeight: "600",
      color: n.foreground,
    },
    meetingMeta: {
      fontSize: 12,
      color: n.muted,
      marginTop: 2,
    },
    meetingLink: {
      fontSize: 13,
      fontWeight: "600",
      color: s.success,
      marginTop: SPACING.xs,
    },
    deleteButton: {
      padding: 4,
    },
    deleteIcon: {
      color: s.error,
    },
    placeholderColor: {
      color: n.muted,
    },
    input: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      fontSize: 15,
      color: n.foreground,
      backgroundColor: n.surface,
    },
    dateRow: {
      flexDirection: "row",
      gap: SPACING.sm,
    },
    dateButton: {
      flex: 1,
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      backgroundColor: n.surface,
    },
    dateLabel: {
      fontSize: 12,
      color: n.muted,
    },
    dateValue: {
      fontSize: 14,
      color: n.foreground,
      fontWeight: "500",
      marginTop: 2,
    },
    formActions: {
      flexDirection: "row",
      gap: SPACING.sm,
    },
    primaryButton: {
      flex: 1,
      backgroundColor: s.success,
      paddingVertical: SPACING.sm,
      borderRadius: RADIUS.md,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonText: {
      color: "#ffffff",
      fontSize: 14,
      fontWeight: "600",
    },
    secondaryButton: {
      flex: 1,
      paddingVertical: SPACING.sm,
      borderRadius: RADIUS.md,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    secondaryButtonText: {
      color: n.foreground,
      fontSize: 14,
      fontWeight: "600",
    },
    addButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: SPACING.xs,
      backgroundColor: s.success,
      paddingVertical: SPACING.sm,
      borderRadius: RADIUS.md,
    },
    addButtonText: {
      color: "#ffffff",
      fontSize: 14,
      fontWeight: "600",
    },
    buttonPressed: {
      opacity: 0.85,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: n.foreground,
    },
    emptySubtitle: {
      fontSize: 14,
      color: n.muted,
      marginTop: 2,
    },
    errorCard: {
      backgroundColor: `${s.error}14`,
      borderWidth: 1,
      borderColor: `${s.error}55`,
      borderRadius: RADIUS.md,
      padding: SPACING.sm,
    },
    errorText: {
      fontSize: 13,
      color: s.error,
    },
    spinnerColor: {
      color: s.success,
    },
  });
