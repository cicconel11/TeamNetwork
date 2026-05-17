import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, View, Text, ScrollView, ActivityIndicator, StyleSheet, Pressable, Share } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Mail, MessageCircle, Share as ShareIcon, Linkedin, Flag, ShieldOff } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { useAuth } from "@/hooks/useAuth";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { openEmailAddress, openHttpsUrl } from "@/lib/url-safety";
import { ensureMobileDirectChatGroup } from "@/lib/chat-helpers";
import { showToast } from "@/components/ui/Toast";
import { useBlockedUsers } from "@/contexts/BlockedUsersContext";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import { ReportBlockSheet } from "@/components/moderation/ReportBlockSheet";
import * as sentry from "@/lib/analytics/sentry";

const DETAIL_COLORS = {
  background: "#ffffff",
  primaryText: "#0f172a",
  secondaryText: "#64748b",
  mutedText: "#94a3b8",
  border: "#e2e8f0",
  card: "#f8fafc",
  success: "#059669",
  successLight: "#d1fae5",
  successDark: "#047857",
  error: "#ef4444",
};

interface Member {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  photo_url: string | null;
  graduation_year: number | null;
  role: string | null;
  linkedin_url: string | null;
  user_id: string | null;
}

export default function MemberProfileScreen() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const { orgId, orgSlug } = useOrg();
  const { user } = useAuth();
  const router = useRouter();
  const styles = useMemo(() => createStyles(), []);
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingChat, setOpeningChat] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const [unblockLoading, setUnblockLoading] = useState(false);
  const { blockedUserIds, toggleBlock } = useBlockedUsers();
  const isSelf = !!member?.user_id && member.user_id === user?.id;
  const isBlocked = !!member?.user_id && blockedUserIds.has(member.user_id);
  const canReport = !!member && !isSelf;
  const canBlock = !!member?.user_id && !isSelf;

  const handleUnblock = useCallback(async () => {
    if (!member?.user_id) return;
    Alert.alert(
      "Unblock this user?",
      "Their content will be visible again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unblock",
          onPress: async () => {
            try {
              setUnblockLoading(true);
              await toggleBlock(member.user_id!);
              showToast("Unblocked", "success");
            } catch (e) {
              const message = (e as Error).message || "Failed to unblock";
              showToast(message, "error");
              sentry.captureException(e as Error, {
                context: "MemberProfile.unblock",
              });
            } finally {
              setUnblockLoading(false);
            }
          },
        },
      ],
    );
  }, [member?.user_id]);

  const headerMenuItems = useMemo<OverflowMenuItem[]>(() => {
    if (!canReport) return [];
    const items: OverflowMenuItem[] = [
      {
        id: "report",
        label: "Report",
        icon: <Flag size={20} color={DETAIL_COLORS.primaryText} />,
        onPress: () => setReportSheetOpen(true),
      },
    ];
    if (canBlock) {
      items.push(
        isBlocked
          ? {
              id: "unblock",
              label: "Unblock",
              icon: <ShieldOff size={20} color={DETAIL_COLORS.primaryText} />,
              onPress: handleUnblock,
            }
          : {
              id: "block",
              label: "Block",
              icon: <ShieldOff size={20} color={DETAIL_COLORS.error} />,
              destructive: true,
              onPress: () => setReportSheetOpen(true),
            },
      );
    }
    return items;
  }, [canReport, canBlock, isBlocked, handleUnblock]);

  useEffect(() => {
    async function fetchMember() {
      if (!memberId || !orgId) return;

      try {
        setLoading(true);
        const { data, error: memberError } = await supabase
          .from("members")
          .select("id, first_name, last_name, email, photo_url, graduation_year, role, linkedin_url, user_id")
          .eq("id", memberId)
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .single();

        if (memberError) throw memberError;
        setMember(data as Member);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }

    fetchMember();
  }, [memberId, orgId]);

  const handleEmail = () => {
    if (member?.email) {
      void openEmailAddress(member.email);
    }
  };

  const handleShareEmail = async () => {
    if (member?.email) {
      await Share.share({ message: member.email });
    }
  };

  const handleLinkedIn = () => {
    if (member?.linkedin_url) {
      void openHttpsUrl(member.linkedin_url);
    }
  };

  const handleMessage = async () => {
    if (!member || !orgId || !orgSlug || !user?.id || openingChat) return;

    if (!member.user_id) {
      showToast("This member hasn't linked an app account yet.", "info");
      return;
    }

    setOpeningChat(true);
    try {
      const result = await ensureMobileDirectChatGroup(supabase, {
        organizationId: orgId,
        currentUserId: user.id,
        recipientUserId: member.user_id,
        recipientDisplayName: getDisplayName(),
      });

      if (!result.ok) {
        showToast(result.error, "error");
        return;
      }

      router.push(`/(app)/${orgSlug}/chat/${result.chatGroupId}`);
    } finally {
      setOpeningChat(false);
    }
  };

  const getInitials = () => {
    if (member?.first_name && member?.last_name) {
      return (member.first_name[0] + member.last_name[0]).toUpperCase();
    }
    if (member?.first_name) {
      return member.first_name[0].toUpperCase();
    }
    return member?.email?.[0]?.toUpperCase() || "?";
  };

  const getDisplayName = () => {
    if (member?.first_name && member?.last_name) {
      return `${member.first_name} ${member.last_name}`;
    }
    return member?.first_name || member?.email || "Unknown";
  };

  const getRoleLabel = (role: string | null) => {
    if (role === "admin") return "Admin";
    if (role === "member" || role === "active_member") return "Member";
    return "Member";
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={DETAIL_COLORS.success} />
      </View>
    );
  }

  if (error || !member) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.errorText}>{error || "Member not found"}</Text>
        <Pressable style={({ pressed }) => [styles.backButtonAlt, pressed && { opacity: 0.7 }]} onPress={() => router.back()}>
          <Text style={styles.backButtonAltText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Gradient Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.navHeader}>
            <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.7 }]}>
              <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                Member Profile
              </Text>
            </View>
            {headerMenuItems.length > 0 && (
              <OverflowMenu
                items={headerMenuItems}
                iconColor={APP_CHROME.headerTitle}
                accessibilityLabel="Profile options"
              />
            )}
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content */}
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.profileHeader, isBlocked && styles.dimmed]}>
          {member.photo_url ? (
            <Image source={member.photo_url} style={styles.avatarImage} contentFit="cover" transition={200} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarText}>{getInitials()}</Text>
            </View>
          )}
          <Text style={styles.name}>{getDisplayName()}</Text>
          <Text style={styles.role}>{getRoleLabel(member.role)}</Text>
          {member.graduation_year && (
            <Text style={styles.year}>Class of {member.graduation_year}</Text>
          )}

          {member.user_id && member.user_id !== user?.id && (
            <Pressable
              style={({ pressed }) => [
                styles.messageButton,
                (pressed || openingChat) && { opacity: 0.75 },
              ]}
              onPress={handleMessage}
              disabled={openingChat}
              accessibilityRole="button"
              accessibilityLabel={`Message ${getDisplayName()}`}
            >
              {openingChat ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <MessageCircle size={20} color="#ffffff" />
              )}
              <Text style={styles.messageButtonText}>
                {openingChat ? "Opening..." : "Message"}
              </Text>
            </Pressable>
          )}
        </View>

        {canReport && (
          <View style={styles.moderationActions}>
            <Pressable
              style={({ pressed }) => [
                styles.moderationButton,
                styles.moderationButtonSecondary,
                pressed && { opacity: 0.7 },
              ]}
              onPress={() => setReportSheetOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Report user"
            >
              <Flag size={18} color={DETAIL_COLORS.primaryText} />
              <Text style={styles.moderationButtonSecondaryText}>Report</Text>
            </Pressable>
            {canBlock && (
              isBlocked ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.moderationButton,
                    styles.moderationButtonSecondary,
                    (pressed || unblockLoading) && { opacity: 0.7 },
                  ]}
                  onPress={handleUnblock}
                  disabled={unblockLoading}
                  accessibilityRole="button"
                  accessibilityLabel="Unblock user"
                >
                  <ShieldOff size={18} color={DETAIL_COLORS.primaryText} />
                  <Text style={styles.moderationButtonSecondaryText}>
                    {unblockLoading ? "Unblocking…" : "Unblock"}
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  style={({ pressed }) => [
                    styles.moderationButton,
                    styles.moderationButtonDestructive,
                    pressed && { opacity: 0.85 },
                  ]}
                  onPress={() => setReportSheetOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Block user"
                >
                  <ShieldOff size={18} color="#ffffff" />
                  <Text style={styles.moderationButtonDestructiveText}>Block</Text>
                </Pressable>
              )
            )}
          </View>
        )}

        {isBlocked && (
          <View style={styles.blockedNotice}>
            <Text style={styles.blockedNoticeText}>
              You blocked this user. Their content is hidden everywhere.
            </Text>
          </View>
        )}

        <View style={[styles.contactSection, isBlocked && styles.dimmed]}>
          <Text style={styles.sectionTitle}>Contact</Text>

          {member.email && (
            <>
              <Pressable style={({ pressed }) => [styles.contactButton, pressed && { opacity: 0.7 }]} onPress={handleEmail}>
                <Mail size={20} color={DETAIL_COLORS.success} />
                <View style={styles.contactInfo}>
                  <Text style={styles.contactLabel}>Email</Text>
                  <Text style={styles.contactValue} numberOfLines={1}>
                    {member.email}
                  </Text>
                </View>
              </Pressable>

              <Pressable style={({ pressed }) => [styles.contactButton, pressed && { opacity: 0.7 }]} onPress={handleShareEmail}>
                <ShareIcon size={20} color={DETAIL_COLORS.success} />
                <Text style={styles.contactButtonText}>Share email address</Text>
              </Pressable>
            </>
          )}

          {member.linkedin_url && (
            <Pressable style={({ pressed }) => [styles.contactButton, pressed && { opacity: 0.7 }]} onPress={handleLinkedIn}>
              <Linkedin size={20} color={DETAIL_COLORS.success} />
              <Text style={styles.contactButtonText}>View LinkedIn Profile</Text>
            </Pressable>
          )}

          {!member.email && !member.linkedin_url && (
            <Text style={styles.noContactText}>No contact information available</Text>
          )}
        </View>
      </ScrollView>

      <ReportBlockSheet
        visible={reportSheetOpen}
        onClose={() => setReportSheetOpen(false)}
        orgId={orgId}
        targetType="user_profile"
        targetId={member.user_id ?? member.id}
        reportedUserId={member.user_id ?? null}
        hideBlock={!member.user_id}
      />
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: DETAIL_COLORS.background,
    },
    centered: {
      justifyContent: "center",
      alignItems: "center",
      padding: SPACING.lg,
    },
    headerGradient: {
      paddingBottom: SPACING.xs,
    },
    headerSafeArea: {},
    navHeader: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.xs,
      minHeight: 40,
      gap: SPACING.sm,
    },
    backButton: {
      padding: SPACING.xs,
      marginLeft: -SPACING.xs,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: SPACING.xxl,
    },
    profileHeader: {
      alignItems: "center",
      marginBottom: SPACING.lg,
    },
    avatarImage: {
      width: 88,
      height: 88,
      borderRadius: 44,
      marginBottom: SPACING.md,
    },
    avatarPlaceholder: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: DETAIL_COLORS.successLight,
      justifyContent: "center",
      alignItems: "center",
      marginBottom: SPACING.md,
    },
    avatarText: {
      fontSize: 32,
      fontWeight: "600",
      color: DETAIL_COLORS.successDark,
    },
    name: {
      ...TYPOGRAPHY.headlineMedium,
      color: DETAIL_COLORS.primaryText,
      marginBottom: 4,
    },
    role: {
      ...TYPOGRAPHY.bodyMedium,
      color: DETAIL_COLORS.mutedText,
    },
    year: {
      ...TYPOGRAPHY.bodySmall,
      color: DETAIL_COLORS.secondaryText,
      marginTop: 2,
    },
    messageButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: SPACING.sm,
      marginTop: SPACING.md,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.lg,
      borderRadius: RADIUS.lg,
      backgroundColor: DETAIL_COLORS.success,
      minWidth: 160,
    },
    messageButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: "#ffffff",
      fontWeight: "600",
    },
    contactSection: {
      backgroundColor: DETAIL_COLORS.card,
      borderRadius: RADIUS.lg,
      padding: SPACING.md,
    },
    moderationActions: {
      flexDirection: "row" as const,
      gap: SPACING.sm,
      marginBottom: SPACING.md,
    },
    moderationButton: {
      flex: 1,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: SPACING.xs,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.md,
      borderRadius: RADIUS.md,
    },
    moderationButtonSecondary: {
      backgroundColor: DETAIL_COLORS.card,
      borderWidth: 1,
      borderColor: DETAIL_COLORS.border,
    },
    moderationButtonSecondaryText: {
      ...TYPOGRAPHY.labelMedium,
      color: DETAIL_COLORS.primaryText,
      fontWeight: "600" as const,
    },
    moderationButtonDestructive: {
      backgroundColor: DETAIL_COLORS.error,
    },
    moderationButtonDestructiveText: {
      ...TYPOGRAPHY.labelMedium,
      color: "#ffffff",
      fontWeight: "600" as const,
    },
    blockedNotice: {
      backgroundColor: "#fef2f2",
      borderRadius: RADIUS.md,
      padding: SPACING.md,
      marginBottom: SPACING.md,
    },
    blockedNoticeText: {
      ...TYPOGRAPHY.bodySmall,
      color: DETAIL_COLORS.error,
      textAlign: "center" as const,
    },
    dimmed: {
      opacity: 0.4,
    },
    sectionTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: DETAIL_COLORS.primaryText,
      marginBottom: SPACING.md,
    },
    contactButton: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: SPACING.sm,
      gap: SPACING.sm,
      borderBottomWidth: 1,
      borderBottomColor: DETAIL_COLORS.border,
    },
    contactInfo: {
      flex: 1,
    },
    contactLabel: {
      ...TYPOGRAPHY.labelSmall,
      color: DETAIL_COLORS.mutedText,
    },
    contactValue: {
      ...TYPOGRAPHY.bodyMedium,
      color: DETAIL_COLORS.primaryText,
      marginTop: 2,
    },
    contactButtonText: {
      ...TYPOGRAPHY.bodyMedium,
      color: DETAIL_COLORS.success,
      fontWeight: "500",
    },
    noContactText: {
      ...TYPOGRAPHY.bodySmall,
      color: DETAIL_COLORS.secondaryText,
      textAlign: "center",
      paddingVertical: SPACING.md,
    },
    errorText: {
      ...TYPOGRAPHY.bodyMedium,
      color: DETAIL_COLORS.error,
      textAlign: "center",
      marginBottom: SPACING.md,
    },
    backButtonAlt: {
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.md,
      borderRadius: RADIUS.md,
      backgroundColor: DETAIL_COLORS.success,
    },
    backButtonAltText: {
      ...TYPOGRAPHY.labelMedium,
      color: "#ffffff",
    },
  });
