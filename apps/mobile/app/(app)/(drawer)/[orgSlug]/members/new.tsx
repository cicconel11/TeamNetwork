import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useNavigation } from "expo-router";
import { DrawerActions } from "@react-navigation/native";
import QRCode from "react-native-qrcode-svg";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { getWebAppUrl } from "@/lib/web-api";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

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
              placeholderTextColor={NEUTRAL.placeholder}
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
              placeholderTextColor={NEUTRAL.placeholder}
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
              <Text style={styles.inviteTitle}>Invite Ready</Text>
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
                    <QRCode value={inviteLink} size={180} />
                    <Text style={styles.qrHint}>Scan to join</Text>
                  </View>
                </>
              )}
              <View style={styles.inviteActions}>
                <Pressable
                  onPress={handleShare}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && styles.secondaryButtonPressed,
                  ]}
                >
                  <Text style={styles.secondaryButtonText}>Share Link</Text>
                </Pressable>
                <Pressable
                  onPress={() => router.push(`/(app)/${orgSlug}/(tabs)/members`)}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && styles.secondaryButtonPressed,
                  ]}
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
  inviteCard: {
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    gap: SPACING.sm,
    backgroundColor: NEUTRAL.surface,
  },
  inviteTitle: {
    ...TYPOGRAPHY.titleMedium,
    color: NEUTRAL.foreground,
  },
  inviteCode: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.foreground,
  },
  inviteLink: {
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.muted,
  },
  qrContainer: {
    alignItems: "center",
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: NEUTRAL.background,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
  },
  qrHint: {
    marginTop: SPACING.sm,
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.muted,
  },
  inviteActions: {
    flexDirection: "row",
    gap: SPACING.sm,
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm,
    alignItems: "center",
    backgroundColor: NEUTRAL.surface,
  },
  secondaryButtonPressed: {
    opacity: 0.9,
  },
  secondaryButtonText: {
    ...TYPOGRAPHY.labelMedium,
    color: NEUTRAL.foreground,
  },
});
