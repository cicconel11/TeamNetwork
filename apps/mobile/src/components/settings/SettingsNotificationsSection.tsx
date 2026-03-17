import React, { useState, useEffect } from "react";
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
  const colors = buildSettingsColors(neutral, semantic);
  const baseStyles = useBaseStyles();

  const [expanded, setExpanded] = useState(true);
  const [emailAddress, setEmailAddress] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(true);

  useEffect(() => {
    if (prefs) {
      setEmailAddress(prefs.email_address || "");
      setEmailEnabled(prefs.email_enabled);
      setPushEnabled(prefs.push_enabled);
    }
  }, [prefs]);

  const handleSaveNotifications = async () => {
    await updatePrefs({
      email_address: emailAddress.trim() || null,
      email_enabled: emailEnabled,
      push_enabled: pushEnabled,
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
                  <Text style={styles.switchHint}>Announcements and events</Text>
                </View>
                <Switch
                  value={pushEnabled}
                  onValueChange={setPushEnabled}
                  trackColor={{ false: colors.border, true: colors.primaryLight }}
                  thumbColor={pushEnabled ? colors.primary : colors.card}
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
