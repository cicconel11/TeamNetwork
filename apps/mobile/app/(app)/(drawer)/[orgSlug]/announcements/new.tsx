import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useNavigation } from "expo-router";
import { DrawerActions } from "@react-navigation/native";
import { supabase } from "@/lib/supabase";
import { track } from "@/lib/analytics";
import { useOrg } from "@/contexts/OrgContext";
import { fetchWithAuth } from "@/lib/web-api";
import { showToast } from "@/components/ui/Toast";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";

type Audience = "all" | "active_members" | "members" | "alumni" | "individuals";

type TargetUser = {
  id: string;
  label: string;
};

const AUDIENCE_OPTIONS: { value: Audience; label: string }[] = [
  { value: "all", label: "All Members" },
  { value: "active_members", label: "Active Members" },
  { value: "members", label: "Members" },
  { value: "alumni", label: "Alumni" },
  { value: "individuals", label: "Specific People" },
];

export default function NewAnnouncementScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { orgId, orgSlug, orgName, orgLogoUrl } = useOrg();
  const { neutral, semantic } = useAppColorScheme();
  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.background,
    },
    headerGradient: {
      // Gradient fills this area
    },
    headerSafeArea: {
      // SafeAreaView handles top inset
    },
    headerContent: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      minHeight: 44,
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
    optionList: {
      gap: SPACING.sm,
    },
    optionRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
      padding: SPACING.sm,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    optionRowSelected: {
      borderColor: s.success,
      backgroundColor: s.successLight,
    },
    optionIndicator: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 2,
      borderColor: n.muted,
      backgroundColor: "transparent",
    },
    optionIndicatorSelected: {
      borderColor: s.success,
      backgroundColor: s.success,
    },
    optionLabel: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
    },
    emptyText: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
    },
    switchGroup: {
      gap: SPACING.md,
    },
    switchRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
    },
    switchLabel: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
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
  const [body, setBody] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [audience, setAudience] = useState<Audience>("all");
  const [sendNotification, setSendNotification] = useState(true);
  const [targetUserIds, setTargetUserIds] = useState<string[]>([]);
  const [userOptions, setUserOptions] = useState<TargetUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const notificationAudience = useMemo(() => {
    if (audience === "all") return "both";
    if (audience === "active_members") return "members";
    if (audience === "individuals") return "both";
    return audience;
  }, [audience]);

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

    if (audience === "individuals" && targetUserIds.length === 0) {
      setError("Select at least one recipient.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const { data: userData } = await supabase.auth.getUser();
      const createdByUserId = userData.user?.id || null;
      const audienceUserIds = audience === "individuals" ? targetUserIds : null;

      const { data: announcement, error: insertError } = await supabase
        .from("announcements")
        .insert({
          organization_id: orgId,
          title: title.trim(),
          body: body.trim() || null,
          is_pinned: isPinned,
          published_at: new Date().toISOString(),
          created_by_user_id: createdByUserId,
          audience,
          audience_user_ids: audienceUserIds,
        })
        .select()
        .single();

      if (insertError || !announcement) {
        throw insertError || new Error("Failed to create announcement.");
      }

      if (sendNotification) {
        try {
          const response = await fetchWithAuth("/api/notifications/send", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              announcementId: announcement.id,
              channel: "all",
              audience: notificationAudience,
            }),
          });

          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            showToast(data?.error || "Failed to send notification", "error");
          }
        } catch (notifyError) {
          showToast("Failed to send notification", "error");
        }
      }

      track("announcement_created", {
        org_slug: orgSlug,
        audience,
        is_pinned: isPinned,
        has_body: !!(body.trim()),
        notification_sent: sendNotification,
      });
      router.push(`/(app)/${orgSlug}/(tabs)/announcements`);
    } catch (e) {
      setError((e as Error).message || "Failed to create announcement.");
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
            <Text style={styles.headerTitle}>Post Announcement</Text>
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
            <Text style={styles.formTitle}>Post Announcement</Text>
            <Text style={styles.formSubtitle}>Share updates with your team</Text>
          </View>

          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Title</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Team Meeting Rescheduled"
              placeholderTextColor={neutral.placeholder}
              style={styles.input}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Body</Text>
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="Write your announcement..."
              placeholderTextColor={neutral.placeholder}
              multiline
              textAlignVertical="top"
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

          {audience === "individuals" && (
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Select recipients</Text>
              {loadingUsers ? (
                <ActivityIndicator color={semantic.success} />
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

          <View style={styles.switchGroup}>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Pin announcement</Text>
              <Switch
                value={isPinned}
                onValueChange={setIsPinned}
                trackColor={{ false: neutral.border, true: semantic.successLight }}
                thumbColor={isPinned ? semantic.success : neutral.surface}
              />
            </View>

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Send notifications</Text>
              <Switch
                value={sendNotification}
                onValueChange={setSendNotification}
                trackColor={{ false: neutral.border, true: semantic.successLight }}
                thumbColor={sendNotification ? semantic.success : neutral.surface}
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
              <Text style={styles.primaryButtonText}>Post Announcement</Text>
            )}
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}
