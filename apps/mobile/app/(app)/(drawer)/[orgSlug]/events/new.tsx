import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { fetchWithAuth } from "@/lib/web-api";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import { borderRadius, fontSize, fontWeight, spacing } from "@/lib/theme";

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

export default function NewEventScreen() {
  const router = useRouter();
  const { orgId, orgSlug } = useOrg();
  const { colors } = useOrgTheme();

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

  const fieldStyle = {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.secondaryDark,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.secondary,
    justifyContent: "center" as const,
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.primary }}
      contentContainerStyle={{
        padding: spacing.md,
        gap: spacing.lg,
      }}
    >
      {error && (
        <View
          style={{
            backgroundColor: `${colors.error}20`,
            borderRadius: borderRadius.md,
            padding: spacing.sm,
          }}
        >
          <Text selectable style={{ color: colors.error, fontSize: fontSize.sm }}>
            {error}
          </Text>
        </View>
      )}

      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: fontSize.sm, color: colors.primaryForeground }}>Event title</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Team Meeting"
          placeholderTextColor={colors.secondaryForeground}
          style={{
            borderWidth: 1,
            borderColor: colors.secondaryDark,
            borderRadius: borderRadius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            fontSize: fontSize.base,
            color: colors.secondaryForeground,
            backgroundColor: colors.secondary,
          }}
        />
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: fontSize.sm, color: colors.primaryForeground }}>Description</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Add event details..."
          placeholderTextColor={colors.secondaryForeground}
          multiline
          textAlignVertical="top"
          style={{
            borderWidth: 1,
            borderColor: colors.secondaryDark,
            borderRadius: borderRadius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            fontSize: fontSize.base,
            color: colors.secondaryForeground,
            backgroundColor: colors.secondary,
            minHeight: 120,
          }}
        />
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: fontSize.sm, color: colors.primaryForeground }}>Start</Text>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Pressable onPress={() => openPicker("start-date")} style={fieldStyle}>
            <Text
              style={{
                fontSize: fontSize.base,
                color: colors.secondaryForeground,
                opacity: startDate ? 1 : 0.7,
              }}
            >
              {formatDateLabel(startDate)}
            </Text>
          </Pressable>
          <Pressable onPress={() => openPicker("start-time")} style={fieldStyle}>
            <Text
              style={{
                fontSize: fontSize.base,
                color: colors.secondaryForeground,
                opacity: startTime ? 1 : 0.7,
              }}
            >
              {formatTimeLabel(startTime)}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: fontSize.sm, color: colors.primaryForeground }}>End (optional)</Text>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Pressable onPress={() => openPicker("end-date")} style={fieldStyle}>
            <Text
              style={{
                fontSize: fontSize.base,
                color: colors.secondaryForeground,
                opacity: endDate ? 1 : 0.7,
              }}
            >
              {formatDateLabel(endDate)}
            </Text>
          </Pressable>
          <Pressable onPress={() => openPicker("end-time")} style={fieldStyle}>
            <Text
              style={{
                fontSize: fontSize.base,
                color: colors.secondaryForeground,
                opacity: endTime ? 1 : 0.7,
              }}
            >
              {formatTimeLabel(endTime)}
            </Text>
          </Pressable>
        </View>
      </View>

      {activePicker && (
        <View
          style={{
            borderWidth: 1,
            borderColor: colors.secondaryDark,
            borderRadius: borderRadius.md,
            overflow: "hidden",
            backgroundColor: colors.secondary,
          }}
        >
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
            <TouchableOpacity
              onPress={() => setActivePicker(null)}
              style={{
                paddingVertical: spacing.sm,
                alignItems: "center",
                borderTopWidth: 1,
                borderTopColor: colors.secondaryDark,
              }}
            >
              <Text style={{ fontSize: fontSize.base, color: colors.primary }}>
                Done
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: fontSize.sm, color: colors.primaryForeground }}>Location</Text>
        <TextInput
          value={location}
          onChangeText={setLocation}
          placeholder="Team facility or address"
          placeholderTextColor={colors.secondaryForeground}
          style={{
            borderWidth: 1,
            borderColor: colors.secondaryDark,
            borderRadius: borderRadius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            fontSize: fontSize.base,
            color: colors.secondaryForeground,
            backgroundColor: colors.secondary,
          }}
        />
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: fontSize.sm, color: colors.primaryForeground }}>Event type</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {EVENT_TYPE_OPTIONS.map((option) => {
            const selected = eventType === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => setEventType(option.value)}
                style={{
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primaryLight : colors.card,
                }}
              >
                <Text
                  style={{
                    fontSize: fontSize.sm,
                    color: selected ? colors.primaryForeground : colors.foreground,
                    fontWeight: selected ? fontWeight.semibold : fontWeight.normal,
                  }}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: fontSize.sm, color: colors.primaryForeground }}>Audience</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {AUDIENCE_OPTIONS.map((option) => {
            const selected = audience === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => setAudience(option.value)}
                style={{
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primaryLight : colors.card,
                }}
              >
                <Text
                  style={{
                    fontSize: fontSize.sm,
                    color: selected ? colors.primaryForeground : colors.foreground,
                    fontWeight: selected ? fontWeight.semibold : fontWeight.normal,
                  }}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {audience === "specific" && (
        <View style={{ gap: spacing.sm }}>
          <Text style={{ fontSize: fontSize.sm, color: colors.primaryForeground }}>Select recipients</Text>
          {loadingUsers ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {userOptions.map((user) => {
                const selected = targetUserIds.includes(user.id);
                return (
                  <Pressable
                    key={user.id}
                    onPress={() => toggleTargetUser(user.id)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: spacing.sm,
                      padding: spacing.sm,
                      borderRadius: borderRadius.md,
                      borderWidth: 1,
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.primaryLight : colors.card,
                    }}
                  >
                    <View
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 9,
                        borderWidth: 2,
                        borderColor: selected ? colors.primary : colors.mutedForeground,
                        backgroundColor: selected ? colors.primary : "transparent",
                      }}
                    />
                    <Text selectable style={{ fontSize: fontSize.base, color: colors.foreground }}>
                      {user.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      )}

      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: fontSize.sm, color: colors.primaryForeground }}>Notification channel</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {CHANNEL_OPTIONS.map((option) => {
            const selected = channel === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => setChannel(option.value)}
                style={{
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primaryLight : colors.card,
                }}
              >
                <Text
                  style={{
                    fontSize: fontSize.sm,
                    color: selected ? colors.primaryForeground : colors.foreground,
                    fontWeight: selected ? fontWeight.semibold : fontWeight.normal,
                  }}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text style={{ fontSize: fontSize.base, color: colors.foreground }}>
          Send notifications
        </Text>
        <Switch
          value={sendNotification}
          onValueChange={setSendNotification}
          trackColor={{ false: colors.border, true: colors.primaryLight }}
          thumbColor={sendNotification ? colors.primary : colors.card}
        />
      </View>

      <TouchableOpacity
        onPress={handleSubmit}
        disabled={isSaving}
        style={{
          backgroundColor: colors.primary,
          borderRadius: borderRadius.md,
          paddingVertical: spacing.sm,
          alignItems: "center",
          opacity: isSaving ? 0.7 : 1,
        }}
      >
        {isSaving ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text style={{ color: colors.primaryForeground, fontSize: fontSize.base, fontWeight: fontWeight.semibold }}>
            Create Event
          </Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}
