import { useCallback, useEffect, useState } from "react";
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
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { supabase } from "@/lib/supabase";
import { fetchWithAuth } from "@/lib/web-api";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

type Audience = "members" | "alumni" | "both" | "specific";
type Channel = "email" | "sms" | "both";
type TargetUser = { id: string; label: string };

const AUDIENCE_OPTIONS: Array<{ value: Audience; label: string }> = [
  { value: "both", label: "Members + Alumni" },
  { value: "members", label: "Members only" },
  { value: "alumni", label: "Alumni only" },
  { value: "specific", label: "Specific individuals" },
];

const CHANNEL_OPTIONS: Array<{ value: Channel; label: string }> = [
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "both", label: "Email + SMS" },
];

export default function NewCompetitionScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { orgId, orgSlug, orgName, orgLogoUrl } = useOrg();
  const { isAdmin, isLoading: roleLoading } = useOrgRole();

  const [name, setName] = useState("Intersquad Competition");
  const [description, setDescription] = useState("");
  const [season, setSeason] = useState(String(new Date().getFullYear()));
  const [audience, setAudience] = useState<Audience>("both");
  const [channel, setChannel] = useState<Channel>("email");
  const [sendNotification, setSendNotification] = useState(true);
  const [userOptions, setUserOptions] = useState<TargetUser[]>([]);
  const [targetUserIds, setTargetUserIds] = useState<string[]>([]);
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

    const loadUsers = async () => {
      if (!orgId) return;
      setLoadingUsers(true);
      try {
        const { data, error: fetchError } = await supabase
          .from("user_organization_roles")
          .select("user_id, users(name,email)")
          .eq("organization_id", orgId)
          .eq("status", "active");

        if (fetchError) throw fetchError;

        const options =
          data?.map((row) => {
            const userInfo = Array.isArray(row.users) ? row.users[0] : row.users;
            return {
              id: row.user_id,
              label: userInfo?.name || userInfo?.email || "User",
            };
          }) || [];

        if (isMounted) {
          setUserOptions(options);
        }
      } catch (fetchError) {
        if (isMounted) {
          setError((fetchError as Error).message || "Failed to load recipients.");
        }
      } finally {
        if (isMounted) {
          setLoadingUsers(false);
        }
      }
    };

    loadUsers();
    return () => {
      isMounted = false;
    };
  }, [orgId]);

  const toggleTargetUser = useCallback((id: string) => {
    setTargetUserIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }, []);

  const handleSubmit = async () => {
    if (!orgId || !orgSlug) {
      setError("Organization not loaded yet.");
      return;
    }
    if (!name.trim()) {
      setError("Competition name is required.");
      return;
    }
    if (audience === "specific" && targetUserIds.length === 0) {
      setError("Select at least one recipient.");
      return;
    }

    setIsSaving(true);
    setError(null);

    const { data: competition, error: insertError } = await supabase
      .from("competitions")
      .insert({
        organization_id: orgId,
        name: name.trim(),
        description: description.trim() || null,
        season: season.trim() || null,
      })
      .select()
      .maybeSingle();

    if (insertError) {
      setError(insertError.message);
      setIsSaving(false);
      return;
    }

    if (sendNotification && competition) {
      const audienceValue = audience === "specific" ? "both" : audience;
      const targetIds = audience === "specific" ? targetUserIds : null;
      const seasonLine = season.trim() ? `Season: ${season.trim()}` : "";
      const notificationBody = [description.trim(), seasonLine].filter(Boolean).join("\n\n");

      try {
        const response = await fetchWithAuth("/api/notifications/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: orgId,
            title: `New Competition: ${name.trim()}`,
            body: notificationBody || "A new competition has been created.",
            channel,
            audience: audienceValue,
            targetUserIds: targetIds || undefined,
          }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          console.warn("Failed to send competition notification:", payload?.error || response.status);
        }
      } catch (notifError) {
        console.warn("Failed to send competition notification:", notifError);
      }
    }

    setIsSaving(false);
    router.push(`/(app)/${orgSlug}/competition`);
  };

  if (roleLoading) {
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
              <Text style={styles.headerTitle}>Create Competition</Text>
              <View style={styles.headerSpacer} />
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.centered}>
            <ActivityIndicator color={SEMANTIC.success} />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        </View>
      </View>
    );
  }

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
                  <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "O"}</Text>
                  </View>
                )}
              </Pressable>
              <Text style={styles.headerTitle}>Create Competition</Text>
              <View style={styles.headerSpacer} />
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>You do not have access to create competitions.</Text>
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
                <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "O"}</Text>
                </View>
              )}
            </Pressable>
            <Text style={styles.headerTitle}>Create Competition</Text>
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
            <Text style={styles.formTitle}>Create Competition</Text>
            <Text style={styles.formSubtitle}>Set up a new internal competition</Text>
          </View>

          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Competition name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g., Wagner Cup"
              placeholderTextColor={NEUTRAL.placeholder}
              style={styles.input}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Describe the competition and how points are earned..."
              placeholderTextColor={NEUTRAL.placeholder}
              multiline
              textAlignVertical="top"
              style={[styles.input, styles.textArea]}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Season</Text>
            <TextInput
              value={season}
              onChangeText={setSeason}
              placeholder="e.g., 2025, Fall 2025"
              placeholderTextColor={NEUTRAL.placeholder}
              style={styles.input}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Audience</Text>
            <View style={styles.chipRow}>
              {AUDIENCE_OPTIONS.map((option) => {
                const isSelected = audience === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setAudience(option.value)}
                    style={[styles.chip, isSelected && styles.chipSelected]}
                  >
                    <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
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
                    userOptions.map((userOption) => {
                      const selected = targetUserIds.includes(userOption.id);
                      return (
                        <Pressable
                          key={userOption.id}
                          onPress={() => toggleTargetUser(userOption.id)}
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
                          <Text style={styles.optionLabel}>{userOption.label}</Text>
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
                const isSelected = channel === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setChannel(option.value)}
                    style={[styles.chip, isSelected && styles.chipSelected]}
                  >
                    <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
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
              <Text style={styles.primaryButtonText}>Create Competition</Text>
            )}
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: SPACING.sm,
  },
  loadingText: {
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.muted,
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
