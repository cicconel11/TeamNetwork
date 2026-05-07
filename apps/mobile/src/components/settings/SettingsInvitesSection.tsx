import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  TextInput,
  Pressable,
  Alert,
} from "react-native";
import {
  Link as LinkIcon,
  ChevronDown,
  Plus,
  X,
  Share2,
  Check,
  QrCode,
  Trash2,
} from "lucide-react-native";
import { SafeQRCode } from "@/components/SafeQRCode";
import { shareInvite } from "@/lib/share";
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
import { getWebAppUrl } from "@/lib/web-api";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { buildSettingsColors } from "./settingsColors";
import { useBaseStyles, formatDate, formatBucket, fontSize, fontWeight } from "./settingsShared";
import { useThemedStyles } from "@/hooks/useThemedStyles";

interface Props {
  orgId: string;
  isAdmin: boolean;
  subscription: { bucket: string; alumniCount: number; alumniLimit: number | null } | null;
}

export function SettingsInvitesSection({ orgId, isAdmin, subscription }: Props) {
  const { invites, loading: invitesLoading, createInvite, revokeInvite, deleteInvite } = useInvites(orgId);
  const { neutral, semantic } = useAppColorScheme();
  const colors = useMemo(() => buildSettingsColors(neutral, semantic), [neutral, semantic]);
  const baseStyles = useBaseStyles();

  const [expanded, setExpanded] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteRole, setInviteRole] = useState<"active_member" | "admin" | "alumni">("active_member");
  const [inviteUses, setInviteUses] = useState("");
  const [inviteCreating, setInviteCreating] = useState(false);
  const [showQRCode, setShowQRCode] = useState<string | null>(null);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);

  const styles = useThemedStyles((n, s) => ({
    badge: {
      backgroundColor: s.warning,
      borderRadius: 10,
      minWidth: 20,
      height: 20,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      paddingHorizontal: 6,
    },
    badgeText: {
      color: "#fff",
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
    },
    fieldLabel: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: n.foreground,
      marginBottom: 8,
    },
    input: {
      backgroundColor: n.background,
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: 8,
      paddingVertical: 12,
      paddingHorizontal: 16,
      fontSize: fontSize.base,
      color: n.foreground,
      marginBottom: 12,
    },
    button: {
      flex: 1,
      backgroundColor: s.success,
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 8,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    buttonText: {
      color: "#ffffff",
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
    },
    quotaContainer: {
      gap: 8,
    },
    quotaRow: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
    },
    quotaLabel: {
      fontSize: fontSize.sm,
      color: n.muted,
    },
    quotaValue: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: n.foreground,
    },
    createButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: 8,
      paddingVertical: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: s.success,
      borderStyle: "dashed" as const,
    },
    createButtonText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: s.success,
    },
    inviteForm: {
      marginTop: 16,
    },
    roleButtons: {
      flexDirection: "row" as const,
      gap: 8,
      marginBottom: 16,
    },
    roleButton: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: n.border,
      alignItems: "center" as const,
    },
    roleButtonActive: {
      borderColor: s.success,
      backgroundColor: s.success + "10",
    },
    roleButtonText: {
      fontSize: fontSize.sm,
      color: n.muted,
    },
    roleButtonTextActive: {
      color: s.success,
      fontWeight: fontWeight.semibold,
    },
    formActions: {
      flexDirection: "row" as const,
      gap: 12,
      marginTop: 8,
    },
    cancelButton: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: n.border,
      alignItems: "center" as const,
    },
    cancelButtonText: {
      fontSize: fontSize.base,
      color: n.muted,
    },
    invitesList: {
      marginTop: 16,
      gap: 12,
    },
    inviteItem: {
      backgroundColor: n.background,
      padding: 12,
      borderRadius: 8,
    },
    inviteItemInvalid: {
      opacity: 0.6,
    },
    inviteHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      flexWrap: "wrap" as const,
    },
    inviteCode: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      fontFamily: "monospace",
      color: n.foreground,
    },
    roleBadge: {
      paddingVertical: 2,
      paddingHorizontal: 8,
      borderRadius: 4,
    },
    roleBadgeText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
    },
    statusBadge: {
      paddingVertical: 2,
      paddingHorizontal: 8,
      borderRadius: 4,
    },
    statusBadgeText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
    },
    inviteMeta: {
      fontSize: 13,
      color: n.placeholder,
      marginTop: 8,
    },
    inviteActions: {
      flexDirection: "row" as const,
      gap: 16,
      marginTop: 12,
    },
    inviteAction: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
    },
    inviteActionText: {
      fontSize: fontSize.sm,
      color: s.success,
    },
    qrContainer: {
      alignItems: "center" as const,
      paddingTop: 16,
      marginTop: 12,
      borderTopWidth: 1,
      borderTopColor: n.border,
    },
    emptyText: {
      fontSize: fontSize.sm,
      color: n.placeholder,
      textAlign: "center" as const,
      paddingVertical: 24,
    },
  }));

  if (!isAdmin) return null;

  const validInviteCount = invites.filter(isInviteValid).length;

  const handleCreateInvite = async () => {
    if (
      inviteRole === "alumni" &&
      subscription &&
      subscription.alumniLimit !== null &&
      subscription.alumniCount >= subscription.alumniLimit
    ) {
      Alert.alert("Alumni Limit Reached", "Upgrade your plan to invite more alumni.");
      return;
    }

    setInviteCreating(true);
    const result = await createInvite({
      role: inviteRole,
      usesRemaining: inviteUses ? parseInt(inviteUses) : null,
      expiresAt: null,
    });

    if (result.success) {
      setShowInviteForm(false);
      setInviteRole("active_member");
      setInviteUses("");
    } else {
      Alert.alert("Error", result.error || "Failed to create invite");
    }
    setInviteCreating(false);
  };

  const handleShareInvite = async (invite: Invite) => {
    const result = await shareInvite(invite);
    if (result.shared) {
      setCopiedInviteId(invite.id);
      setTimeout(() => setCopiedInviteId(null), 2000);
    }
  };

  return (
    <View style={baseStyles.section}>
      <Pressable
        style={({ pressed }) => [baseStyles.sectionHeader, pressed && { opacity: 0.7 }]}
        onPress={() => setExpanded((prev) => !prev)}
      >
        <View style={baseStyles.sectionHeaderLeft}>
          <LinkIcon size={20} color={colors.muted} />
          <Text style={baseStyles.sectionTitle}>Invites</Text>
          {validInviteCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{validInviteCount}</Text>
            </View>
          )}
        </View>
        <ChevronDown
          size={20}
          color={colors.mutedForeground}
          style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
        />
      </Pressable>

      {expanded && (
        <View style={baseStyles.card}>
          {subscription && (
            <View style={styles.quotaContainer}>
              <View style={styles.quotaRow}>
                <Text style={styles.quotaLabel}>Alumni Plan</Text>
                <Text style={styles.quotaValue}>{formatBucket(subscription.bucket)}</Text>
              </View>
              <View style={styles.quotaRow}>
                <Text style={styles.quotaLabel}>Alumni Used</Text>
                <Text style={styles.quotaValue}>
                  {subscription.alumniCount} / {subscription.alumniLimit ?? "Unlimited"}
                </Text>
              </View>
              <View style={styles.quotaRow}>
                <Text style={styles.quotaLabel}>Remaining</Text>
                <Text style={styles.quotaValue}>
                  {subscription.alumniLimit === null
                    ? "Unlimited"
                    : Math.max(subscription.alumniLimit - subscription.alumniCount, 0)}
                </Text>
              </View>
            </View>
          )}

          <View style={baseStyles.divider} />

          {!showInviteForm && (
            <Pressable style={styles.createButton} onPress={() => setShowInviteForm(true)}>
              <Plus size={18} color={colors.primary} />
              <Text style={styles.createButtonText}>Create Invite</Text>
            </Pressable>
          )}

          {showInviteForm && (
            <View style={styles.inviteForm}>
              <Text style={styles.fieldLabel}>Role</Text>
              <View style={styles.roleButtons}>
                {(["active_member", "alumni", "admin"] as const).map((role) => (
                  <Pressable
                    key={role}
                    style={[styles.roleButton, inviteRole === role && styles.roleButtonActive]}
                    onPress={() => setInviteRole(role)}
                  >
                    <Text style={[styles.roleButtonText, inviteRole === role && styles.roleButtonTextActive]}>
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
                placeholderTextColor={colors.mutedForeground}
                keyboardType="number-pad"
              />

              <View style={styles.formActions}>
                <Pressable
                  style={styles.cancelButton}
                  onPress={() => {
                    setShowInviteForm(false);
                    setInviteRole("active_member");
                    setInviteUses("");
                  }}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.button} onPress={handleCreateInvite} disabled={inviteCreating}>
                  {inviteCreating ? (
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                  ) : (
                    <Text style={styles.buttonText}>Create</Text>
                  )}
                </Pressable>
              </View>
            </View>
          )}

          {invitesLoading ? (
            <View style={baseStyles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : invites.length > 0 ? (
            <View style={styles.invitesList}>
              {invites.map((invite) => {
                const valid = isInviteValid(invite);
                const expired = isInviteExpired(invite.expires_at);
                const revoked = isInviteRevoked(invite.revoked_at);
                const exhausted = isInviteExhausted(invite.uses_remaining);

                return (
                  <View key={invite.id} style={[styles.inviteItem, !valid && styles.inviteItemInvalid]}>
                    <View style={styles.inviteHeader}>
                      <Text style={styles.inviteCode}>{invite.code}</Text>
                      <View
                        style={[
                          styles.roleBadge,
                          {
                            backgroundColor:
                              invite.role === "admin"
                                ? colors.warning + "20"
                                : invite.role === "alumni"
                                ? colors.muted + "20"
                                : colors.primary + "20",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.roleBadgeText,
                            {
                              color:
                                invite.role === "admin"
                                  ? colors.warning
                                  : invite.role === "alumni"
                                  ? colors.foreground
                                  : colors.primary,
                            },
                          ]}
                        >
                          {getRoleLabel(invite.role || "active_member")}
                        </Text>
                      </View>
                      {expired && (
                        <View style={[styles.statusBadge, { backgroundColor: colors.error + "20" }]}>
                          <Text style={[styles.statusBadgeText, { color: colors.error }]}>Expired</Text>
                        </View>
                      )}
                      {revoked && (
                        <View style={[styles.statusBadge, { backgroundColor: colors.error + "20" }]}>
                          <Text style={[styles.statusBadgeText, { color: colors.error }]}>Revoked</Text>
                        </View>
                      )}
                      {exhausted && (
                        <View style={[styles.statusBadge, { backgroundColor: colors.error + "20" }]}>
                          <Text style={[styles.statusBadgeText, { color: colors.error }]}>No uses left</Text>
                        </View>
                      )}
                    </View>

                    <Text style={styles.inviteMeta}>
                      {invite.uses_remaining !== null ? `${invite.uses_remaining} uses left` : "Unlimited uses"}
                      {invite.expires_at && ` \u2022 Expires ${formatDate(invite.expires_at)}`}
                    </Text>

                    <View style={styles.inviteActions}>
                      <Pressable style={styles.inviteAction} onPress={() => handleShareInvite(invite)}>
                        {copiedInviteId === invite.id ? (
                          <Check size={16} color={colors.success} />
                        ) : (
                          <Share2 size={16} color={colors.primary} />
                        )}
                        <Text style={styles.inviteActionText}>
                          {copiedInviteId === invite.id ? "Shared!" : "Share"}
                        </Text>
                      </Pressable>

                      <Pressable
                        style={styles.inviteAction}
                        onPress={() => setShowQRCode(showQRCode === invite.id ? null : invite.id)}
                      >
                        <QrCode size={16} color={colors.primary} />
                        <Text style={styles.inviteActionText}>QR</Text>
                      </Pressable>

                      {valid && (
                        <Pressable
                          style={styles.inviteAction}
                          onPress={() => {
                            Alert.alert("Revoke Invite", "This invite will no longer be valid.", [
                              { text: "Cancel", style: "cancel" },
                              { text: "Revoke", style: "destructive", onPress: () => revokeInvite(invite.id) },
                            ]);
                          }}
                        >
                          <X size={16} color={colors.warning} />
                          <Text style={[styles.inviteActionText, { color: colors.warning }]}>Revoke</Text>
                        </Pressable>
                      )}

                      <Pressable
                        style={styles.inviteAction}
                        onPress={() => {
                          Alert.alert("Delete Invite", "This will permanently delete the invite.", [
                            { text: "Cancel", style: "cancel" },
                            { text: "Delete", style: "destructive", onPress: () => deleteInvite(invite.id) },
                          ]);
                        }}
                      >
                        <Trash2 size={16} color={colors.error} />
                      </Pressable>
                    </View>

                    {showQRCode === invite.id && (
                      <View style={styles.qrContainer}>
                        <SafeQRCode
                          value={getInviteLink(invite, getWebAppUrl())}
                          size={180}
                          backgroundColor={colors.card}
                          color={colors.foreground}
                          fallbackTextColor={colors.muted}
                        />
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.emptyText}>No invites yet. Create one to let people join.</Text>
          )}
        </View>
      )}
    </View>
  );
}
