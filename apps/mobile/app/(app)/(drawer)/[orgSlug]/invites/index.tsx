import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Alert,
  RefreshControl,
  TextInput,
  Modal,
  Clipboard,
} from "react-native";
import { Image } from "expo-image";
import { useRouter, useNavigation } from "expo-router";
import { DrawerActions } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import QRCode from "react-native-qrcode-svg";
import {
  Link as LinkIcon,
  Plus,
  Copy,
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
import { NEUTRAL, SEMANTIC, SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatMonthDayYearSafe } from "@/lib/date-format";
import { getWebAppUrl } from "@/lib/web-api";

const INVITES_COLORS = {
  background: NEUTRAL.background,
  surface: NEUTRAL.surface,
  foreground: NEUTRAL.foreground,
  muted: NEUTRAL.muted,
  mutedForeground: NEUTRAL.placeholder,
  border: NEUTRAL.border,
  primary: SEMANTIC.success,
  primaryLight: SEMANTIC.successLight,
  primaryForeground: NEUTRAL.surface,
  error: SEMANTIC.error,
  errorLight: SEMANTIC.errorLight,
  warning: SEMANTIC.warning,
  warningLight: SEMANTIC.warningLight,
};

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

  const styles = useMemo(() => createStyles(), []);
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

  const handleCopyLink = useCallback((invite: Invite) => {
    try {
      const link = getInviteLink(invite, getWebAppUrl());
      Clipboard.setString(link);
      setCopiedInviteId(invite.id);
      showToast("Link copied to clipboard", "success");
      setTimeout(() => setCopiedInviteId(null), 2000);
    } catch (e) {
      captureException(e as Error, { screen: "Invites", context: "copyLink", orgId });
      showToast("Failed to copy link", "error");
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
          return { bg: INVITES_COLORS.warningLight, text: INVITES_COLORS.warning };
        case "alumni":
          return { bg: NEUTRAL.divider, text: NEUTRAL.secondary };
        default:
          return { bg: INVITES_COLORS.primaryLight, text: INVITES_COLORS.primary };
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
            <View style={[styles.statusBadge, { backgroundColor: INVITES_COLORS.errorLight }]}>
              <Clock size={12} color={INVITES_COLORS.error} />
              <Text style={[styles.statusBadgeText, { color: INVITES_COLORS.error }]}>Expired</Text>
            </View>
          )}
          {revoked && (
            <View style={[styles.statusBadge, { backgroundColor: INVITES_COLORS.errorLight }]}>
              <ShieldX size={12} color={INVITES_COLORS.error} />
              <Text style={[styles.statusBadgeText, { color: INVITES_COLORS.error }]}>Revoked</Text>
            </View>
          )}
          {exhausted && (
            <View style={[styles.statusBadge, { backgroundColor: INVITES_COLORS.errorLight }]}>
              <Users size={12} color={INVITES_COLORS.error} />
              <Text style={[styles.statusBadgeText, { color: INVITES_COLORS.error }]}>No uses left</Text>
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
            onPress={() => handleCopyLink(invite)}
          >
            {copiedInviteId === invite.id ? (
              <Check size={16} color={INVITES_COLORS.primary} />
            ) : (
              <Copy size={16} color={INVITES_COLORS.primary} />
            )}
            <Text style={styles.actionButtonText}>
              {copiedInviteId === invite.id ? "Copied" : "Copy Link"}
            </Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
            onPress={() => setShowQRCode(showQRCode === invite.id ? null : invite.id)}
          >
            <QrCode size={16} color={INVITES_COLORS.primary} />
            <Text style={styles.actionButtonText}>QR</Text>
          </Pressable>

          {valid && (
            <Pressable
              style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
              onPress={() => handleRevoke(invite)}
            >
              <X size={16} color={INVITES_COLORS.warning} />
              <Text style={[styles.actionButtonText, { color: INVITES_COLORS.warning }]}>Revoke</Text>
            </Pressable>
          )}

          <Pressable
            style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
            onPress={() => handleDelete(invite)}
          >
            <Trash2 size={16} color={INVITES_COLORS.error} />
          </Pressable>
        </View>

        {/* QR Code display */}
        {showQRCode === invite.id && (
          <View style={styles.qrContainer}>
            <QRCode
              value={getInviteLink(invite, getWebAppUrl())}
              size={180}
              backgroundColor={INVITES_COLORS.surface}
              color={INVITES_COLORS.foreground}
            />
          </View>
        )}
      </View>
    );
  }, [styles, copiedInviteId, showQRCode, handleCopyLink, handleRevoke, handleDelete]);

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
            <ShieldX size={48} color={INVITES_COLORS.muted} />
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
            <ActivityIndicator size="large" color={INVITES_COLORS.primary} />
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
            <LinkIcon size={48} color={INVITES_COLORS.muted} />
            <Text style={styles.emptyTitle}>No Invites Yet</Text>
            <Text style={styles.emptyText}>
              Create invite links to let people join your organization.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.createButton, pressed && { opacity: 0.8 }]}
              onPress={() => setShowCreateModal(true)}
            >
              <Plus size={18} color={INVITES_COLORS.primaryForeground} />
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
                tintColor={INVITES_COLORS.primary}
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
              placeholderTextColor={INVITES_COLORS.mutedForeground}
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
                  <ActivityIndicator size="small" color={INVITES_COLORS.primaryForeground} />
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

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: NEUTRAL.background,
    },
    headerGradient: {
      paddingBottom: SPACING.md,
    },
    headerSafeArea: {
      flex: 0,
    },
    headerContent: {
      flexDirection: "row",
      alignItems: "center",
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
      alignItems: "center",
      justifyContent: "center",
    },
    orgAvatarText: {
      ...TYPOGRAPHY.titleSmall,
      fontWeight: "700",
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
      alignItems: "center",
      justifyContent: "center",
    },
    contentSheet: {
      flex: 1,
      backgroundColor: NEUTRAL.surface,
    },
    listContent: {
      padding: SPACING.md,
      paddingBottom: 40,
      gap: SPACING.md,
    },
    // Invite card
    inviteCard: {
      backgroundColor: NEUTRAL.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      padding: SPACING.md,
      ...SHADOWS.sm,
    },
    inviteCardInvalid: {
      opacity: 0.6,
    },
    inviteHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
      marginBottom: SPACING.xs,
    },
    inviteCode: {
      ...TYPOGRAPHY.headlineMedium,
      fontFamily: "monospace",
      color: NEUTRAL.foreground,
    },
    roleBadge: {
      paddingVertical: 2,
      paddingHorizontal: SPACING.sm,
      borderRadius: RADIUS.xs,
    },
    roleBadgeText: {
      ...TYPOGRAPHY.labelSmall,
      fontWeight: "600",
    },
    statusRow: {
      flexDirection: "row",
      gap: SPACING.xs,
      marginBottom: SPACING.xs,
      flexWrap: "wrap",
    },
    statusBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingVertical: 2,
      paddingHorizontal: SPACING.sm,
      borderRadius: RADIUS.xs,
    },
    statusBadgeText: {
      ...TYPOGRAPHY.labelSmall,
      fontWeight: "500",
    },
    inviteMeta: {
      ...TYPOGRAPHY.bodySmall,
      color: NEUTRAL.secondary,
      marginTop: SPACING.xs,
    },
    inviteCreated: {
      ...TYPOGRAPHY.caption,
      color: NEUTRAL.muted,
      marginTop: 2,
    },
    inviteActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.md,
      marginTop: SPACING.md,
      paddingTop: SPACING.sm,
      borderTopWidth: 1,
      borderTopColor: NEUTRAL.divider,
    },
    actionButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingVertical: SPACING.xs,
    },
    actionButtonPressed: {
      opacity: 0.7,
    },
    actionButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: SEMANTIC.success,
    },
    qrContainer: {
      alignItems: "center",
      marginTop: SPACING.md,
      paddingTop: SPACING.md,
      borderTopWidth: 1,
      borderTopColor: NEUTRAL.border,
    },
    // Empty state
    emptyContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: SPACING.xl,
    },
    emptyTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: NEUTRAL.foreground,
      marginTop: SPACING.md,
    },
    emptyText: {
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.muted,
      textAlign: "center",
      marginTop: SPACING.xs,
      marginBottom: SPACING.lg,
    },
    createButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
      backgroundColor: SEMANTIC.success,
      paddingVertical: SPACING.sm + 2,
      paddingHorizontal: SPACING.lg,
      borderRadius: RADIUS.md,
    },
    createButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: NEUTRAL.surface,
    },
    // Loading state
    loadingContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: SPACING.md,
    },
    loadingText: {
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.muted,
    },
    // Error state
    errorContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: SPACING.xl,
    },
    errorTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: NEUTRAL.foreground,
      marginBottom: SPACING.xs,
    },
    errorText: {
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.muted,
      textAlign: "center",
      marginBottom: SPACING.lg,
    },
    retryButton: {
      backgroundColor: SEMANTIC.success,
      paddingVertical: SPACING.sm + 2,
      paddingHorizontal: SPACING.lg,
      borderRadius: RADIUS.md,
    },
    retryButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: NEUTRAL.surface,
    },
    // Access denied
    accessDenied: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: SPACING.xl,
    },
    accessDeniedTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: NEUTRAL.foreground,
      marginTop: SPACING.md,
    },
    accessDeniedText: {
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.muted,
      textAlign: "center",
      marginTop: SPACING.xs,
      marginBottom: SPACING.lg,
    },
    backButton: {
      backgroundColor: SEMANTIC.success,
      paddingVertical: SPACING.sm + 2,
      paddingHorizontal: SPACING.lg,
      borderRadius: RADIUS.md,
    },
    backButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: NEUTRAL.surface,
    },
    // Modal
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      alignItems: "center",
      justifyContent: "center",
      padding: SPACING.lg,
    },
    modalContent: {
      backgroundColor: NEUTRAL.surface,
      borderRadius: RADIUS.xl,
      padding: SPACING.lg,
      width: "100%",
      maxWidth: 400,
    },
    modalTitle: {
      ...TYPOGRAPHY.headlineMedium,
      color: NEUTRAL.foreground,
      marginBottom: SPACING.lg,
    },
    fieldLabel: {
      ...TYPOGRAPHY.labelMedium,
      color: NEUTRAL.foreground,
      marginBottom: SPACING.sm,
    },
    roleButtons: {
      flexDirection: "row",
      gap: SPACING.sm,
      marginBottom: SPACING.md,
    },
    roleButton: {
      flex: 1,
      paddingVertical: SPACING.sm + 2,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      alignItems: "center",
    },
    roleButtonActive: {
      borderColor: SEMANTIC.success,
      backgroundColor: SEMANTIC.successLight,
    },
    roleButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: NEUTRAL.muted,
    },
    roleButtonTextActive: {
      color: SEMANTIC.success,
      fontWeight: "600",
    },
    input: {
      backgroundColor: NEUTRAL.background,
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.sm + 2,
      paddingHorizontal: SPACING.md,
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.foreground,
      marginBottom: SPACING.lg,
    },
    modalActions: {
      flexDirection: "row",
      gap: SPACING.sm,
    },
    cancelModalButton: {
      flex: 1,
      paddingVertical: SPACING.sm + 2,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      alignItems: "center",
    },
    cancelModalButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: NEUTRAL.muted,
    },
    createModalButton: {
      flex: 1,
      backgroundColor: SEMANTIC.success,
      paddingVertical: SPACING.sm + 2,
      borderRadius: RADIUS.md,
      alignItems: "center",
    },
    createModalButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: NEUTRAL.surface,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
  });
