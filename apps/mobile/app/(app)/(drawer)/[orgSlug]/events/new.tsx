import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useNavigation } from "expo-router";
import { DrawerActions } from "@react-navigation/native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { fetchWithAuth } from "@/lib/web-api";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatDatePickerLabel, formatTimePickerLabel } from "@/lib/date-format";

type Audience = "members" | "alumni" | "both" | "specific";
type Channel = "email" | "sms" | "both";
type EventType = "general" | "philanthropy" | "game" | "meeting" | "social" | "fundraiser";
type PickerTarget = "start-date" | "start-time" | "end-date" | "end-time";

type TargetUser = {
  id: string;
  label: string;
};

const AUDIENCE_OPTIONS: { value: Audience; label: string }[] = [
  { value: "both", label: "Members + Alumni" },
  { value: "members", label: "Members" },
  { value: "alumni", label: "Alumni" },
  { value: "specific", label: "Specific People" },
];

const CHANNEL_OPTIONS: { value: Channel; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "both", label: "Email + SMS" },
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

export default function NewEventScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { orgId, orgSlug, orgName, orgLogoUrl } = useOrg();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [endTime, setEndTime] = useState<Date | null>(null);
  const [location, setLocation] = useState("");
  const [eventType, setEventType] = useState<EventType>("general");
  const [audience, setAudience] = useState<Audience>("both");
  const [channel, setChannel] = useState<Channel>("email");
  const [sendNotification, setSendNotification] = useState(true);
  const [targetUserIds, setTargetUserIds] = useState<string[]>([]);
  const [userOptions, setUserOptions] = useState<TargetUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePicker, setActivePicker] = useState<PickerTarget | null>(null);

  const styles = useMemo(() => createStyles(), []);

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {}
  }, [navigation]);

  useEffect(() => {
    let isMounted = true;

    async function loadUsers() {
      if (!orgId) return;
      setLoadingUsers(true);
      try {
        const { data, error: fetchError } = await supabase
          .from("user_organization_roles")
          .select("user_id, users(name,email)")
          .eq("organization_id", orgId)
          .eq("status", "active");

        if (fetchError) throw fetchError;

        const memberships =
          (data as Array<{
            user_id: string;
            users?: { name?: string | null; email?: string | null } | { name?: string | null; email?: string | null }[] | null;
          }> | null) || [];

        const options = memberships.map((m) => {
          const user = Array.isArray(m.users) ? m.users[0] : m.users;
          return {
            id: m.user_id,
            label: user?.name || user?.email || "User",
          };
        });

        if (isMounted) {
          setUserOptions(options);
        }
      } catch (e) {
        if (isMounted) {
          setError((e as Error).message);
        }
      } finally {
        if (isMounted) {
          setLoadingUsers(false);
        }
      }
    }

    loadUsers();

    return () => {
      isMounted = false;
    };
  }, [orgId]);

  const notificationChannel = useMemo(() => `${channel},push`, [channel]);
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

  const toggleTargetUser = (userId: string) => {
    setTargetUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleSubmit = async () => {
    if (!orgId || !orgSlug) {
      setError("Organization not loaded yet.");
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

    if (audience === "specific" && targetUserIds.length === 0) {
      setError("Select at least one recipient.");
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
      const { data: userData } = await supabase.auth.getUser();
      const createdByUserId = userData.user?.id || null;

      const audienceValue = audience === "specific" ? "both" : audience;
      const targetIds = audience === "specific" ? targetUserIds : null;

      const { data: event, error: insertError } = await supabase
        .from("events")
        .insert({
          organization_id: orgId,
          title: title.trim(),
          description: description.trim() || null,
          start_date: startDateTime,
          end_date: endDateTime,
          location: location.trim() || null,
          event_type: eventType,
          is_philanthropy: eventType === "philanthropy",
          audience: audienceValue,
          target_user_ids: targetIds,
          created_by_user_id: createdByUserId,
        })
        .select()
        .single();

      if (insertError || !event) {
        throw insertError || new Error("Failed to create event.");
      }

      if (sendNotification) {
        const scheduleLine = `When: ${formatDateLabel(startDate)} at ${formatTimeLabel(startTime)}`;
        const locationLine = location.trim() ? `Where: ${location.trim()}` : "";
        const notificationBody = [description.trim(), scheduleLine, locationLine]
          .filter(Boolean)
          .join("\n\n");

        try {
          const response = await fetchWithAuth("/api/notifications/send", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              organizationId: orgId,
              title: `New Event: ${title.trim()}`,
              body: notificationBody || scheduleLine,
              channel: notificationChannel,
              audience: audienceValue,
              targetUserIds: targetIds || undefined,
              pushType: "event",
              pushResourceId: event.id,
            }),
          });

          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            console.warn("Failed to send notification:", data?.error || response.status);
          }
        } catch (notifyError) {
          console.warn("Failed to send notification:", notifyError);
        }
      }

      try {
        await fetchWithAuth("/api/calendar/event-sync", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            eventId: event.id,
            organizationId: orgId,
            operation: "create",
          }),
        });
      } catch (syncError) {
        console.warn("Failed to sync calendar:", syncError);
      }

      router.push(`/(app)/${orgSlug}/(tabs)/events`);
    } catch (e) {
      setError((e as Error).message || "Failed to create event.");
    } finally {
      setIsSaving(false);
    }
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
                <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "O"}</Text>
                </View>
              )}
            </Pressable>
            <Text style={styles.headerTitle}>Create Event</Text>
            <View style={styles.headerSpacer} />
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>Create Event</Text>
            <Text style={styles.formSubtitle}>Schedule a new team event</Text>
          </View>

          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Event title</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Team Meeting"
              placeholderTextColor={NEUTRAL.placeholder}
              style={styles.input}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Description</Text>
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

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Start</Text>
            <View style={styles.dateTimeRow}>
              <Pressable onPress={() => openPicker("start-date")} style={styles.dateTimeField}>
                <Text
                  style={[
                    styles.dateTimeText,
                    !startDate && styles.dateTimePlaceholder,
                  ]}
                >
                  {formatDateLabel(startDate)}
                </Text>
              </Pressable>
              <Pressable onPress={() => openPicker("start-time")} style={styles.dateTimeField}>
                <Text
                  style={[
                    styles.dateTimeText,
                    !startTime && styles.dateTimePlaceholder,
                  ]}
                >
                  {formatTimeLabel(startTime)}
                </Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>End (optional)</Text>
            <View style={styles.dateTimeRow}>
              <Pressable onPress={() => openPicker("end-date")} style={styles.dateTimeField}>
                <Text
                  style={[
                    styles.dateTimeText,
                    !endDate && styles.dateTimePlaceholder,
                  ]}
                >
                  {formatDateLabel(endDate)}
                </Text>
              </Pressable>
              <Pressable onPress={() => openPicker("end-time")} style={styles.dateTimeField}>
                <Text
                  style={[
                    styles.dateTimeText,
                    !endTime && styles.dateTimePlaceholder,
                  ]}
                >
                  {formatTimeLabel(endTime)}
                </Text>
              </Pressable>
            </View>
          </View>

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

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Location</Text>
            <TextInput
              value={location}
              onChangeText={setLocation}
              placeholder="Team facility or address"
              placeholderTextColor={NEUTRAL.placeholder}
              style={styles.input}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Event type</Text>
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

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Audience</Text>
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

          {audience === "specific" && (
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Select recipients</Text>
              {loadingUsers ? (
                <ActivityIndicator color={SEMANTIC.success} />
              ) : (
                <View style={styles.optionList}>
                  {userOptions.length === 0 ? (
                    <Text style={styles.emptyText}>No users available.</Text>
                  ) : (
                    userOptions.map((user) => {
                      const selected = targetUserIds.includes(user.id);
                      return (
                        <Pressable
                          key={user.id}
                          onPress={() => toggleTargetUser(user.id)}
                          style={[
                            styles.optionRow,
                            selected && styles.optionRowSelected,
                          ]}
                        >
                          <View
                            style={[
                              styles.optionIndicator,
                              selected && styles.optionIndicatorSelected,
                            ]}
                          />
                          <Text style={styles.optionLabel}>{user.label}</Text>
                        </Pressable>
                      );
                    })
                  )}
                </View>
              )}
            </View>
          )}

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Notification channel</Text>
            <View style={styles.chipRow}>
              {CHANNEL_OPTIONS.map((option) => {
                const selected = channel === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setChannel(option.value)}
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

          <View style={styles.switchGroup}>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Send notifications</Text>
              <Switch
                value={sendNotification}
                onValueChange={setSendNotification}
                trackColor={{ false: NEUTRAL.border, true: SEMANTIC.successLight }}
                thumbColor={sendNotification ? SEMANTIC.success : NEUTRAL.surface}
              />
            </View>
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
              <Text style={styles.primaryButtonText}>Create Event</Text>
            )}
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: NEUTRAL.background,
    },
    headerGradient: {
      // Gradient fills this area
    },
    headerSafeArea: {
      // SafeAreaView handles top inset
    },
    headerContent: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      minHeight: 44,
    },
    orgLogoButton: {
      width: 36,
      height: 36,
      borderRadius: 8,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
    },
    orgLogo: {
      width: 36,
      height: 36,
      borderRadius: 8,
    },
    orgAvatar: {
      width: 36,
      height: 36,
      borderRadius: 8,
      backgroundColor: "rgba(255,255,255,0.2)",
      alignItems: "center",
      justifyContent: "center",
    },
    orgAvatarText: {
      ...TYPOGRAPHY.titleMedium,
      color: APP_CHROME.headerTitle,
    },
    headerTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
      flex: 1,
      textAlign: "center",
    },
    headerSpacer: {
      width: 36,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: NEUTRAL.surface,
    },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: SPACING.xxl,
      gap: SPACING.lg,
    },
    formHeader: {
      gap: SPACING.xs,
    },
    formTitle: {
      ...TYPOGRAPHY.headlineMedium,
      color: NEUTRAL.foreground,
    },
    formSubtitle: {
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.secondary,
    },
    errorCard: {
      backgroundColor: SEMANTIC.errorLight,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
      borderWidth: 1,
      borderColor: SEMANTIC.error,
    },
    errorText: {
      ...TYPOGRAPHY.bodySmall,
      color: SEMANTIC.error,
    },
    fieldGroup: {
      gap: SPACING.xs,
    },
    fieldLabel: {
      ...TYPOGRAPHY.labelMedium,
      color: NEUTRAL.secondary,
    },
    input: {
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.foreground,
      backgroundColor: NEUTRAL.surface,
    },
    textArea: {
      minHeight: 120,
    },
    dateTimeRow: {
      flexDirection: "row",
      gap: SPACING.sm,
    },
    dateTimeField: {
      flex: 1,
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      backgroundColor: NEUTRAL.surface,
      justifyContent: "center",
    },
    dateTimeText: {
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.foreground,
    },
    dateTimePlaceholder: {
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
      color: SEMANTIC.success,
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
      borderColor: SEMANTIC.success,
      backgroundColor: SEMANTIC.successLight,
    },
    chipText: {
      ...TYPOGRAPHY.labelMedium,
      color: NEUTRAL.foreground,
    },
    chipTextSelected: {
      color: SEMANTIC.successDark,
      fontWeight: "600",
    },
    optionList: {
      gap: SPACING.sm,
    },
    optionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
      padding: SPACING.sm,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      backgroundColor: NEUTRAL.surface,
    },
    optionRowSelected: {
      borderColor: SEMANTIC.success,
      backgroundColor: SEMANTIC.successLight,
    },
    optionIndicator: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 2,
      borderColor: NEUTRAL.muted,
      backgroundColor: "transparent",
    },
    optionIndicatorSelected: {
      borderColor: SEMANTIC.success,
      backgroundColor: SEMANTIC.success,
    },
    optionLabel: {
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.foreground,
    },
    emptyText: {
      ...TYPOGRAPHY.bodySmall,
      color: NEUTRAL.muted,
    },
    switchGroup: {
      gap: SPACING.md,
    },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    switchLabel: {
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.foreground,
    },
    primaryButton: {
      backgroundColor: SEMANTIC.success,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.md,
      alignItems: "center",
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
  });
}
