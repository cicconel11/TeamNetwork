import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  Pressable,
  Alert,
  Modal,
} from "react-native";
import { Image } from "expo-image";
import { Users, ChevronDown, Check, X } from "lucide-react-native";
import { useMemberships, getRoleLabel } from "@/hooks/useMemberships";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { buildSettingsColors } from "./settingsColors";
import { useBaseStyles, formatDate, fontSize, fontWeight } from "./settingsShared";
import { useThemedStyles } from "@/hooks/useThemedStyles";

interface Props {
  orgId: string;
  isAdmin: boolean;
}

export function SettingsAccessSection({ orgId, isAdmin }: Props) {
  const {
    memberships,
    pendingMembers,
    pendingAlumni,
    loading: membersLoading,
    updateRole,
    updateAccess,
    approveMember,
    rejectMember,
  } = useMemberships(orgId);
  const { neutral, semantic } = useAppColorScheme();
  const colors = useMemo(() => buildSettingsColors(neutral, semantic), [neutral, semantic]);
  const baseStyles = useBaseStyles();

  const [expanded, setExpanded] = useState(false);
  const [showAdminConfirm, setShowAdminConfirm] = useState(false);
  const [pendingAdminUserId, setPendingAdminUserId] = useState<string | null>(null);
  const [roleChanging, setRoleChanging] = useState<string | null>(null);

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
    subsectionTitle: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: n.muted,
      textTransform: "uppercase" as const,
      letterSpacing: 0.5,
      marginBottom: 12,
    },
    memberItem: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingVertical: 12,
      gap: 12,
      borderBottomWidth: 1,
      borderBottomColor: n.border,
    },
    memberItemRevoked: {
      opacity: 0.6,
    },
    memberInfo: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      flex: 1,
      minWidth: 0,
      gap: 12,
    },
    memberAvatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
    },
    memberAvatarPlaceholder: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: s.successLight,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    memberAvatarText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: s.success,
    },
    memberDetails: {
      flex: 1,
      minWidth: 0,
    },
    memberName: {
      fontSize: 15,
      fontWeight: fontWeight.medium,
      color: n.foreground,
    },
    memberEmail: {
      fontSize: 13,
      color: n.placeholder,
      marginTop: 2,
    },
    memberMeta: {
      fontSize: fontSize.xs,
      color: n.muted,
      marginTop: 2,
    },
    memberActions: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      flexShrink: 0,
    },
    approveButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: s.success + "20",
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    rejectButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: s.error + "20",
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    roleSelector: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 6,
      backgroundColor: n.background,
      borderWidth: 1,
      borderColor: n.border,
      maxWidth: 130,
    },
    roleSelectorText: {
      fontSize: 13,
      color: n.foreground,
      flexShrink: 1,
    },
    removeButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    restoreButton: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 6,
      backgroundColor: s.success,
    },
    restoreButtonText: {
      fontSize: 13,
      fontWeight: fontWeight.medium,
      color: "#ffffff",
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      alignItems: "center" as const,
      justifyContent: "center" as const,
      padding: 24,
    },
    modalContent: {
      backgroundColor: n.surface,
      borderRadius: 16,
      padding: 24,
      width: "100%" as const,
      maxWidth: 400,
    },
    modalTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: n.foreground,
      marginBottom: 12,
    },
    modalDescription: {
      fontSize: 15,
      color: n.placeholder,
      marginBottom: 20,
    },
    modalActions: {
      flexDirection: "row" as const,
      gap: 12,
    },
    modalCancelButton: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: n.border,
      alignItems: "center" as const,
    },
    modalCancelText: {
      fontSize: fontSize.base,
      color: n.muted,
    },
    modalConfirmButton: {
      flex: 1,
      backgroundColor: s.warning,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: "center" as const,
    },
    modalConfirmText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: "#fff",
    },
  }));

  const activeMembers = useMemo(() => memberships.filter((m) => m.status === "active"), [memberships]);
  const revokedMembers = useMemo(() => memberships.filter((m) => m.status === "revoked"), [memberships]);
  const totalPending = pendingMembers.length + pendingAlumni.length;

  if (!isAdmin) return null;

  const handleRoleChange = async (userId: string, newRole: "admin" | "active_member" | "alumni") => {
    const member = memberships.find((m) => m.user_id === userId);
    if (member?.role === newRole) return;

    if (newRole === "admin") {
      setPendingAdminUserId(userId);
      setShowAdminConfirm(true);
      return;
    }

    setRoleChanging(userId);
    const result = await updateRole(userId, newRole);
    if (!result.success) {
      Alert.alert("Error", result.error || "Failed to update role");
    }
    setRoleChanging(null);
  };

  const confirmAdminPromotion = async () => {
    if (!pendingAdminUserId) return;
    setRoleChanging(pendingAdminUserId);
    const result = await updateRole(pendingAdminUserId, "admin");
    if (!result.success) {
      Alert.alert("Error", result.error || "Failed to promote to admin");
    }
    setRoleChanging(null);
    setShowAdminConfirm(false);
    setPendingAdminUserId(null);
  };

  const handleRemoveAccess = async (userId: string) => {
    Alert.alert(
      "Remove Access",
      "Are you sure you want to remove this member's access?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            const result = await updateAccess(userId, "revoked");
            if (!result.success) {
              Alert.alert("Error", result.error || "Failed to remove access");
            }
          },
        },
      ]
    );
  };

  const handleRestoreAccess = async (userId: string) => {
    const result = await updateAccess(userId, "active");
    if (!result.success) {
      Alert.alert("Error", result.error || "Failed to restore access");
    }
  };

  const handleApproveMember = async (userId: string) => {
    const result = await approveMember(userId);
    if (!result.success) {
      Alert.alert("Error", result.error || "Failed to approve member");
    }
  };

  const handleRejectMember = async (userId: string) => {
    Alert.alert(
      "Reject Request",
      "Are you sure you want to reject this membership request?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reject",
          style: "destructive",
          onPress: async () => {
            const result = await rejectMember(userId);
            if (!result.success) {
              Alert.alert("Error", result.error || "Failed to reject request");
            }
          },
        },
      ]
    );
  };

  return (
    <>
      <View style={baseStyles.section}>
        <Pressable
          style={({ pressed }) => [baseStyles.sectionHeader, pressed && { opacity: 0.7 }]}
          onPress={() => setExpanded((prev) => !prev)}
        >
          <View style={baseStyles.sectionHeaderLeft}>
            <Users size={20} color={colors.muted} />
            <Text style={baseStyles.sectionTitle}>Access Control</Text>
            {totalPending > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{totalPending}</Text>
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
            {membersLoading ? (
              <View style={baseStyles.loadingContainer}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : (
              <>
                {totalPending > 0 && (
                  <>
                    <Text style={styles.subsectionTitle}>Pending Approvals</Text>
                    {[...pendingMembers, ...pendingAlumni].map((member) => (
                      <View key={member.user_id} style={styles.memberItem}>
                        <View style={styles.memberInfo}>
                          {member.user?.avatar_url ? (
                            <Image
                              source={member.user.avatar_url}
                              style={styles.memberAvatar}
                              contentFit="cover"
                              transition={200}
                            />
                          ) : (
                            <View style={styles.memberAvatarPlaceholder}>
                              <Text style={styles.memberAvatarText}>
                                {(member.user?.name || member.user?.email || "?").charAt(0).toUpperCase()}
                              </Text>
                            </View>
                          )}
                          <View style={styles.memberDetails}>
                            <Text style={styles.memberName} numberOfLines={1} ellipsizeMode="tail">
                              {member.user?.name || member.user?.email || "Unknown"}
                            </Text>
                            <Text style={styles.memberEmail} numberOfLines={1} ellipsizeMode="middle">{member.user?.email}</Text>
                            <Text style={styles.memberMeta}>
                              Requested {formatDate(member.created_at)} • {getRoleLabel(member.role)}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.memberActions}>
                          <Pressable
                            style={styles.approveButton}
                            onPress={() => handleApproveMember(member.user_id)}
                          >
                            <Check size={16} color={colors.success} />
                          </Pressable>
                          <Pressable
                            style={styles.rejectButton}
                            onPress={() => handleRejectMember(member.user_id)}
                          >
                            <X size={16} color={colors.error} />
                          </Pressable>
                        </View>
                      </View>
                    ))}
                    <View style={baseStyles.divider} />
                  </>
                )}

                <Text style={styles.subsectionTitle}>Active Members ({activeMembers.length})</Text>
                {activeMembers.map((member) => (
                  <View key={member.user_id} style={styles.memberItem}>
                    <View style={styles.memberInfo}>
                      {member.user?.avatar_url ? (
                        <Image
                          source={member.user.avatar_url}
                          style={styles.memberAvatar}
                          contentFit="cover"
                          transition={200}
                        />
                      ) : (
                        <View style={styles.memberAvatarPlaceholder}>
                          <Text style={styles.memberAvatarText}>
                            {(member.user?.name || member.user?.email || "?").charAt(0).toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View style={styles.memberDetails}>
                        <Text style={styles.memberName} numberOfLines={1} ellipsizeMode="tail">{member.user?.name || member.user?.email || "Unknown"}</Text>
                        <Text style={styles.memberEmail} numberOfLines={1} ellipsizeMode="middle">{member.user?.email}</Text>
                      </View>
                    </View>
                    <View style={styles.memberActions}>
                      <Pressable
                        style={styles.roleSelector}
                        onPress={() => {
                          Alert.alert("Change Role", "Select a new role for this member", [
                            { text: "Cancel", style: "cancel" },
                            { text: "Active Member", onPress: () => handleRoleChange(member.user_id, "active_member") },
                            { text: "Alumni", onPress: () => handleRoleChange(member.user_id, "alumni") },
                            { text: "Admin", onPress: () => handleRoleChange(member.user_id, "admin") },
                          ]);
                        }}
                      >
                        {roleChanging === member.user_id ? (
                          <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                          <>
                            <Text style={styles.roleSelectorText} numberOfLines={1}>{getRoleLabel(member.role)}</Text>
                            <ChevronDown size={14} color={colors.mutedForeground} />
                          </>
                        )}
                      </Pressable>
                      <Pressable
                        style={styles.removeButton}
                        onPress={() => handleRemoveAccess(member.user_id)}
                      >
                        <X size={16} color={colors.error} />
                      </Pressable>
                    </View>
                  </View>
                ))}

                {revokedMembers.length > 0 && (
                  <>
                    <View style={baseStyles.divider} />
                    <Text style={styles.subsectionTitle}>Revoked Access ({revokedMembers.length})</Text>
                    {revokedMembers.map((member) => (
                      <View key={member.user_id} style={[styles.memberItem, styles.memberItemRevoked]}>
                        <View style={styles.memberInfo}>
                          <View style={styles.memberAvatarPlaceholder}>
                            <Text style={styles.memberAvatarText}>
                              {(member.user?.name || member.user?.email || "?").charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          <View style={styles.memberDetails}>
                            <Text style={styles.memberName} numberOfLines={1} ellipsizeMode="tail">
                              {member.user?.name || member.user?.email || "Unknown"}
                            </Text>
                            <Text style={styles.memberEmail} numberOfLines={1} ellipsizeMode="middle">{member.user?.email}</Text>
                          </View>
                        </View>
                        <Pressable
                          style={styles.restoreButton}
                          onPress={() => handleRestoreAccess(member.user_id)}
                        >
                          <Text style={styles.restoreButtonText}>Restore</Text>
                        </Pressable>
                      </View>
                    ))}
                  </>
                )}
              </>
            )}
          </View>
        )}
      </View>

      <Modal visible={showAdminConfirm} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Promote to Admin?</Text>
            <Text style={styles.modalDescription}>
              Admins have full access to organization settings, billing, and member management.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => {
                  setShowAdminConfirm(false);
                  setPendingAdminUserId(null);
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalConfirmButton} onPress={confirmAdminPromotion}>
                <Text style={styles.modalConfirmText}>Promote</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
