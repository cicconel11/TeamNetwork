import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useNavigation, useRouter } from "expo-router";
import { Send } from "lucide-react-native";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { fetchWithAuth } from "@/lib/web-api";
import { showToast } from "@/components/ui/Toast";
import { APP_CHROME } from "@/lib/chrome";
import {
  buildNotificationComposerPayload,
  getNotificationComposerErrorMessage,
  getNotificationsPath,
} from "@/lib/schedules/mobile-schedule-settings";
import type { NotificationAudience } from "@teammeet/types";
import type { ComposerChannel } from "@/lib/schedules/mobile-schedule-settings";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useThemedStyles } from "@/hooks/useThemedStyles";

const AUDIENCE_OPTIONS: Array<{ value: NotificationAudience; label: string }> = [
  { value: "both", label: "Members + Alumni" },
  { value: "members", label: "Members" },
  { value: "alumni", label: "Alumni" },
];

const CHANNEL_OPTIONS: Array<{ value: ComposerChannel; label: string }> = [
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "push", label: "Push" },
  { value: "both", label: "Email + SMS" },
  { value: "all", label: "All channels" },
];

export default function NewNotificationScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { orgId, orgSlug, orgName, orgLogoUrl } = useOrg();
  const { isAdmin } = useOrgRole();

  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.background,
    },
    headerGradient: {},
    headerSafeArea: {},
    headerContent: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      minHeight: 44,
      gap: SPACING.sm,
    },
    orgLogoButton: {
      width: 36,
      height: 36,
      borderRadius: 8,
      overflow: "hidden" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
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
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    orgAvatarText: {
      ...TYPOGRAPHY.titleMedium,
      color: APP_CHROME.headerTitle,
    },
    headerTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
      flex: 1,
      textAlign: "center" as const,
    },
    headerSpacer: {
      width: 36,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
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
      color: n.foreground,
    },
    formSubtitle: {
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
      textAlignVertical: "top" as const,
    },
    chipRow: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: SPACING.sm,
    },
    chip: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs,
      borderRadius: RADIUS.full,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    chipSelected: {
      borderColor: s.success,
      backgroundColor: s.successLight,
    },
    chipText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
    },
    chipTextSelected: {
      color: s.successDark,
      fontWeight: "600" as const,
    },
    primaryButton: {
      backgroundColor: s.success,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.md,
      alignItems: "center" as const,
      flexDirection: "row" as const,
      justifyContent: "center" as const,
      gap: SPACING.sm,
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
    infoCard: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
      backgroundColor: n.background,
      gap: SPACING.xs,
    },
    infoTitle: {
      ...TYPOGRAPHY.titleSmall,
      color: n.foreground,
    },
    infoText: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
    },
  }));

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<NotificationAudience>("both");
  const [channel, setChannel] = useState<ComposerChannel>("email");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // no-op
    }
  }, [navigation]);

  const handleSubmit = useCallback(async () => {
    if (!orgId || !orgSlug) {
      setError("Organization not loaded yet.");
      return;
    }

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }

    if (!isAdmin) {
      setError("Only admins can send notifications.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetchWithAuth("/api/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildNotificationComposerPayload(orgId, {
            title,
            body,
            audience,
            channel,
          })
        ),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(getNotificationComposerErrorMessage(response.status, payload));
      }

      showToast("Notification sent", "success");
      router.replace(getNotificationsPath(orgSlug, { refresh: true }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsSaving(false);
    }
  }, [audience, body, channel, isAdmin, orgId, orgSlug, router, title]);

  const isDisabled = useMemo(() => isSaving || !title.trim(), [isSaving, title]);

  if (!isAdmin) {
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
                  <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "N"}</Text>
                  </View>
                )}
              </Pressable>
              <Text style={styles.headerTitle}>Send Notification</Text>
              <View style={styles.headerSpacer} />
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.scrollContent}>
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>Only admins can send notifications.</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

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
                <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "N"}</Text>
                </View>
              )}
            </Pressable>
            <Text style={styles.headerTitle}>Send Notification</Text>
            <View style={styles.headerSpacer} />
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.contentSheet}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>Compose a team notification</Text>
            <Text style={styles.formSubtitle}>
              Send by email, SMS, push, or all channels to the selected audience.
            </Text>
          </View>

          {error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Title</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Team meeting tomorrow"
              placeholderTextColor={APP_CHROME.headerMeta}
              style={styles.input}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Message</Text>
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="Add the details your team needs to know."
              placeholderTextColor={APP_CHROME.headerMeta}
              multiline
              style={[styles.input, styles.textArea]}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Audience</Text>
            <View style={styles.chipRow}>
              {AUDIENCE_OPTIONS.map((option) => {
                const selected = audience === option.value;
                return (
                  <Pressable
                    key={option.value}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => setAudience(option.value)}
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
            <Text style={styles.fieldLabel}>Channel</Text>
            <View style={styles.chipRow}>
              {CHANNEL_OPTIONS.map((option) => {
                const selected = channel === option.value;
                return (
                  <Pressable
                    key={option.value}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => setChannel(option.value)}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>What stays on web</Text>
            <Text style={styles.infoText}>
              Advanced recipient targeting, approval workflows, and more complex notification flows remain on web in this phase.
            </Text>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
              isDisabled && styles.buttonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={isDisabled}
          >
            {isSaving ? <ActivityIndicator color="#ffffff" /> : <Send size={18} color="#ffffff" />}
            <Text style={styles.primaryButtonText}>Send Notification</Text>
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}
