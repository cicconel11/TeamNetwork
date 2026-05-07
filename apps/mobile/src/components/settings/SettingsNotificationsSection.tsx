import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  TextInput,
  Pressable,
  Switch,
} from "react-native";
import { Bell, ChevronDown, Sun, Moon, Monitor } from "lucide-react-native";
import { useNotificationPreferences } from "@/hooks/useNotificationPreferences";
import { useAppColorScheme, type ColorSchemePreference } from "@/contexts/ColorSchemeContext";
import { buildSettingsColors } from "./settingsColors";
import { useBaseStyles, fontSize, fontWeight } from "./settingsShared";
import { useThemedStyles } from "@/hooks/useThemedStyles";

interface Props {
  orgId: string;
}

const APPEARANCE_OPTIONS: Array<{ value: ColorSchemePreference; label: string; Icon: typeof Sun }> = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "system", label: "System", Icon: Monitor },
  { value: "dark", label: "Dark", Icon: Moon },
];

export function SettingsNotificationsSection({ orgId }: Props) {
  const { prefs, loading: prefsLoading, saving: prefsSaving, updatePrefs } = useNotificationPreferences(orgId);
  const { preference, setPreference, neutral, semantic } = useAppColorScheme();
  const colors = useMemo(() => buildSettingsColors(neutral, semantic), [neutral, semantic]);
  const baseStyles = useBaseStyles();

  const [expanded, setExpanded] = useState(true);
  const [emailAddress, setEmailAddress] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [announcementPush, setAnnouncementPush] = useState(true);
  const [chatPush, setChatPush] = useState(true);
  const [eventReminderPush, setEventReminderPush] = useState(true);
  const [eventPush, setEventPush] = useState(false);
  const [workoutPush, setWorkoutPush] = useState(false);
  const [competitionPush, setCompetitionPush] = useState(false);
  const [discussionPush, setDiscussionPush] = useState(false);
  const [mentorshipPush, setMentorshipPush] = useState(false);
  const [donationPush, setDonationPush] = useState(false);

  useEffect(() => {
    if (prefs) {
      setEmailAddress(prefs.email_address || "");
      setEmailEnabled(prefs.email_enabled);
      setPushEnabled(prefs.push_enabled);
      setAnnouncementPush(prefs.announcement_push_enabled);
      setChatPush(prefs.chat_push_enabled);
      setEventReminderPush(prefs.event_reminder_push_enabled);
      setEventPush(prefs.event_push_enabled);
      setWorkoutPush(prefs.workout_push_enabled);
      setCompetitionPush(prefs.competition_push_enabled);
      setDiscussionPush(prefs.discussion_push_enabled);
      setMentorshipPush(prefs.mentorship_push_enabled);
      setDonationPush(prefs.donation_push_enabled);
    }
  }, [prefs]);

  const handleSaveNotifications = async () => {
    await updatePrefs({
      email_address: emailAddress.trim() || null,
      email_enabled: emailEnabled,
      push_enabled: pushEnabled,
      announcement_push_enabled: announcementPush,
      chat_push_enabled: chatPush,
      event_reminder_push_enabled: eventReminderPush,
      event_push_enabled: eventPush,
      workout_push_enabled: workoutPush,
      competition_push_enabled: competitionPush,
      discussion_push_enabled: discussionPush,
      mentorship_push_enabled: mentorshipPush,
      donation_push_enabled: donationPush,
    });
  };

  const styles = useThemedStyles((n, s) => ({
    fieldGroup: {
      marginBottom: 16,
    },
    fieldLabel: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: n.foreground,
      marginBottom: 8,
    },
    input: {
      backgroundColor: n.background,
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: 8,
      paddingVertical: 12,
      paddingHorizontal: 16,
      fontSize: fontSize.base,
      color: n.foreground,
      marginBottom: 12,
    },
    switchRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: n.border,
    },
    switchInfo: {
      flex: 1,
    },
    switchLabel: {
      fontSize: fontSize.base,
      color: n.foreground,
    },
    switchHint: {
      fontSize: 13,
      color: n.placeholder,
      marginTop: 2,
    },
    button: {
      backgroundColor: s.success,
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 8,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      marginTop: 16,
    },
    buttonText: {
      color: "#ffffff",
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
    },
    appearanceHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 4,
    },
    segmentedControl: {
      flexDirection: "row" as const,
      backgroundColor: n.surface,
      borderRadius: 10,
      padding: 4,
      gap: 4,
    },
    segmentOption: {
      flex: 1,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 4,
      borderRadius: 8,
    },
    segmentOptionSelected: {
      backgroundColor: n.background,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 2,
      elevation: 1,
      boxShadow: "0px 1px 2px rgba(0,0,0,0.08)",
    },
    segmentOptionText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: n.placeholder,
    },
    segmentOptionTextSelected: {
      color: s.success,
      fontWeight: fontWeight.semibold,
    },
  }));

  return (
    <>
      {/* Appearance section */}
      <View style={baseStyles.section}>
        <View style={styles.appearanceHeader}>
          <Monitor size={20} color={colors.muted} />
          <Text style={baseStyles.sectionTitle}>Appearance</Text>
        </View>
        <View style={styles.segmentedControl}>
          {APPEARANCE_OPTIONS.map(({ value, label, Icon }) => {
            const selected = preference === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={`${label} theme`}
                style={({ pressed }) => [
                  styles.segmentOption,
                  selected && styles.segmentOptionSelected,
                  pressed && !selected && { opacity: 0.6 },
                ]}
                onPress={() => setPreference(value)}
              >
                <Icon
                  size={16}
                  color={selected ? colors.primary : colors.mutedForeground}
                />
                <Text
                  style={[
                    styles.segmentOptionText,
                    selected && styles.segmentOptionTextSelected,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Notifications section */}
      <View style={baseStyles.section}>
      <Pressable
        style={({ pressed }) => [baseStyles.sectionHeader, pressed && { opacity: 0.7 }]}
        onPress={() => setExpanded((prev) => !prev)}
      >
        <View style={baseStyles.sectionHeaderLeft}>
          <Bell size={20} color={colors.muted} />
          <Text style={baseStyles.sectionTitle}>Notifications</Text>
        </View>
        <ChevronDown
          size={20}
          color={colors.mutedForeground}
          style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
        />
      </Pressable>

      {expanded && (
        <View style={baseStyles.card}>
          {prefsLoading ? (
            <View style={baseStyles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Email Address</Text>
                <TextInput
                  style={styles.input}
                  value={emailAddress}
                  onChangeText={setEmailAddress}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.switchRow}>
                <View style={styles.switchInfo}>
                  <Text style={styles.switchLabel}>Email Notifications</Text>
                  <Text style={styles.switchHint}>Receive updates via email</Text>
                </View>
                <Switch
                  value={emailEnabled}
                  onValueChange={setEmailEnabled}
                  trackColor={{ false: colors.border, true: colors.primaryLight }}
                  thumbColor={emailEnabled ? colors.primary : colors.card}
                />
              </View>

              <View style={styles.switchRow}>
                <View style={styles.switchInfo}>
                  <Text style={styles.switchLabel}>Push Notifications</Text>
                  <Text style={styles.switchHint}>Master switch for all push categories</Text>
                </View>
                <Switch
                  value={pushEnabled}
                  onValueChange={setPushEnabled}
                  trackColor={{ false: colors.border, true: colors.primaryLight }}
                  thumbColor={pushEnabled ? colors.primary : colors.card}
                />
              </View>

              <View style={[styles.switchRow, !pushEnabled && { opacity: 0.5 }]}>
                <View style={styles.switchInfo}>
                  <Text style={styles.switchLabel}>Announcements</Text>
                  <Text style={styles.switchHint}>New announcements posted to your org</Text>
                </View>
                <Switch
                  value={announcementPush}
                  onValueChange={setAnnouncementPush}
                  disabled={!pushEnabled}
                  trackColor={{ false: colors.border, true: colors.primaryLight }}
                  thumbColor={announcementPush ? colors.primary : colors.card}
                />
              </View>

              <View style={[styles.switchRow, !pushEnabled && { opacity: 0.5 }]}>
                <View style={styles.switchInfo}>
                  <Text style={styles.switchLabel}>Chat mentions</Text>
                  <Text style={styles.switchHint}>When someone @mentions you</Text>
                </View>
                <Switch
                  value={chatPush}
                  onValueChange={setChatPush}
                  disabled={!pushEnabled}
                  trackColor={{ false: colors.border, true: colors.primaryLight }}
                  thumbColor={chatPush ? colors.primary : colors.card}
                />
              </View>

              <View style={[styles.switchRow, !pushEnabled && { opacity: 0.5 }]}>
                <View style={styles.switchInfo}>
                  <Text style={styles.switchLabel}>Event reminders</Text>
                  <Text style={styles.switchHint}>1 hour and 24 hours before events you&apos;re attending</Text>
                </View>
                <Switch
                  value={eventReminderPush}
                  onValueChange={setEventReminderPush}
                  disabled={!pushEnabled}
                  trackColor={{ false: colors.border, true: colors.primaryLight }}
                  thumbColor={eventReminderPush ? colors.primary : colors.card}
                />
              </View>

              <View style={[styles.switchRow, !pushEnabled && { opacity: 0.5 }]}>
                <View style={styles.switchInfo}>
                  <Text style={styles.switchLabel}>New events</Text>
                  <Text style={styles.switchHint}>When admins post a new event</Text>
                </View>
                <Switch
                  value={eventPush}
                  onValueChange={setEventPush}
                  disabled={!pushEnabled}
                  trackColor={{ false: colors.border, true: colors.primaryLight }}
                  thumbColor={eventPush ? colors.primary : colors.card}
                />
              </View>

              <View style={[styles.switchRow, !pushEnabled && { opacity: 0.5 }]}>
                <View style={styles.switchInfo}>
                  <Text style={styles.switchLabel}>Workouts</Text>
                  <Text style={styles.switchHint}>New training plans and workouts</Text>
                </View>
                <Switch
                  value={workoutPush}
                  onValueChange={setWorkoutPush}
                  disabled={!pushEnabled}
                  trackColor={{ false: colors.border, true: colors.primaryLight }}
                  thumbColor={workoutPush ? colors.primary : colors.card}
                />
              </View>

              <View style={[styles.switchRow, !pushEnabled && { opacity: 0.5 }]}>
                <View style={styles.switchInfo}>
                  <Text style={styles.switchLabel}>Competitions</Text>
                  <Text style={styles.switchHint}>Meet results and competition updates</Text>
                </View>
                <Switch
                  value={competitionPush}
                  onValueChange={setCompetitionPush}
                  disabled={!pushEnabled}
                  trackColor={{ false: colors.border, true: colors.primaryLight }}
                  thumbColor={competitionPush ? colors.primary : colors.card}
                />
              </View>

              <View style={[styles.switchRow, !pushEnabled && { opacity: 0.5 }]}>
                <View style={styles.switchInfo}>
                  <Text style={styles.switchLabel}>Discussions</Text>
                  <Text style={styles.switchHint}>Replies to threads you participate in</Text>
                </View>
                <Switch
                  value={discussionPush}
                  onValueChange={setDiscussionPush}
                  disabled={!pushEnabled}
                  trackColor={{ false: colors.border, true: colors.primaryLight }}
                  thumbColor={discussionPush ? colors.primary : colors.card}
                />
              </View>

              <View style={[styles.switchRow, !pushEnabled && { opacity: 0.5 }]}>
                <View style={styles.switchInfo}>
                  <Text style={styles.switchLabel}>Mentorship</Text>
                  <Text style={styles.switchHint}>Mentorship requests and pair updates</Text>
                </View>
                <Switch
                  value={mentorshipPush}
                  onValueChange={setMentorshipPush}
                  disabled={!pushEnabled}
                  trackColor={{ false: colors.border, true: colors.primaryLight }}
                  thumbColor={mentorshipPush ? colors.primary : colors.card}
                />
              </View>

              <View style={[styles.switchRow, !pushEnabled && { opacity: 0.5 }]}>
                <View style={styles.switchInfo}>
                  <Text style={styles.switchLabel}>Donations</Text>
                  <Text style={styles.switchHint}>New donations to your org (admins only)</Text>
                </View>
                <Switch
                  value={donationPush}
                  onValueChange={setDonationPush}
                  disabled={!pushEnabled}
                  trackColor={{ false: colors.border, true: colors.primaryLight }}
                  thumbColor={donationPush ? colors.primary : colors.card}
                />
              </View>

              <Pressable
                style={styles.button}
                onPress={handleSaveNotifications}
                disabled={prefsSaving}
              >
                {prefsSaving ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : (
                  <Text style={styles.buttonText}>Save Preferences</Text>
                )}
              </Pressable>
            </>
          )}
        </View>
      )}
      </View>
    </>
  );
}
