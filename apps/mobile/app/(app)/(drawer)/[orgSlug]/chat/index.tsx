import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  Image,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useRouter, useNavigation } from "expo-router";
import { MessageCircle } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { APP_CHROME } from "@/lib/chrome";
import { spacing, borderRadius, fontSize, fontWeight } from "@/lib/theme";
import type { ChatGroup, ChatGroupMember } from "@teammeet/types";

const CHAT_COLORS = {
  background: "#ffffff",
  card: "#ffffff",
  border: "#e2e8f0",
  title: "#0f172a",
  subtitle: "#64748b",
  muted: "#94a3b8",
  accent: "#059669",
  pending: "#f59e0b",
  emptyIcon: "#cbd5f5",
};

type ChatGroupWithMembers = ChatGroup & {
  chat_group_members: Pick<ChatGroupMember, "id" | "user_id" | "role">[];
};

export default function ChatGroupsScreen() {
  const { orgId, orgSlug, orgName, orgLogoUrl } = useOrg();
  const { isAdmin } = useOrgRole();
  const router = useRouter();
  const navigation = useNavigation();
  const styles = useMemo(() => createStyles(), []);
  const isMountedRef = useRef(true);

  // Safe drawer toggle - only dispatch if drawer is available
  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available - no-op
    }
  }, [navigation]);
  const [groups, setGroups] = useState<ChatGroupWithMembers[]>([]);
  const [pendingCounts, setPendingCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchGroups = useCallback(async () => {
    if (!orgId) {
      if (isMountedRef.current) {
        setGroups([]);
        setPendingCounts({});
        setLoading(false);
        setError(null);
      }
      return;
    }

    try {
      setLoading(true);
      const { data: groupsData, error: groupsError } = await supabase
        .from("chat_groups")
        .select("*, chat_group_members (id, user_id, role)")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("is_default", { ascending: false })
        .order("name", { ascending: true });

      if (groupsError) throw groupsError;

      let counts: Record<string, number> = {};
      if (isAdmin) {
        const { data: pendingMessages, error: pendingError } = await supabase
          .from("chat_messages")
          .select("chat_group_id")
          .eq("organization_id", orgId)
          .eq("status", "pending")
          .is("deleted_at", null);

        if (pendingError) throw pendingError;

        if (pendingMessages) {
          counts = pendingMessages.reduce((acc, msg) => {
            acc[msg.chat_group_id] = (acc[msg.chat_group_id] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
        }
      }

      if (isMountedRef.current) {
        setGroups((groupsData || []) as ChatGroupWithMembers[]);
        setPendingCounts(counts);
        setError(null);
      }
    } catch (e) {
      if (isMountedRef.current) {
        setError((e as Error).message);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [orgId, isAdmin]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchGroups();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchGroups]);

  useEffect(() => {
    if (!orgId) return;
    const groupsChannel = supabase
      .channel(`chat_groups:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_groups",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchGroups();
        }
      )
      .subscribe();

    const membersChannel = supabase
      .channel(`chat_group_members:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_group_members",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchGroups();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(groupsChannel);
      supabase.removeChannel(membersChannel);
    };
  }, [orgId, fetchGroups]);

  useEffect(() => {
    if (!orgId || !isAdmin) return;
    const pendingChannel = supabase
      .channel(`chat_messages_pending:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_messages",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchGroups();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(pendingChannel);
    };
  }, [orgId, isAdmin, fetchGroups]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchGroups();
    setRefreshing(false);
  }, [fetchGroups]);

  const handleOpenGroup = useCallback(
    (groupId: string) => {
      router.push(`/(app)/${orgSlug}/chat/${groupId}`);
    },
    [router, orgSlug]
  );

  const renderGroup = useCallback(
    ({ item }: { item: ChatGroupWithMembers }) => {
      const memberCount = item.chat_group_members?.length || 0;
      const pendingCount = pendingCounts[item.id] || 0;
      return (
        <Pressable
          onPress={() => handleOpenGroup(item.id)}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          accessibilityRole="button"
          accessibilityLabel={`Open ${item.name}`}
        >
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.name}
              </Text>
              {item.is_default && (
                <View style={styles.defaultBadge}>
                  <Text style={styles.defaultBadgeText}>Default</Text>
                </View>
              )}
            </View>
            <MessageCircle size={18} color={CHAT_COLORS.muted} />
          </View>
          {item.description ? (
            <Text style={styles.cardDescription} numberOfLines={2}>
              {item.description}
            </Text>
          ) : null}
          <View style={styles.cardFooter}>
            <Text style={styles.cardMeta}>
              {memberCount} member{memberCount !== 1 ? "s" : ""}
              {item.require_approval ? " · Approval required" : ""}
            </Text>
            {pendingCount > 0 ? (
              <View style={styles.pendingBadge}>
                <Text style={styles.pendingBadgeText}>{pendingCount} pending</Text>
              </View>
            ) : null}
          </View>
        </Pressable>
      );
    },
    [handleOpenGroup, pendingCounts, styles]
  );

  if (loading && groups.length === 0) {
    return (
      <View style={styles.container}>
        {/* Custom Gradient Header */}
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
                    <Text style={styles.orgAvatarText}>{orgName?.[0]}</Text>
                  </View>
                )}
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Chat</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>

        {/* Content Sheet */}
        <View style={styles.contentSheet}>
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={CHAT_COLORS.accent} />
          </View>
        </View>
      </View>
    );
  }

  if (error && groups.length === 0) {
    return (
      <View style={styles.container}>
        {/* Custom Gradient Header */}
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
                    <Text style={styles.orgAvatarText}>{orgName?.[0]}</Text>
                  </View>
                )}
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Chat</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>

        {/* Content Sheet */}
        <View style={styles.contentSheet}>
          <View style={styles.centered}>
            <Text style={styles.errorTitle}>Unable to load chat</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              style={styles.retryButton}
              onPress={fetchGroups}
              accessibilityRole="button"
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Custom Gradient Header */}
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
                  <Text style={styles.orgAvatarText}>{orgName?.[0]}</Text>
                </View>
              )}
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Chat</Text>
              <Text style={styles.headerMeta}>{groups.length} {groups.length === 1 ? "group" : "groups"}</Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content Sheet */}
      <View style={styles.contentSheet}>
        <FlatList
          data={groups}
          keyExtractor={(item) => item.id}
          renderItem={renderGroup}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={CHAT_COLORS.accent} />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <MessageCircle size={28} color={CHAT_COLORS.muted} />
              </View>
              <Text style={styles.emptyTitle}>No chat groups yet</Text>
              <Text style={styles.emptyText}>
                Chat groups will appear here once they are created.
              </Text>
            </View>
          }
        />
      </View>
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: CHAT_COLORS.background,
    },
    // Gradient header styles
    headerGradient: {
      paddingBottom: spacing.md,
    },
    headerSafeArea: {
      // SafeAreaView handles top inset
    },
    headerContent: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      minHeight: 40,
      gap: spacing.sm,
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
      fontSize: fontSize.base,
      fontWeight: fontWeight.bold,
      color: APP_CHROME.avatarText,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: APP_CHROME.headerTitle,
    },
    headerMeta: {
      fontSize: fontSize.xs,
      color: APP_CHROME.headerMeta,
      marginTop: 2,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: CHAT_COLORS.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      marginTop: -16,
      overflow: "hidden",
    },
    listContent: {
      padding: spacing.md,
      gap: spacing.sm,
    },
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: spacing.lg,
      gap: spacing.sm,
    },
    card: {
      backgroundColor: CHAT_COLORS.card,
      borderRadius: borderRadius.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: CHAT_COLORS.border,
      padding: spacing.md,
      gap: spacing.xs,
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
    },
    cardPressed: {
      opacity: 0.85,
    },
    cardHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    cardTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      flex: 1,
      paddingRight: spacing.sm,
    },
    cardTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: CHAT_COLORS.title,
      flex: 1,
    },
    defaultBadge: {
      backgroundColor: "rgba(5, 150, 105, 0.12)",
      paddingVertical: 2,
      paddingHorizontal: 8,
      borderRadius: borderRadius.sm,
    },
    defaultBadgeText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: CHAT_COLORS.accent,
    },
    cardDescription: {
      fontSize: fontSize.sm,
      color: CHAT_COLORS.subtitle,
      lineHeight: 20,
    },
    cardFooter: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    cardMeta: {
      fontSize: fontSize.xs,
      color: CHAT_COLORS.muted,
    },
    pendingBadge: {
      backgroundColor: "rgba(245, 158, 11, 0.15)",
      paddingVertical: 2,
      paddingHorizontal: 8,
      borderRadius: borderRadius.sm,
    },
    pendingBadgeText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: CHAT_COLORS.pending,
    },
    errorTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: CHAT_COLORS.title,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: CHAT_COLORS.subtitle,
      textAlign: "center",
    },
    retryButton: {
      backgroundColor: CHAT_COLORS.accent,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.md,
    },
    retryButtonText: {
      color: "#ffffff",
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
    },
    emptyState: {
      alignItems: "center",
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing.md,
      gap: spacing.sm,
    },
    emptyIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#f1f5f9",
    },
    emptyTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: CHAT_COLORS.title,
    },
    emptyText: {
      fontSize: fontSize.sm,
      color: CHAT_COLORS.subtitle,
      textAlign: "center",
    },
  });
