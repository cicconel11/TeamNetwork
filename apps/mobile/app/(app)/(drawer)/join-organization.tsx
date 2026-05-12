import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  redeemInviteWithFallback,
  completeEnterpriseInviteRedemption,
  type AvailableOrg,
  type InviteFlow,
  type RedeemResult,
} from "@teammeet/core/invites";
import { supabase } from "@/lib/supabase";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { useOrganizations } from "@/hooks/useOrganizations";
import { showToast } from "@/components/ui/Toast";

const normalizeCode = (raw: string): string =>
  raw.toUpperCase().replace(/[^A-Z0-9-]/g, "");

export default function JoinOrganizationScreen() {
  const router = useRouter();
  const { neutral } = useAppColorScheme();
  const { refetch: refetchOrganizations } = useOrganizations();
  const params = useLocalSearchParams<{
    token?: string;
    code?: string;
    invite?: string;
  }>();
  const tokenParam = typeof params.token === "string" ? params.token : undefined;
  const codeParam = typeof params.code === "string" ? params.code : undefined;
  const inviteTypeParam =
    typeof params.invite === "string" ? params.invite : undefined;

  const [code, setCode] = useState<string>(codeParam ? normalizeCode(codeParam) : "");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<{ orgName: string } | null>(
    null,
  );
  const [chooseOrgState, setChooseOrgState] = useState<{
    organizations: AvailableOrg[];
    role: string;
    inviteToken: string;
  } | null>(null);

  const autoRedeemRef = useRef(false);

  const handleSuccess = useCallback(
    async (result: RedeemResult) => {
      try {
        await refetchOrganizations();
      } catch {
        // best-effort — the user can still navigate manually
      }
      const slug = result.slug ?? result.organization_slug;
      if (slug) {
        showToast(`Joined ${result.name ?? "organization"}`, "success");
        router.replace(`/(app)/(drawer)/${slug}/(tabs)` as never);
      } else {
        router.replace("/(app)/(drawer)" as never);
      }
    },
    [refetchOrganizations, router],
  );

  const applyResult = useCallback(
    async (result: RedeemResult) => {
      if (
        result.status === "choose_org" &&
        result.organizations &&
        result.invite_token
      ) {
        setChooseOrgState({
          organizations: result.organizations,
          role: result.role || "active_member",
          inviteToken: result.invite_token,
        });
        return;
      }

      if (result.already_member) {
        if (result.status === "pending") {
          setPendingApproval({ orgName: result.name || "the organization" });
        } else {
          showToast("You're already a member of this organization.", "info");
          await handleSuccess(result);
        }
        return;
      }

      if (result.pending_approval) {
        setPendingApproval({ orgName: result.name || "the organization" });
        return;
      }

      await handleSuccess(result);
    },
    [handleSuccess],
  );

  const redeem = useCallback(
    async (codeOrToken: string, preferredFlow: InviteFlow = "org") => {
      setIsLoading(true);
      setError(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("You must be signed in to join an organization.");
        setIsLoading(false);
        return;
      }

      const { result, rpcError } = await redeemInviteWithFallback(
        supabase,
        codeOrToken,
        preferredFlow,
      );

      if (rpcError) {
        setError(rpcError);
        setIsLoading(false);
        return;
      }

      if (!result?.success) {
        setError(result?.error || "Failed to join organization.");
        setIsLoading(false);
        return;
      }

      await applyResult(result);
      setIsLoading(false);
    },
    [applyResult],
  );

  useEffect(() => {
    if (autoRedeemRef.current) return;
    if (!tokenParam) return;
    autoRedeemRef.current = true;
    const preferred: InviteFlow =
      inviteTypeParam === "enterprise" ? "enterprise" : "org";
    void redeem(tokenParam, preferred);
  }, [tokenParam, inviteTypeParam, redeem]);

  const handleSubmit = useCallback(() => {
    const trimmed = code.trim();
    if (!trimmed) {
      setError("Invite code is required.");
      return;
    }
    void redeem(trimmed, "org");
  }, [code, redeem]);

  const handleOrgSelected = useCallback(
    async (orgId: string) => {
      if (!chooseOrgState) return;
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(orgId)) {
        setError("Invalid organization selection.");
        return;
      }

      setIsLoading(true);
      setError(null);

      const { result, rpcError } = await completeEnterpriseInviteRedemption(
        supabase,
        chooseOrgState.inviteToken,
        orgId,
      );

      if (rpcError) {
        setError(rpcError);
        setIsLoading(false);
        return;
      }

      if (!result?.success) {
        setError(result?.error || "Failed to join organization.");
        setIsLoading(false);
        return;
      }

      await handleSuccess(result);
      setIsLoading(false);
    },
    [chooseOrgState, handleSuccess],
  );

  const handleCancel = useCallback(() => {
    router.back();
  }, [router]);

  const styles = useThemedStyles((n, s) => ({
    container: { flex: 1, backgroundColor: n.background },
    sheetHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.md,
      paddingBottom: SPACING.sm,
      minHeight: 48,
      backgroundColor: n.surface,
      borderBottomWidth: 1,
      borderBottomColor: n.border,
    },
    headerSideButton: {
      paddingVertical: SPACING.xs,
      paddingRight: SPACING.sm,
      minWidth: 56,
    },
    headerSideButtonText: { ...TYPOGRAPHY.bodyMedium, color: n.foreground },
    headerTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
      flex: 1,
      textAlign: "center" as const,
      fontWeight: "600" as const,
    },
    headerSpacer: { width: 56 },
    contentSheet: { flex: 1, backgroundColor: n.surface },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: SPACING.xxl,
      gap: SPACING.lg,
    },
    heading: { ...TYPOGRAPHY.titleLarge, color: n.foreground },
    subhead: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.muted,
      marginTop: SPACING.xs,
    },
    fieldLabel: { ...TYPOGRAPHY.labelMedium, color: n.secondary },
    input: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.md,
      fontSize: 22,
      letterSpacing: 4,
      fontVariant: ["tabular-nums"] as const,
      textAlign: "center" as const,
      color: n.foreground,
      backgroundColor: n.surface,
    },
    errorCard: {
      backgroundColor: s.errorLight,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
      borderWidth: 1,
      borderColor: s.error,
    },
    errorText: { ...TYPOGRAPHY.bodySmall, color: s.error },
    pendingCard: {
      backgroundColor: s.warningLight,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
      borderWidth: 1,
      borderColor: s.warning,
      gap: SPACING.xs,
    },
    pendingTitle: {
      ...TYPOGRAPHY.labelLarge,
      color: s.warningDark,
      fontWeight: "600" as const,
    },
    pendingBody: { ...TYPOGRAPHY.bodySmall, color: s.warningDark },
    orgRow: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
      backgroundColor: n.surface,
      gap: 2,
    },
    orgName: { ...TYPOGRAPHY.labelLarge, color: n.foreground },
    orgDescription: { ...TYPOGRAPHY.bodySmall, color: n.muted },
    primaryButton: {
      backgroundColor: s.success,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.md,
      alignItems: "center" as const,
    },
    primaryButtonPressed: { opacity: 0.9 },
    primaryButtonText: { ...TYPOGRAPHY.labelLarge, color: "#ffffff" },
    secondaryButton: {
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.md,
      alignItems: "center" as const,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    secondaryButtonText: { ...TYPOGRAPHY.labelLarge, color: n.foreground },
    buttonDisabled: { opacity: 0.6 },
    helperText: { ...TYPOGRAPHY.labelSmall, color: n.muted },
  }));

  const renderBody = () => {
    if (chooseOrgState) {
      return (
        <>
          <View>
            <Text style={styles.heading}>Choose an organization</Text>
            <Text style={styles.subhead}>
              Your invite gives access to multiple organizations. Pick one to
              join.
            </Text>
          </View>
          {error != null && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
          <View style={{ gap: SPACING.sm }}>
            {chooseOrgState.organizations.map((org) => (
              <Pressable
                key={org.id}
                onPress={() => handleOrgSelected(org.id)}
                disabled={isLoading}
                style={({ pressed }) => [
                  styles.orgRow,
                  pressed && styles.primaryButtonPressed,
                  isLoading && styles.buttonDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Join ${org.name}`}
              >
                <Text style={styles.orgName}>{org.name}</Text>
                {org.description ? (
                  <Text style={styles.orgDescription}>{org.description}</Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        </>
      );
    }

    if (pendingApproval) {
      return (
        <>
          <View>
            <Text style={styles.heading}>Request sent</Text>
            <Text style={styles.subhead}>
              Your request to join {pendingApproval.orgName} has been
              submitted.
            </Text>
          </View>
          <View style={styles.pendingCard}>
            <Text style={styles.pendingTitle}>Awaiting admin approval</Text>
            <Text style={styles.pendingBody}>
              An admin will review your request. You&apos;ll get access once
              approved.
            </Text>
          </View>
          <Pressable
            onPress={handleCancel}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
            ]}
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>Back to organizations</Text>
          </Pressable>
        </>
      );
    }

    return (
      <>
        <View>
          <Text style={styles.heading}>Join an organization</Text>
          <Text style={styles.subhead}>
            Enter the invite code you received from an organization admin.
          </Text>
        </View>

        {error != null && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {tokenParam && isLoading ? (
          <View style={{ alignItems: "center", padding: SPACING.lg }}>
            <ActivityIndicator color={neutral.foreground} />
            <Text style={[styles.helperText, { marginTop: SPACING.sm }]}>
              Processing your invite link…
            </Text>
          </View>
        ) : (
          <>
            <View style={{ gap: SPACING.xs }}>
              <Text style={styles.fieldLabel}>Invite code</Text>
              <TextInput
                value={code}
                onChangeText={(v) => setCode(normalizeCode(v))}
                placeholder="ABCD1234"
                placeholderTextColor={neutral.placeholder}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!isLoading}
                style={styles.input}
                returnKeyType="go"
                onSubmitEditing={handleSubmit}
                accessibilityLabel="Invite code"
              />
            </View>

            <Pressable
              onPress={handleSubmit}
              disabled={isLoading || code.trim().length === 0}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.primaryButtonPressed,
                (isLoading || code.trim().length === 0) && styles.buttonDisabled,
              ]}
              accessibilityRole="button"
            >
              {isLoading ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.primaryButtonText}>Join organization</Text>
              )}
            </Pressable>
          </>
        )}
      </>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.sheetHeader}>
        <Pressable
          onPress={handleCancel}
          style={styles.headerSideButton}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Text style={styles.headerSideButtonText}>Cancel</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Join Organization</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {renderBody()}
        </ScrollView>
      </View>
    </View>
  );
}
