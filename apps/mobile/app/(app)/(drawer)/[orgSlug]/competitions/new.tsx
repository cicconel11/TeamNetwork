import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import { supabase } from "@/lib/supabase";
import { fetchWithAuth } from "@/lib/web-api";
import { borderRadius, fontSize, fontWeight, spacing, type ThemeColors } from "@/lib/theme";

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
  const { orgId, orgSlug } = useOrg();
  const { isAdmin, isLoading: roleLoading } = useOrgRole();
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
      >
        <Stack.Screen options={{ title: "Create Competition" }} />
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </ScrollView>
    );
  }

  if (!isAdmin) {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
      >
        <Stack.Screen options={{ title: "Create Competition" }} />
        <View style={styles.errorCard}>
          <Text selectable style={styles.errorText}>
            You do not have access to create competitions.
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: "Create Competition" }} />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Create Competition</Text>
        <Text style={styles.headerSubtitle}>Set up a new internal competition</Text>
      </View>

      {error ? (
        <View style={styles.errorCard}>
          <Text selectable style={styles.errorText}>
            {error}
          </Text>
        </View>
      ) : null}

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Competition name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g., Wagner Cup"
          placeholderTextColor={colors.mutedForeground}
          style={styles.input}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Description</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Describe the competition and how points are earned..."
          placeholderTextColor={colors.mutedForeground}
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
          placeholderTextColor={colors.mutedForeground}
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
                style={({ pressed }) => [
                  styles.chip,
                  isSelected && { backgroundColor: colors.primary, borderColor: colors.primary },
                  pressed && styles.chipPressed,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    isSelected && { color: colors.primaryForeground },
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {audience === "specific" ? (
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Select recipients</Text>
          {loadingUsers ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <View style={styles.recipientList}>
              {userOptions.length === 0 ? (
                <Text style={styles.emptyText}>No users available.</Text>
              ) : (
                userOptions.map((userOption) => {
                  const selected = targetUserIds.includes(userOption.id);
                  return (
                    <Pressable
                      key={userOption.id}
                      onPress={() => toggleTargetUser(userOption.id)}
                      style={({ pressed }) => [
                        styles.recipientRow,
                        selected && {
                          borderColor: colors.primary,
                          backgroundColor: colors.primaryLight,
                        },
                        pressed && styles.recipientRowPressed,
                      ]}
                    >
                      <View
                        style={[
                          styles.recipientIndicator,
                          selected && { borderColor: colors.primary, backgroundColor: colors.primary },
                        ]}
                      />
                      <Text style={styles.recipientLabel}>{userOption.label}</Text>
                    </Pressable>
                  );
                })
              )}
            </View>
          )}
        </View>
      ) : null}

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Notification channel</Text>
        <View style={styles.chipRow}>
          {CHANNEL_OPTIONS.map((option) => {
            const isSelected = channel === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => setChannel(option.value)}
                style={({ pressed }) => [
                  styles.chip,
                  isSelected && { backgroundColor: colors.primary, borderColor: colors.primary },
                  pressed && styles.chipPressed,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    isSelected && { color: colors.primaryForeground },
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Send notifications</Text>
        <Switch
          value={sendNotification}
          onValueChange={setSendNotification}
          trackColor={{ false: colors.border, true: colors.primaryLight }}
          thumbColor={sendNotification ? colors.primary : colors.card}
        />
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
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text style={styles.primaryButtonText}>Create competition</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      padding: spacing.md,
      paddingBottom: spacing.xl,
      gap: spacing.lg,
    },
    header: {
      gap: spacing.xs,
    },
    headerTitle: {
      fontSize: fontSize["2xl"],
      fontWeight: fontWeight.bold,
      color: colors.foreground,
    },
    headerSubtitle: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    errorCard: {
      backgroundColor: `${colors.error}14`,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: `${colors.error}55`,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: colors.error,
    },
    loadingState: {
      alignItems: "center",
      gap: spacing.sm,
    },
    loadingText: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    fieldGroup: {
      gap: spacing.xs,
    },
    fieldLabel: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: fontSize.base,
      color: colors.foreground,
      backgroundColor: colors.background,
    },
    textArea: {
      minHeight: 120,
    },
    chipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    chipPressed: {
      opacity: 0.85,
    },
    chipText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    recipientList: {
      gap: spacing.sm,
    },
    recipientRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      padding: spacing.sm,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    recipientRowPressed: {
      opacity: 0.85,
    },
    recipientIndicator: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 2,
      borderColor: colors.mutedForeground,
      backgroundColor: "transparent",
    },
    recipientLabel: {
      fontSize: fontSize.base,
      color: colors.foreground,
      flex: 1,
    },
    emptyText: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    toggleLabel: {
      fontSize: fontSize.base,
      color: colors.foreground,
    },
    primaryButton: {
      backgroundColor: colors.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.sm,
      alignItems: "center",
      borderCurve: "continuous",
    },
    primaryButtonPressed: {
      opacity: 0.9,
    },
    primaryButtonText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.primaryForeground,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
  });
