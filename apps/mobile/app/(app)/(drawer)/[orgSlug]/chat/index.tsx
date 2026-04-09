import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useRouter, useNavigation } from "expo-router";
import { MessageCircle, Pin, Lock, Plus } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { Avatar } from "@/components/ui/Avatar";
import { SkeletonList } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui";
import { useNetwork } from "@/contexts/NetworkContext";
import { APP_CHROME } from "@/lib/chrome";
import { spacing, borderRadius, fontSize, fontWeight } from "@/lib/theme";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import type { ChatGroup, ChatGroupMember } from "@teammeet/types";
import type { Tables } from "@teammeet/types";

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

type DiscussionThread = Tables<"discussion_threads">;
type ThreadWithAuthor = DiscussionThread & {
  author?: { name: string } | null;
};

export default function ChatGroupsScreen() {
  const { orgId, orgSlug, orgName, orgLogoUrl } = useOrg();
  const { isAdmin } = useOrgRole();
  const router = useRouter();
  const navigation = useNavigation();
  const { neutral } = useAppColorScheme();
  const { isOffline } = useNetwork();
  const styles = useMemo(() => createStyles(neutral.surface), [neutral.surface]);
  const isMountedRef = useRef(true);

  // Safe drawer toggle
  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available - no-op
    }
  }, [navigation]);

  // Channels state (existing)
  const [groups, setGroups] = useState<ChatGroupWithMembers[]>([]);
  const [pendingCounts, setPendingCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Threads state (new)
  const [threads, setThreads] = useState<ThreadWithAuthor[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadsError, setThreadsError] = useState<string | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<"channels" | "threads">("channels");

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

  const fetchThreads = useCallback(async () => {
    if (!orgId) {
      if (isMountedRef.current) {
        setThreads([]);
        setThreadsLoading(false);
        setThreadsError(null);
      }
      return;
    }

    try {
      setThreadsLoading(true);
      const { data, error: threadsErr } = await supabase
        .from("discussion_threads")
        .select("*, author:users!discussion_threads_author_id_fkey(name)")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("is_pinned", { ascending: false })
        .order("last_activity_at", { ascending: false })
        .limit(50);

      if (threadsErr) throw threadsErr;

      if (isMountedRef.current) {
        setThreads((data || []) as ThreadWithAuthor[]);
        setThreadsError(null);
      }
    } catch (e) {
      if (isMountedRef.current) {
        setThreadsError((e as Error).message);
      }
    } finally {
      if (isMountedRef.current) {
        setThreadsLoading(false);
      }
    }
  }, [orgId]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchGroups();
    fetchThreads();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchGroups, fetchThreads]);

  // Channels realtime subscriptions
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

  // Pending messages subscription (admin only)
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

  // Threads realtime subscription
  useEffect(() => {
    if (!orgId) return;
    const threadsChannel = supabase
      .channel(`discussion_threads:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "discussion_threads",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchThreads();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(threadsChannel);
    };
  }, [orgId, fetchThreads]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchGroups(), fetchThreads()]);
    setRefreshing(false);
  }, [fetchGroups, fetchThreads]);

  const handleOpenGroup = useCallback(
    (groupId: string) => {
      router.push(`/(app)/${orgSlug}/chat/${groupId}`);
    },
    [router, orgSlug]
  );

  const handleOpenThread = useCallback(
    (threadId: string) => {
      router.push(`/(app)/${orgSlug}/chat/threads/${threadId}`);
    },
    [router, orgSlug]
  );

  const handleNewThread = useCallback(() => {
    router.push(`/(app)/${orgSlug}/chat/threads/new`);
  }, [router, orgSlug]);

  const renderGroup = useCallback(
    ({ item }: { item: ChatGroupWithMembers }) => {
      const memberCount = item.chat_group_members?.length || 0;
      const pendingCount = pendingCounts[item.id] || 0;

      return (
        <Pressable
          onPress={() => handleOpenGroup(item.id)}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          accessibilityRole="button"
          accessibilityLabel={`Open ${item.name}`}
        >
          <Avatar size="lg" name={item.name} />
          <View style={styles.rowContent}>
            <View style={styles.rowHeader}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.name}
              </Text>
              {item.is_default && (
                <View style={styles.defaultBadge}>
                  <Text style={styles.defaultBadgeText}>Default</Text>
                </View>
              )}
            </View>
            <Text style={styles.rowSubtitle} numberOfLines={1}>
              {item.description || `${memberCount} member${memberCount !== 1 ? "s" : ""}`}
            </Text>
          </View>
          {pendingCount > 0 ? (
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingBadgeText}>{pendingCount}</Text>
            </View>
          ) : null}
        </Pressable>
      );
    },
    [handleOpenGroup, pendingCounts, styles]
  );

  const renderThread = useCallback(
    ({ item }: { item: ThreadWithAuthor }) => {
      const authorName = item.author?.name || "Unknown";
      const formattedTime = formatRelativeTime(item.last_activity_at);

      return (
        <Pressable
          onPress={() => handleOpenThread(item.id)}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          accessibilityRole="button"
          accessibilityLabel={`Open thread: ${item.title}`}
        >
          <View style={styles.threadIconContainer}>
            {item.is_pinned && <Pin size={14} color={CHAT_COLORS.pending} />}
            {item.is_locked && <Lock size={14} color={CHAT_COLORS.muted} />}
            {!item.is_pinned && !item.is_locked && (
              <MessageCircle size={14} color={CHAT_COLORS.muted} />
            )}
          </View>
          <View style={styles.rowContent}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.rowSubtitle} numberOfLines={1}>
              {authorName} · {formattedTime}
            </Text>
          </View>
          {item.reply_count > 0 ? (
            <Text style={styles.replyCount}>{item.reply_count} replies</Text>
          ) : null}
        </Pressable>
      );
    },
    [handleOpenThread, styles]
  );

  // Loading state
  if ((loading || threadsLoading) && groups.length === 0 && threads.length === 0) {
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
                  <Image
                    source={orgLogoUrl}
                    style={styles.orgLogo}
                    contentFit="contain"
                    transition={200}
                  />
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

        <View style={styles.contentSheet}>
          <View style={styles.skeletonContainer}>
            <SkeletonList type="chat" count={6} />
          </View>
        </View>
      </View>
    );
  }

  // Error state
  if ((error || threadsError) && groups.length === 0 && threads.length === 0) {
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
                  <Image
                    source={orgLogoUrl}
                    style={styles.orgLogo}
                    contentFit="contain"
                    transition={200}
                  />
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

        <View style={styles.contentSheet}>
          <ErrorState
            onRetry={handleRefresh}
            title="Unable to load chat"
            isOffline={isOffline}
          />
        </View>
      </View>
    );
  }

  const displayData = activeTab === "channels" ? groups : threads;
  const isLoading = activeTab === "channels" ? loading : threadsLoading;
  const displayError = activeTab === "channels" ? error : threadsError;

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
                <Image
                  source={orgLogoUrl}
                  style={styles.orgLogo}
                  contentFit="contain"
                  transition={200}
                />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0]}</Text>
                </View>
              )}
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Chat</Text>
              <Text style={styles.headerMeta}>
                {displayData.length}{" "}
                {activeTab === "channels"
                  ? displayData.length === 1
                    ? "channel"
                    : "channels"
                  : displayData.length === 1
                    ? "thread"
                    : "threads"}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Segmented control */}
      <View style={styles.segmentedControl}>
        <Pressable
          onPress={() => setActiveTab("channels")}
          style={[styles.segment, activeTab === "channels" && styles.segmentActive]}
        >
          <Text
            style={[
              styles.segmentText,
              activeTab === "channels" && styles.segmentTextActive,
            ]}
          >
            Channels
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setActiveTab("threads")}
          style={[styles.segment, activeTab === "threads" && styles.segmentActive]}
        >
          <Text
            style={[
              styles.segmentText,
              activeTab === "threads" && styles.segmentTextActive,
            ]}
          >
            Threads
          </Text>
        </Pressable>
      </View>

      <View style={styles.contentSheet}>
        {displayError && displayData.length === 0 ? (
          <ErrorState
            onRetry={handleRefresh}
            title={`Unable to load ${activeTab === "channels" ? "channels" : "threads"}`}
            isOffline={isOffline}
          />
        ) : isLoading && displayData.length === 0 ? (
          <View style={styles.skeletonContainer}>
            <SkeletonList type="chat" count={6} />
          </View>
        ) : (
          <>
            {displayError ? (
              <View style={styles.inlineErrorBanner}>
                <Text style={styles.inlineErrorText}>{displayError}</Text>
                <Pressable
                  onPress={handleRefresh}
                  style={({ pressed }) => [
                    styles.inlineRetryButton,
                    pressed && styles.inlineRetryButtonPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Retry loading ${activeTab}`}
                >
                  <Text style={styles.inlineRetryText}>Retry</Text>
                </Pressable>
              </View>
            ) : null}
            {activeTab === "channels" ? (
              <FlatList
                data={groups}
                keyExtractor={(item) => item.id}
                renderItem={renderGroup}
                contentContainerStyle={styles.listContent}
                refreshControl={
                  <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
                }
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <View style={styles.emptyIcon}>
                      <MessageCircle size={28} color={CHAT_COLORS.muted} />
                    </View>
                    <Text style={styles.emptyTitle}>No channels yet</Text>
                    <Text style={styles.emptyText}>
                      Chat channels will appear here once they are created.
                    </Text>
                  </View>
                }
                initialNumToRender={10}
                maxToRenderPerBatch={10}
                windowSize={5}
                removeClippedSubviews={true}
              />
            ) : (
              <FlatList
                data={threads}
                keyExtractor={(item) => item.id}
                renderItem={renderThread}
                contentContainerStyle={styles.listContent}
                refreshControl={
                  <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
                }
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <View style={styles.emptyIcon}>
                      <MessageCircle size={28} color={CHAT_COLORS.muted} />
                    </View>
                    <Text style={styles.emptyTitle}>No threads yet</Text>
                    <Text style={styles.emptyText}>
                      Start a discussion thread to begin.
                    </Text>
                  </View>
                }
                initialNumToRender={10}
                maxToRenderPerBatch={10}
                windowSize={5}
                removeClippedSubviews={true}
              />
            )}
          </>
        )}
      </View>

      {/* FAB for new thread */}
      {activeTab === "threads" && (
        <Pressable
          style={styles.fab}
          onPress={handleNewThread}
          accessibilityRole="button"
          accessibilityLabel="Create new thread"
        >
          <Plus size={24} color="#ffffff" />
        </Pressable>
      )}
    </View>
  );
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const createStyles = (surfaceColor: string) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: CHAT_COLORS.background,
    },
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
    segmentedControl: {
      flexDirection: "row",
      backgroundColor: "#f1f5f9",
      marginHorizontal: spacing.md,
      marginVertical: spacing.md,
      padding: 2,
      borderRadius: borderRadius.xl,
      gap: 2,
    },
    segment: {
      flex: 1,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: borderRadius.lg,
      alignItems: "center",
      justifyContent: "center",
    },
    segmentActive: {
      backgroundColor: "#ffffff",
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
    },
    segmentText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.normal,
      color: CHAT_COLORS.muted,
    },
    segmentTextActive: {
      fontWeight: fontWeight.semibold,
      color: CHAT_COLORS.title,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: surfaceColor,
    },
    listContent: {
      padding: spacing.md,
      gap: 0,
    },
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: spacing.lg,
      gap: spacing.sm,
    },
    skeletonContainer: {
      padding: spacing.md,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      gap: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: CHAT_COLORS.border,
    },
    rowPressed: {
      backgroundColor: "#f8fafc",
    },
    rowContent: {
      flex: 1,
      gap: 4,
    },
    rowHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    rowTitle: {
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
    rowSubtitle: {
      fontSize: fontSize.sm,
      color: CHAT_COLORS.subtitle,
    },
    threadIconContainer: {
      width: 24,
      height: 24,
      alignItems: "center",
      justifyContent: "center",
    },
    replyCount: {
      fontSize: fontSize.xs,
      color: CHAT_COLORS.muted,
      minWidth: 70,
      textAlign: "right",
    },
    pendingBadge: {
      backgroundColor: "rgba(245, 158, 11, 0.15)",
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: borderRadius.sm,
      minWidth: 40,
      alignItems: "center",
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
    inlineErrorBanner: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: "rgba(220, 38, 38, 0.08)",
      borderWidth: 1,
      borderColor: "rgba(220, 38, 38, 0.18)",
      borderRadius: borderRadius.md,
    },
    inlineErrorText: {
      flex: 1,
      fontSize: fontSize.xs,
      color: CHAT_COLORS.title,
    },
    inlineRetryButton: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      borderRadius: borderRadius.sm,
      backgroundColor: "#ffffff",
    },
    inlineRetryButtonPressed: {
      opacity: 0.7,
    },
    inlineRetryText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
      color: "#dc2626",
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
    fab: {
      position: "absolute",
      bottom: spacing.xl,
      right: spacing.xl,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: CHAT_COLORS.accent,
      alignItems: "center",
      justifyContent: "center",
      boxShadow: "0 2px 8px rgba(5, 150, 105, 0.3)",
    },
  });
