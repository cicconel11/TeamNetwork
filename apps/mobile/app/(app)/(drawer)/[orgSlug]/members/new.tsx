import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useNavigation } from "expo-router";
import { DrawerActions } from "@react-navigation/native";
import { SafeQRCode } from "@/components/SafeQRCode";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { getWebAppUrl } from "@/lib/web-api";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";

type InviteRole = "active_member" | "admin" | "alumni";

type InviteRecord = {
  id: string;
  code: string | null;
  token: string | null;
  role: string;
  uses_remaining: number | null;
  expires_at: string | null;
};

const ROLE_OPTIONS: { value: InviteRole; label: string }[] = [
  { value: "active_member", label: "Active Member" },
  { value: "alumni", label: "Alumni" },
  { value: "admin", label: "Admin" },
];

export default function NewMemberInviteScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { orgId, orgSlug, orgName, orgLogoUrl } = useOrg();

  const [role, setRole] = useState<InviteRole>("active_member");
  const [uses, setUses] = useState("");
  const [expires, setExpires] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteRecord | null>(null);

  const { neutral } = useAppColorScheme();
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
    inviteCard: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.lg,
      padding: SPACING.md,
      gap: SPACING.sm,
      backgroundColor: n.surface,
    },
    inviteCardTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
    },
    inviteCode: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
    },
    inviteLink: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
    },
    qrContainer: {
      alignItems: "center" as const,
      paddingVertical: SPACING.sm,
      borderRadius: RADIUS.md,
      backgroundColor: n.background,
      borderWidth: 1,
      borderColor: n.border,
    },
    qrHint: {
      marginTop: SPACING.sm,
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
    },
    inviteActions: {
      flexDirection: "row" as const,
      gap: SPACING.sm,
    },
    secondaryButton: {
      flex: 1,
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.sm,
      alignItems: "center" as const,
      backgroundColor: n.surface,
    },
    secondaryButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
    },
  }));

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {}
  }, [navigation]);

  const inviteLink = useMemo(() => {
    if (!invite) return null;
    const base = getWebAppUrl();
    if (invite.token) {
      return `${base}/app/join?token=${invite.token}`;
    }
    if (invite.code) {
      return `${base}/app/join?code=${invite.code}`;
    }
    return null;
  }, [invite]);

  const handleShare = async () => {
    if (!inviteLink) return;
    try {
      await Share.share({ message: inviteLink });
    } catch (shareError) {
      console.warn("Share failed:", shareError);
    }
  };

  const handleSubmit = async () => {
    if (!orgId) {
      setError("Organization not loaded yet.");
      return;
    }

    const usesValue = uses.trim() ? Number(uses.trim()) : null;
    if (usesValue !== null && (!Number.isFinite(usesValue) || usesValue <= 0)) {
      setError("Uses must be a positive number.");
      return;
    }

    let expiresAt: string | null = null;
    if (expires.trim()) {
      const parsed = new Date(`${expires.trim()}T00:00:00`);
      if (Number.isNaN(parsed.getTime())) {
        setError("Enter a valid expiration date.");
        return;
      }
      expiresAt = parsed.toISOString();
    }

    setIsSaving(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc("create_org_invite", {
        p_organization_id: orgId,
        p_role: role,
        p_uses: usesValue ?? undefined,
        p_expires_at: expiresAt ?? undefined,
      });

      if (rpcError || !data) {
        throw rpcError || new Error("Failed to create invite.");
      }

      setInvite(data as InviteRecord);
    } catch (e) {
      setError((e as Error).message || "Failed to create invite.");
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
            <Text style={styles.headerTitle}>Invite Member</Text>
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
            <Text style={styles.formTitle}>Create Invite</Text>
            <Text style={styles.formSubtitle}>Generate a link to invite new members</Text>
          </View>

          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Role</Text>
            <View style={styles.chipRow}>
              {ROLE_OPTIONS.map((option) => {
                const selected = role === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setRole(option.value)}
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
            <Text style={styles.fieldLabel}>Uses (optional)</Text>
            <TextInput
              value={uses}
              onChangeText={setUses}
              placeholder="Unlimited"
              placeholderTextColor={neutral.placeholder}
              keyboardType="number-pad"
              style={styles.input}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Expires on (optional)</Text>
            <TextInput
              value={expires}
              onChangeText={setExpires}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={neutral.placeholder}
              style={styles.input}
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
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>Create Invite</Text>
            )}
          </Pressable>

          {invite && (
            <View style={styles.inviteCard}>
              <Text style={styles.inviteCardTitle}>Invite ready</Text>
              {invite.code && (
                <Text selectable style={styles.inviteCode}>
                  Code: {invite.code}
                </Text>
              )}
              {inviteLink && (
                <>
                  <Text selectable style={styles.inviteLink}>
                    {inviteLink}
                  </Text>
                  <View style={styles.qrContainer}>
                    <SafeQRCode value={inviteLink} size={180} />
                    <Text style={styles.qrHint}>Scan to join</Text>
                  </View>
                </>
              )}
              <View style={styles.inviteActions}>
                <Pressable onPress={handleShare} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Share Link</Text>
                </Pressable>
                <Pressable
                  onPress={() => router.push(`/(app)/${orgSlug}/(tabs)/members`)}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryButtonText}>Done</Text>
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
}
