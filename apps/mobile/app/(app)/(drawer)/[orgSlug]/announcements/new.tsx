import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
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
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { fetchWithAuth } from "@/lib/web-api";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

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
              channel: "email,push",
              audience: notificationAudience,
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
              placeholderTextColor={NEUTRAL.placeholder}
              style={styles.input}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Body</Text>
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="Write your announcement..."
              placeholderTextColor={NEUTRAL.placeholder}
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

          <View style={styles.switchGroup}>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Pin announcement</Text>
              <Switch
                value={isPinned}
                onValueChange={setIsPinned}
                trackColor={{ false: NEUTRAL.border, true: SEMANTIC.successLight }}
                thumbColor={isPinned ? SEMANTIC.success : NEUTRAL.surface}
              />
            </View>

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
              <Text style={styles.primaryButtonText}>Post Announcement</Text>
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
      minHeight: 140,
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
