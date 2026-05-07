import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  Pressable,
  Alert,
  RefreshControl,
  TextInput,
  Modal,
} from "react-native";
import { Image } from "expo-image";
import { useRouter, useNavigation } from "expo-router";
import { DrawerActions } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { SafeQRCode } from "@/components/SafeQRCode";
import {
  Link as LinkIcon,
  Plus,
  Share2,
  Check,
  X,
  QrCode,
  Trash2,
  ShieldX,
  Clock,
  Users,
} from "lucide-react-native";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import {
  useInvites,
  getInviteLink,
  isInviteValid,
  isInviteExpired,
  isInviteRevoked,
  isInviteExhausted,
  type Invite,
} from "@/hooks/useInvites";
import { getRoleLabel } from "@/hooks/useMemberships";
import { showToast } from "@/components/ui/Toast";
import { captureException } from "@/lib/analytics";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { formatMonthDayYearSafe } from "@/lib/date-format";
import { getWebAppUrl } from "@/lib/web-api";
import { shareInvite } from "@/lib/share";

export default function InvitesScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { orgSlug, orgId, orgName, orgLogoUrl } = useOrg();
  const { isAdmin, isLoading: roleLoading } = useOrgRole();
  const {
    invites,
    loading,
    error,
    createInvite,
    revokeInvite,
    deleteInvite,
    refetch,
  } = useInvites(orgId);

  const { neutral, semantic } = useAppColorScheme();
  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.background,
    },
    headerGradient: {
      paddingBottom: SPACING.md,
    },
    headerSafeArea: {
      flex: 0,
    },
    headerContent: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.xs,
      minHeight: 40,
      gap: SPACING.sm,
    },
    orgLogoButton: {
      width: 36,
      height: 36,
    },
    orgLogo: {
      width: 36,
      height: 36,
      borderRadius: 18,
    },
    orgAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: APP_CHROME.avatarBackground,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    orgAvatarText: {
      ...TYPOGRAPHY.titleSmall,
      fontWeight: "700" as const,
      color: APP_CHROME.avatarText,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
    },
    headerMeta: {
      ...TYPOGRAPHY.caption,
      color: APP_CHROME.headerMeta,
      marginTop: 2,
    },
    createHeaderButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: "rgba(255,255,255,0.15)",
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
    },
    listContent: {
      padding: SPACING.md,
      paddingBottom: 40,
      gap: SPACING.md,
    },
    inviteCard: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      ...SHADOWS.sm,
    },
    inviteCardInvalid: {
      opacity: 0.6,
    },
    inviteHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
      marginBottom: SPACING.xs,
    },
    inviteCode: {
      ...TYPOGRAPHY.headlineMedium,
      fontFamily: "monospace",
      color: n.foreground,
    },
    roleBadge: {
      paddingVertical: 2,
      paddingHorizontal: SPACING.sm,
      borderRadius: RADIUS.xs,
    },
    roleBadgeText: {
      ...TYPOGRAPHY.labelSmall,
      fontWeight: "600" as const,
    },
    statusRow: {
      flexDirection: "row" as const,
      gap: SPACING.xs,
      marginBottom: SPACING.xs,
      flexWrap: "wrap" as const,
    },
    statusBadge: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
      paddingVertical: 2,
      paddingHorizontal: SPACING.sm,
      borderRadius: RADIUS.xs,
    },
    statusBadgeText: {
      ...TYPOGRAPHY.labelSmall,
      fontWeight: "500" as const,
    },
    inviteMeta: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
      marginTop: SPACING.xs,
    },
    inviteCreated: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
      marginTop: 2,
    },
    inviteActions: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.md,
      marginTop: SPACING.md,
      paddingTop: SPACING.sm,
      borderTopWidth: 1,
      borderTopColor: n.divider,
    },
    actionButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
      paddingVertical: SPACING.xs,
    },
    actionButtonPressed: {
      opacity: 0.7,
    },
    actionButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: s.success,
    },
    qrContainer: {
      alignItems: "center" as const,
      marginTop: SPACING.md,
      paddingTop: SPACING.md,
      borderTopWidth: 1,
      borderTopColor: n.border,
    },
    emptyContainer: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      padding: SPACING.xl,
    },
    emptyTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: n.foreground,
      marginTop: SPACING.md,
    },
    emptyText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.muted,
      textAlign: "center" as const,
      marginTop: SPACING.xs,
      marginBottom: SPACING.lg,
    },
    createButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
      backgroundColor: s.success,
      paddingVertical: SPACING.sm + 2,
      paddingHorizontal: SPACING.lg,
      borderRadius: RADIUS.md,
    },
    createButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: n.surface,
    },
    loadingContainer: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: SPACING.md,
    },
    loadingText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.muted,
    },
    errorContainer: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      padding: SPACING.xl,
    },
    errorTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: n.foreground,
      marginBottom: SPACING.xs,
    },
    errorText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.muted,
      textAlign: "center" as const,
      marginBottom: SPACING.lg,
    },
    retryButton: {
      backgroundColor: s.success,
      paddingVertical: SPACING.sm + 2,
      paddingHorizontal: SPACING.lg,
      borderRadius: RADIUS.md,
    },
    retryButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: n.surface,
    },
    accessDenied: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      padding: SPACING.xl,
    },
    accessDeniedTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: n.foreground,
      marginTop: SPACING.md,
    },
    accessDeniedText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.muted,
      textAlign: "center" as const,
      marginTop: SPACING.xs,
      marginBottom: SPACING.lg,
    },
    backButton: {
      backgroundColor: s.success,
      paddingVertical: SPACING.sm + 2,
      paddingHorizontal: SPACING.lg,
      borderRadius: RADIUS.md,
    },
    backButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: n.surface,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      alignItems: "center" as const,
      justifyContent: "center" as const,
      padding: SPACING.lg,
    },
    modalContent: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.xl,
      padding: SPACING.lg,
      width: "100%",
      maxWidth: 400,
    },
    modalTitle: {
      ...TYPOGRAPHY.headlineMedium,
      color: n.foreground,
      marginBottom: SPACING.lg,
    },
    fieldLabel: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
      marginBottom: SPACING.sm,
    },
    roleButtons: {
      flexDirection: "row" as const,
      gap: SPACING.sm,
      marginBottom: SPACING.md,
    },
    roleButton: {
      flex: 1,
      paddingVertical: SPACING.sm + 2,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      alignItems: "center" as const,
    },
    roleButtonActive: {
      borderColor: s.success,
      backgroundColor: s.successLight,
    },
    roleButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.muted,
    },
    roleButtonTextActive: {
      color: s.success,
      fontWeight: "600" as const,
    },
    input: {
      backgroundColor: n.background,
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.sm + 2,
      paddingHorizontal: SPACING.md,
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      marginBottom: SPACING.lg,
    },
    modalActions: {
      flexDirection: "row" as const,
      gap: SPACING.sm,
    },
    cancelModalButton: {
      flex: 1,
      paddingVertical: SPACING.sm + 2,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      alignItems: "center" as const,
    },
    cancelModalButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: n.muted,
    },
    createModalButton: {
      flex: 1,
      backgroundColor: s.success,
      paddingVertical: SPACING.sm + 2,
      borderRadius: RADIUS.md,
      alignItems: "center" as const,
    },
    createModalButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: n.surface,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
  }));
  const [refreshing, setRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [inviteRole, setInviteRole] = useState<"active_member" | "admin" | "alumni">("active_member");
  const [inviteUses, setInviteUses] = useState("");
  const [inviteCreating, setInviteCreating] = useState(false);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const [showQRCode, setShowQRCode] = useState<string | null>(null);

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available - no-op
    }
  }, [navigation]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } catch (e) {
      captureException(e as Error, { screen: "Invites", context: "refresh", orgId });
      showToast("Failed to refresh invites", "error");
    } finally {
      setRefreshing(false);
    }
  }, [refetch, orgId]);

  const handleCreateInvite = useCallback(async () => {
    setInviteCreating(true);
    try {
      const result = await createInvite({
        role: inviteRole,
        usesRemaining: inviteUses ? parseInt(inviteUses, 10) : null,
      });

      if (result.success) {
        setShowCreateModal(false);
        setInviteRole("active_member");
        setInviteUses("");
        showToast("Invite created successfully", "success");
      } else {
        showToast(result.error || "Failed to create invite", "error");
      }
    } catch (e) {
      captureException(e as Error, { screen: "Invites", context: "createInvite", orgId });
      showToast("Failed to create invite", "error");
    } finally {
      setInviteCreating(false);
    }
  }, [createInvite, inviteRole, inviteUses, orgId]);

  const handleShareLink = useCallback(async (invite: Invite) => {
    try {
      const result = await shareInvite(invite);
      if (result.shared) {
        setCopiedInviteId(invite.id);
        setTimeout(() => setCopiedInviteId(null), 2000);
      }
    } catch (e) {
      captureException(e as Error, { screen: "Invites", context: "shareLink", orgId });
      showToast("Failed to share invite", "error");
    }
  }, [orgId]);

  const handleRevoke = useCallback(async (invite: Invite) => {
    Alert.alert(
      "Revoke Invite",
      "This invite link will no longer work. Are you sure?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: async () => {
            try {
              const result = await revokeInvite(invite.id);
              if (result.success) {
                showToast("Invite revoked", "success");
              } else {
                showToast(result.error || "Failed to revoke invite", "error");
              }
            } catch (e) {
              captureException(e as Error, { screen: "Invites", context: "revokeInvite", orgId });
              showToast("Failed to revoke invite", "error");
            }
          },
        },
      ]
    );
  }, [revokeInvite, orgId]);

  const handleDelete = useCallback(async (invite: Invite) => {
    Alert.alert(
      "Delete Invite",
      "This will permanently delete the invite. Are you sure?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const result = await deleteInvite(invite.id);
              if (result.success) {
                showToast("Invite deleted", "success");
              } else {
                showToast(result.error || "Failed to delete invite", "error");
              }
            } catch (e) {
              captureException(e as Error, { screen: "Invites", context: "deleteInvite", orgId });
              showToast("Failed to delete invite", "error");
            }
          },
        },
      ]
    );
  }, [deleteInvite, orgId]);

  const validInvites = invites.filter(isInviteValid);
  const invalidInvites = invites.filter((inv) => !isInviteValid(inv));

  const renderInviteItem = useCallback(({ item: invite }: { item: Invite }) => {
    const valid = isInviteValid(invite);
    const expired = isInviteExpired(invite.expires_at);
    const revoked = isInviteRevoked(invite.revoked_at);
    const exhausted = isInviteExhausted(invite.uses_remaining);

    const getRoleBadgeColors = (role: string | null) => {
      switch (role) {
        case "admin":
          return { bg: semantic.warningLight, text: semantic.warning };
        case "alumni":
          return { bg: neutral.divider, text: neutral.secondary };
        default:
          return { bg: semantic.successLight, text: semantic.success };
      }
    };

    const badgeColors = getRoleBadgeColors(invite.role);

    return (
      <View style={[styles.inviteCard, !valid && styles.inviteCardInvalid]}>
        <View style={styles.inviteHeader}>
          <Text style={styles.inviteCode}>{invite.code}</Text>
          <View style={[styles.roleBadge, { backgroundColor: badgeColors.bg }]}>
            <Text style={[styles.roleBadgeText, { color: badgeColors.text }]}>
              {getRoleLabel(invite.role || "active_member")}
            </Text>
          </View>
        </View>

        {/* Status badges */}
        <View style={styles.statusRow}>
          {expired && (
            <View style={[styles.statusBadge, { backgroundColor: semantic.errorLight }]}>
              <Clock size={12} color={semantic.error} />
              <Text style={[styles.statusBadgeText, { color: semantic.error }]}>Expired</Text>
            </View>
          )}
          {revoked && (
            <View style={[styles.statusBadge, { backgroundColor: semantic.errorLight }]}>
              <ShieldX size={12} color={semantic.error} />
              <Text style={[styles.statusBadgeText, { color: semantic.error }]}>Revoked</Text>
            </View>
          )}
          {exhausted && (
            <View style={[styles.statusBadge, { backgroundColor: semantic.errorLight }]}>
              <Users size={12} color={semantic.error} />
              <Text style={[styles.statusBadgeText, { color: semantic.error }]}>No uses left</Text>
            </View>
          )}
        </View>

        {/* Invite metadata */}
        <Text style={styles.inviteMeta}>
          {invite.uses_remaining !== null
            ? `${invite.uses_remaining} uses remaining`
            : "Unlimited uses"}
          {invite.expires_at && ` \u00B7 Expires ${formatMonthDayYearSafe(invite.expires_at)}`}
        </Text>
        <Text style={styles.inviteCreated}>
          Created {formatMonthDayYearSafe(invite.created_at)}
        </Text>

        {/* Actions */}
        <View style={styles.inviteActions}>
          <Pressable
            style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
            onPress={() => handleShareLink(invite)}
          >
            {copiedInviteId === invite.id ? (
              <Check size={16} color={semantic.success} />
            ) : (
              <Share2 size={16} color={semantic.success} />
            )}
            <Text style={styles.actionButtonText}>
              {copiedInviteId === invite.id ? "Shared" : "Share"}
            </Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
            onPress={() => setShowQRCode(showQRCode === invite.id ? null : invite.id)}
          >
            <QrCode size={16} color={semantic.success} />
            <Text style={styles.actionButtonText}>QR</Text>
          </Pressable>

          {valid && (
            <Pressable
              style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
              onPress={() => handleRevoke(invite)}
            >
              <X size={16} color={semantic.warning} />
              <Text style={[styles.actionButtonText, { color: semantic.warning }]}>Revoke</Text>
            </Pressable>
          )}

          <Pressable
            style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
            onPress={() => handleDelete(invite)}
          >
            <Trash2 size={16} color={semantic.error} />
          </Pressable>
        </View>

        {/* QR Code display */}
        {showQRCode === invite.id && (
          <View style={styles.qrContainer}>
            <SafeQRCode
              value={getInviteLink(invite, getWebAppUrl())}
              size={180}
              backgroundColor={neutral.surface}
              color={neutral.foreground}
              fallbackTextColor={neutral.muted}
            />
          </View>
        )}
      </View>
    );
  }, [styles, copiedInviteId, showQRCode, handleShareLink, handleRevoke, handleDelete]);

  // Access denied for non-admins
  if (!roleLoading && !isAdmin) {
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
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "O"}</Text>
                  </View>
                )}
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Invites</Text>
                <Text style={styles.headerMeta}>{orgName}</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>

        <View style={styles.contentSheet}>
          <View style={styles.accessDenied}>
            <ShieldX size={48} color={neutral.muted} />
            <Text style={styles.accessDeniedTitle}>Access Denied</Text>
            <Text style={styles.accessDeniedText}>
              Only administrators can manage invite links.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.8 }]}
              onPress={() => router.back()}
            >
              <Text style={styles.backButtonText}>Go Back</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // Loading state
  if (loading || roleLoading) {
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
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "O"}</Text>
                  </View>
                )}
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Invites</Text>
                <Text style={styles.headerMeta}>{orgName}</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>

        <View style={styles.contentSheet}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={semantic.success} />
            <Text style={styles.loadingText}>Loading invites...</Text>
          </View>
        </View>
      </View>
    );
  }

  // Error state
  if (error) {
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
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "O"}</Text>
                  </View>
                )}
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Invites</Text>
                <Text style={styles.headerMeta}>{orgName}</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>

        <View style={styles.contentSheet}>
          <View style={styles.errorContainer}>
            <Text style={styles.errorTitle}>Something went wrong</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              style={({ pressed }) => [styles.retryButton, pressed && { opacity: 0.8 }]}
              onPress={handleRefresh}
            >
              <Text style={styles.retryButtonText}>Try Again</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // Combine valid and invalid invites for display
  const allInvites = [...validInvites, ...invalidInvites];

  return (
    <View style={styles.container}>
      {/* Gradient Header */}
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
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "O"}</Text>
                </View>
              )}
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Invites</Text>
              <Text style={styles.headerMeta}>
                {validInvites.length} active {validInvites.length === 1 ? "invite" : "invites"}
              </Text>
            </View>

            {/* Create button in header */}
            <Pressable
              style={({ pressed }) => [styles.createHeaderButton, pressed && { opacity: 0.8 }]}
              onPress={() => setShowCreateModal(true)}
            >
              <Plus size={20} color={APP_CHROME.headerTitle} />
            </Pressable>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content Sheet */}
      <View style={styles.contentSheet}>
        {allInvites.length === 0 ? (
          <View style={styles.emptyContainer}>
            <LinkIcon size={48} color={neutral.muted} />
            <Text style={styles.emptyTitle}>No Invites Yet</Text>
            <Text style={styles.emptyText}>
              Create invite links to let people join your organization.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.createButton, pressed && { opacity: 0.8 }]}
              onPress={() => setShowCreateModal(true)}
            >
              <Plus size={18} color={neutral.surface} />
              <Text style={styles.createButtonText}>Create Invite</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={allInvites}
            keyExtractor={(item) => item.id}
            renderItem={renderInviteItem}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={semantic.success}
              />
            }
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      {/* Create Invite Modal */}
      <Modal visible={showCreateModal} transparent animationType="fade">
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowCreateModal(false)}
        >
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Create Invite Link</Text>

            <Text style={styles.fieldLabel}>Role</Text>
            <View style={styles.roleButtons}>
              {(["active_member", "alumni", "admin"] as const).map((role) => (
                <Pressable
                  key={role}
                  style={[styles.roleButton, inviteRole === role && styles.roleButtonActive]}
                  onPress={() => setInviteRole(role)}
                >
                  <Text
                    style={[
                      styles.roleButtonText,
                      inviteRole === role && styles.roleButtonTextActive,
                    ]}
                  >
                    {getRoleLabel(role)}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Max Uses (optional)</Text>
            <TextInput
              style={styles.input}
              value={inviteUses}
              onChangeText={setInviteUses}
              placeholder="Unlimited"
              placeholderTextColor={neutral.muted}
              keyboardType="number-pad"
            />

            <View style={styles.modalActions}>
              <Pressable
                style={styles.cancelModalButton}
                onPress={() => {
                  setShowCreateModal(false);
                  setInviteRole("active_member");
                  setInviteUses("");
                }}
              >
                <Text style={styles.cancelModalButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.createModalButton, inviteCreating && styles.buttonDisabled]}
                onPress={handleCreateInvite}
                disabled={inviteCreating}
              >
                {inviteCreating ? (
                  <ActivityIndicator size="small" color={neutral.surface} />
                ) : (
                  <Text style={styles.createModalButtonText}>Create</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
