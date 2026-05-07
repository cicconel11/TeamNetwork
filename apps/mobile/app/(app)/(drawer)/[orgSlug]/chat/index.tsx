import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  ActivityIndicator,
  LayoutChangeEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useRouter, useNavigation } from "expo-router";
import { MessageCircle, Camera, Pin, Lock } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SkeletonList } from "@/components/ui/Skeleton";
import { Avatar } from "@/components/ui/Avatar";
import { APP_CHROME } from "@/lib/chrome";
import {
  SPACING,
  RADIUS,
  SHADOWS,
  ANIMATION,
  AVATAR_SIZES,
} from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { formatRelativeTime } from "@/lib/date-format";
import {
  buildCacheBustedUrl,
  readBlobFromUri,
  uploadToStorage,
} from "@/lib/uploads";
import {
  buildMobileDiscussionThreadRoute,
  buildMobileNewDiscussionThreadRoute,
  MOBILE_DISCUSSION_AUTHOR_SELECT,
  MOBILE_DISCUSSION_THREADS_TABLE,
} from "@/lib/chat-helpers";
import type {
  ChatGroup,
  ChatGroupMember,
  DiscussionThread,
} from "@teammeet/types";

type ActiveTab = "chat" | "discussions";

type ChatGroupWithMembers = ChatGroup & {
  avatar_url: string | null;
  chat_group_members: Pick<ChatGroupMember, "id" | "user_id" | "role">[];
};

type DiscussionThreadWithAuthor = DiscussionThread & {
  author?: { id: string; name: string | null; avatar_url: string | null } | null;
};

export default function ChatGroupsScreen() {
  const { orgId, orgSlug, orgName, orgLogoUrl } = useOrg();
  const { isAdmin } = useOrgRole();
  const router = useRouter();
  const navigation = useNavigation();
  const { neutral, semantic } = useAppColorScheme();
  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.surface,
    },
    headerGradient: {
      paddingBottom: SPACING.md,
    },
    headerSafeArea: {},
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
      ...TYPOGRAPHY.labelMedium,
      color: APP_CHROME.avatarText,
      fontWeight: "600",
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      ...TYPOGRAPHY.headlineSmall,
      color: APP_CHROME.headerTitle,
    },
    headerMeta: {
      ...TYPOGRAPHY.caption,
      color: APP_CHROME.headerMeta,
      marginTop: 2,
    },
    segmentedControl: {
      flexDirection: "row" as const,
      backgroundColor: n.divider,
      borderRadius: RADIUS.lg,
      padding: SPACING.xxs,
      marginHorizontal: SPACING.md,
      marginTop: SPACING.sm,
      marginBottom: SPACING.sm,
      position: "relative" as const,
    },
    segment: {
      flex: 1,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.md,
      borderRadius: RADIUS.md,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      zIndex: 1,
    },
    segmentPill: {
      position: "absolute" as const,
      top: SPACING.xxs,
      bottom: SPACING.xxs,
      width: "50%",
      borderRadius: RADIUS.md,
      backgroundColor: s.success,
      ...SHADOWS.sm,
    },
    segmentText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.muted,
    },
    segmentTextActive: {
      color: n.surface,
      fontWeight: "600",
    },
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
    },
    tabContentContainer: {
      flex: 1,
      position: "relative" as const,
    },
    tabPane: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: n.surface,
    },
    listContent: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      gap: 0,
    },
    centered: {
      flex: 1,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      padding: SPACING.lg,
      gap: SPACING.sm,
    },
    skeletonContainer: {
      padding: SPACING.md,
    },
    // Chat group row styles
    groupRow: {
      position: "relative" as const,
      minHeight: AVATAR_SIZES.md + SPACING.md * 2,
    },
    groupRowButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingVertical: SPACING.md,
      paddingHorizontal: 0,
      gap: SPACING.md,
      backgroundColor: n.surface,
      flex: 1,
    },
    groupRowPressed: {
      backgroundColor: n.divider,
    },
    groupAvatarContainer: {
      width: AVATAR_SIZES.md,
      height: AVATAR_SIZES.md,
      position: "relative" as const,
    },
    cameraBadge: {
      position: "absolute" as const,
      bottom: 0,
      right: 0,
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: s.success,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      borderWidth: 1.5,
      borderColor: n.surface,
    },
    cameraBadgeFloating: {
      position: "absolute" as const,
      left: AVATAR_SIZES.md - 18,
      top: SPACING.md + AVATAR_SIZES.md - 18,
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: s.success,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      borderWidth: 1.5,
      borderColor: n.surface,
      zIndex: 2,
    },
    avatarUploading: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: AVATAR_SIZES.md / 2,
      backgroundColor: "rgba(0,0,0,0.45)",
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    groupInfo: {
      flex: 1,
      gap: 2,
    },
    groupNameRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
    },
    groupName: {
      ...TYPOGRAPHY.titleSmall,
      color: n.foreground,
      flex: 1,
    },
    defaultBadge: {
      backgroundColor: "rgba(5, 150, 105, 0.12)",
      paddingVertical: 2,
      paddingHorizontal: 8,
      borderRadius: RADIUS.sm,
    },
    defaultBadgeText: {
      ...TYPOGRAPHY.labelSmall,
      color: s.success,
      fontWeight: "500",
    },
    groupMeta: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
    },
    groupRightContent: {
      flexDirection: "column" as const,
      alignItems: "flex-end" as const,
      gap: SPACING.xs,
    },
    pendingBadge: {
      minWidth: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: s.warning,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      paddingHorizontal: SPACING.xs,
    },
    pendingBadgeText: {
      ...TYPOGRAPHY.labelSmall,
      color: "#ffffff",
      fontWeight: "600",
    },
    separator: {
      height: 1,
      backgroundColor: n.divider,
      marginLeft: SPACING.md + AVATAR_SIZES.md + SPACING.md,
      marginVertical: 0,
    },
    // Discussion discussion row styles
    discussionRow: {
      paddingVertical: SPACING.md,
      paddingHorizontal: 0,
      backgroundColor: n.surface,
    },
    discussionContent: {
      flex: 1,
      gap: SPACING.xs,
    },
    discussionTitleRow: {
      flexDirection: "row" as const,
      alignItems: "flex-start" as const,
      gap: SPACING.xs,
    },
    pinIcon: {
      marginTop: 2,
      flexShrink: 0,
    },
    discussionTitle: {
      ...TYPOGRAPHY.titleSmall,
      color: n.foreground,
      flex: 1,
    },
    discussionMeta: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
    },
    discussionMetaText: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
      flex: 1,
    },
    // Discussions header
    discussionsHeader: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
      alignItems: "center" as const,
      paddingVertical: SPACING.md,
      paddingHorizontal: 0,
      borderBottomWidth: 1,
      borderBottomColor: n.divider,
    },
    discussionsHeaderText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.muted,
    },
    newDiscussionButton: {
      paddingVertical: SPACING.xs,
      paddingHorizontal: SPACING.sm,
      borderRadius: RADIUS.sm,
      backgroundColor: s.success,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    newDiscussionButtonText: {
      ...TYPOGRAPHY.labelSmall,
      color: n.surface,
      fontWeight: "600",
    },
    emptyContainer: {
      flex: 1,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.lg,
      gap: SPACING.md,
    },
    emptyText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.muted,
      textAlign: "center" as const,
    },
  }));

  const isMountedRef = useRef(true);

  // Tab state
  const [activeTab, setActiveTab] = useState<ActiveTab>("chat");
  const pillX = useSharedValue(0);
  const chatTabX = useRef(0);
  const discussionsTabX = useRef(0);

  // Chat groups state
  const [groups, setGroups] = useState<ChatGroupWithMembers[]>([]);
  const [pendingCounts, setPendingCounts] = useState<Record<string, number>>({});
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [errorGroups, setErrorGroups] = useState<string | null>(null);

  // Discussions state
  const [discussions, setDiscussions] = useState<DiscussionThreadWithAuthor[]>([]);
  const [loadingDiscussions, setLoadingDiscussions] = useState(true);

  // Refresh state (both tabs)
  const [refreshing, setRefreshing] = useState(false);

  // Avatar upload state
  const [uploadingGroupId, setUploadingGroupId] = useState<string | null>(null);
  const [localAvatarUrls, setLocalAvatarUrls] = useState<Record<string, string>>(
    {}
  );

  // Tab animation
  const chatOpacity = useSharedValue(1);
  const discussionsOpacity = useSharedValue(0);

  const opacityMap: Record<ActiveTab, SharedValue<number>> = {
    chat: chatOpacity,
    discussions: discussionsOpacity,
  };

  const chatAnimatedStyle = useAnimatedStyle(() => ({
    opacity: chatOpacity.value,
  }));

  const discussionsAnimatedStyle = useAnimatedStyle(() => ({
    opacity: discussionsOpacity.value,
  }));

  const pillAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }],
  }));

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available
    }
  }, [navigation]);

  const handleTabChange = useCallback(
    (tab: ActiveTab) => {
      setActiveTab(tab);
      const targetX = tab === "chat" ? chatTabX.current : discussionsTabX.current;
      pillX.value = withSpring(targetX, {
        damping: ANIMATION.spring.damping,
        stiffness: ANIMATION.spring.stiffness,
      });
      (["chat", "discussions"] as ActiveTab[]).forEach((t) => {
        opacityMap[t].value = withSpring(t === tab ? 1 : 0, {
          damping: ANIMATION.spring.damping,
          stiffness: ANIMATION.spring.stiffness,
        });
      });
    },
    [pillX, chatOpacity, discussionsOpacity]
  );

  const handleTabLayout = useCallback(
    (tab: ActiveTab, x: number) => {
      if (tab === "chat") chatTabX.current = x;
      else discussionsTabX.current = x;
      if (tab === activeTab) pillX.value = x;
    },
    [activeTab, pillX]
  );

  // Fetch chat groups
  const fetchGroups = useCallback(async () => {
    if (!orgId) {
      if (isMountedRef.current) {
        setGroups([]);
        setPendingCounts({});
        setLoadingGroups(false);
        setErrorGroups(null);
      }
      return;
    }

    try {
      const { data: groupsData, error: groupsError } = await supabase
        .from("chat_groups")
        .select("*, chat_group_members (id, user_id, role)")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("is_default", { ascending: false })
        .order("name", { ascending: true });

      if (groupsError) throw groupsError;

      let counts: Record<string, number> = {};
      if (isAdmin && groupsData) {
        const { data: pendingMessages, error: pendingError } = await supabase
          .from("chat_messages")
          .select("chat_group_id")
          .eq("organization_id", orgId)
          .eq("status", "pending")
          .is("deleted_at", null);

        if (pendingError) throw pendingError;

        if (pendingMessages) {
          counts = pendingMessages.reduce(
            (acc, msg) => {
              acc[msg.chat_group_id] = (acc[msg.chat_group_id] || 0) + 1;
              return acc;
            },
            {} as Record<string, number>
          );
        }
      }

      if (isMountedRef.current) {
        setGroups((groupsData || []) as ChatGroupWithMembers[]);
        setPendingCounts(counts);
        setErrorGroups(null);
      }
    } catch (e) {
      if (isMountedRef.current) {
        setErrorGroups((e as Error).message);
      }
    } finally {
      if (isMountedRef.current) setLoadingGroups(false);
    }
  }, [orgId, isAdmin]);

  // Fetch discussions
  const fetchDiscussions = useCallback(async () => {
    if (!orgId) {
      if (isMountedRef.current) {
        setDiscussions([]);
        setLoadingDiscussions(false);
      }
      return;
    }

    try {
      const { data, error } = await supabase
        .from(MOBILE_DISCUSSION_THREADS_TABLE)
        .select(`*, ${MOBILE_DISCUSSION_AUTHOR_SELECT}`)
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("is_pinned", { ascending: false })
        .order("last_activity_at", { ascending: false });

      if (error) throw error;

      if (isMountedRef.current) {
        setDiscussions((data || []) as DiscussionThreadWithAuthor[]);
      }
    } catch (e) {
      if (isMountedRef.current) {
        console.error("[chat-discussions] Failed to load discussions:", e);
        setDiscussions([]);
      }
    } finally {
      if (isMountedRef.current) setLoadingDiscussions(false);
    }
  }, [orgId]);

  // Handle group avatar upload
  const handleUploadGroupAvatar = useCallback(
    async (groupId: string) => {
      if (uploadingGroupId) return;

      const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!granted) return;

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled || !result.assets?.[0]) return;

      setUploadingGroupId(groupId);
      const asset = result.assets[0];
      const ext = (asset.fileName?.split(".").pop() ?? "jpg").toLowerCase();
      const path = `${orgId}/${groupId}.${ext}`;

      try {
        const blob = await readBlobFromUri(asset.uri);
        await uploadToStorage({
          storage: supabase.storage,
          bucket: "chat-group-avatars",
          path,
          body: blob,
          contentType: asset.mimeType ?? "image/jpeg",
          upsert: true,
        });

        const { data: urlData } = supabase.storage
          .from("chat-group-avatars")
          .getPublicUrl(path);
        const bustedUrl = buildCacheBustedUrl(urlData.publicUrl);

        // Optimistic update
        setLocalAvatarUrls((prev) => ({ ...prev, [groupId]: bustedUrl }));

        const { error: updateError } = await supabase
          .from("chat_groups")
          .update({ avatar_url: bustedUrl })
          .eq("id", groupId);

        if (updateError) throw updateError;
        // Realtime will trigger fetchGroups
      } catch (e) {
        // Rollback optimistic update
        setLocalAvatarUrls((prev) => {
          const { [groupId]: _, ...rest } = prev;
          return rest;
        });
      } finally {
        if (isMountedRef.current) setUploadingGroupId(null);
      }
    },
    [orgId, uploadingGroupId]
  );

  // Initial fetch and realtime subscriptions
  useEffect(() => {
    isMountedRef.current = true;

    fetchGroups();
    fetchDiscussions();

    const groupsChannel = createPostgresChangesChannel(`chat_groups:${orgId}`)
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

    const discussionsChannel = createPostgresChangesChannel(`${MOBILE_DISCUSSION_THREADS_TABLE}:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: MOBILE_DISCUSSION_THREADS_TABLE,
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchDiscussions();
        }
      )
      .subscribe();

    return () => {
      isMountedRef.current = false;
      supabase.removeChannel(groupsChannel);
      supabase.removeChannel(discussionsChannel);
    };
  }, [orgId, fetchGroups, fetchDiscussions]);

  const handleRefreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchGroups(), fetchDiscussions()]);
    if (isMountedRef.current) setRefreshing(false);
  }, [fetchGroups, fetchDiscussions]);

  // Render chat group row
  const renderGroup = useCallback(
    ({ item }: { item: ChatGroupWithMembers }) => {
      const memberCount = item.chat_group_members?.length ?? 0;
      const pendingCount = pendingCounts[item.id] ?? 0;
      const effectiveAvatarUrl = localAvatarUrls[item.id] ?? item.avatar_url ?? null;
      const isUploading = uploadingGroupId === item.id;

      return (
        <View style={styles.groupRow}>
          <Pressable
            style={({ pressed }) => [
              styles.groupRowButton,
              pressed && styles.groupRowPressed,
            ]}
            onPress={() => router.push(`/(app)/${orgSlug}/chat/${item.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.name}`}
          >
            <View style={styles.groupAvatarContainer}>
              <Avatar
                uri={effectiveAvatarUrl}
                name={item.name}
                size="md"
              />
              {isAdmin && isUploading ? (
                <View style={styles.avatarUploading}>
                  <ActivityIndicator size="small" color="#ffffff" />
                </View>
              ) : null}
            </View>

            <View style={styles.groupInfo}>
              <View style={styles.groupNameRow}>
                <Text style={styles.groupName} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.is_default && (
                  <View style={styles.defaultBadge}>
                    <Text style={styles.defaultBadgeText}>Default</Text>
                  </View>
                )}
              </View>
              <Text style={styles.groupMeta} numberOfLines={1}>
                {memberCount} {memberCount === 1 ? "member" : "members"}
                {item.require_approval ? " · Approval required" : ""}
                {item.description ? ` · ${item.description}` : ""}
              </Text>
            </View>

            {isAdmin && pendingCount > 0 && (
              <View style={styles.pendingBadge}>
                <Text style={styles.pendingBadgeText}>{pendingCount}</Text>
              </View>
            )}
          </Pressable>

          {isAdmin && !isUploading ? (
            <Pressable
              style={styles.cameraBadgeFloating}
              onPress={() => handleUploadGroupAvatar(item.id)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Upload photo for ${item.name}`}
            >
              <Camera size={10} color="#ffffff" />
            </Pressable>
          ) : null}
        </View>
      );
    },
    [isAdmin, pendingCounts, localAvatarUrls, uploadingGroupId, styles, router, orgSlug, handleUploadGroupAvatar]
  );

  // Render discussion row
  const renderDiscussion = useCallback(
    ({ item }: { item: DiscussionThreadWithAuthor }) => {
      return (
        <Pressable
          style={({ pressed }) => [
            styles.discussionRow,
            pressed && styles.groupRowPressed,
          ]}
          onPress={() =>
            router.push(buildMobileDiscussionThreadRoute(orgSlug, item.id))
          }
          accessibilityRole="button"
          accessibilityLabel={`Open discussion: ${item.title}`}
        >
          <View style={styles.discussionContent}>
            <View style={styles.discussionTitleRow}>
              {item.is_pinned && (
                <Pin size={12} color={semantic.warning} style={styles.pinIcon} />
              )}
              <Text style={styles.discussionTitle} numberOfLines={2}>
                {item.title}
              </Text>
            </View>
            <View style={styles.discussionMeta}>
              <Text style={styles.discussionMetaText} numberOfLines={1}>
                {item.author?.name ?? "Unknown"} · {item.reply_count}{" "}
                {item.reply_count === 1 ? "reply" : "replies"} ·{" "}
                {formatRelativeTime(item.last_activity_at)}
              </Text>
              {item.is_locked && (
                <Lock size={12} color={neutral.muted} />
              )}
            </View>
          </View>
        </Pressable>
      );
    },
    [styles, router, orgSlug, neutral.muted, semantic.warning]
  );

  // Discussions header with "New" button
  const discussionsHeader = useMemo(
    () => (
      <View style={styles.discussionsHeader}>
        <Text style={styles.discussionsHeaderText}>
          {discussions.length} {discussions.length === 1 ? "discussion" : "discussions"}
        </Text>
        <Pressable
          style={styles.newDiscussionButton}
          onPress={() => router.push(buildMobileNewDiscussionThreadRoute(orgSlug))}
          accessibilityRole="button"
          accessibilityLabel="Start new discussion"
        >
          <Text style={styles.newDiscussionButtonText}>New</Text>
        </Pressable>
      </View>
    ),
    [discussions.length, router, orgSlug, styles]
  );

  const headerMeta = useMemo(() => {
    if (activeTab === "chat") {
      return `${groups.length} group${groups.length === 1 ? "" : "s"}`;
    } else {
      return `${discussions.length} discussion${discussions.length === 1 ? "" : "s"}`;
    }
  }, [activeTab, groups.length, discussions.length]);

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]}>
          <View style={styles.headerContent}>
            <Pressable
              style={styles.orgLogoButton}
              onPress={handleDrawerToggle}
              accessibilityRole="button"
              accessibilityLabel={`Open navigation for ${orgName ?? "organization"}`}
            >
              {orgLogoUrl ? (
                <Image
                  source={orgLogoUrl}
                  style={styles.orgLogo}
                  contentFit="contain"
                  transition={200}
                />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "?"}</Text>
                </View>
              )}
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Chat</Text>
              <Text style={styles.headerMeta}>{headerMeta}</Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content */}
      <View style={styles.contentSheet}>
        {/* Segmented control */}
        <View style={styles.segmentedControl}>
          <Animated.View
            style={[styles.segmentPill, pillAnimatedStyle]}
          />
          {(["chat", "discussions"] as ActiveTab[]).map((tab) => (
            <Pressable
              key={tab}
              style={styles.segment}
              onPress={() => handleTabChange(tab)}
              onLayout={(e: LayoutChangeEvent) =>
                handleTabLayout(tab, e.nativeEvent.layout.x)
              }
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === tab }}
            >
              <Text
                style={[
                  styles.segmentText,
                  activeTab === tab && styles.segmentTextActive,
                ]}
              >
                {tab === "chat" ? "Chat" : "Discussions"}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Tab content container */}
        <View style={styles.tabContentContainer}>
          {/* Chat tab */}
          <Animated.View
            style={[styles.tabPane, chatAnimatedStyle]}
            pointerEvents={activeTab === "chat" ? "auto" : "none"}
          >
            {loadingGroups && groups.length === 0 ? (
              <View style={styles.skeletonContainer}>
                <SkeletonList type="chat" count={6} />
              </View>
            ) : (
              <FlatList
                data={groups}
                keyExtractor={(item) => item.id}
                renderItem={renderGroup}
                contentContainerStyle={styles.listContent}
                ItemSeparatorComponent={() => (
                  <View style={styles.separator} />
                )}
                refreshControl={
                  <RefreshControl
                    refreshing={refreshing}
                    onRefresh={handleRefreshAll}
                    tintColor={semantic.success}
                  />
                }
                ListEmptyComponent={
                  !loadingGroups && groups.length === 0 ? (
                    <View style={styles.emptyContainer}>
                      <MessageCircle size={32} color={neutral.muted} />
                      <Text style={styles.emptyText}>
                        No chat groups yet
                      </Text>
                    </View>
                  ) : null
                }
                scrollEnabled={!refreshing}
              />
            )}
          </Animated.View>

          {/* Discussions tab */}
          <Animated.View
            style={[styles.tabPane, discussionsAnimatedStyle]}
            pointerEvents={activeTab === "discussions" ? "auto" : "none"}
          >
            {loadingDiscussions && discussions.length === 0 ? (
              <View style={styles.skeletonContainer}>
                <SkeletonList type="announcement" count={5} />
              </View>
            ) : (
              <FlatList
                data={discussions}
                keyExtractor={(item) => item.id}
                renderItem={renderDiscussion}
                ListHeaderComponent={discussionsHeader}
                contentContainerStyle={styles.listContent}
                ItemSeparatorComponent={() => (
                  <View style={styles.separator} />
                )}
                refreshControl={
                  <RefreshControl
                    refreshing={refreshing}
                    onRefresh={handleRefreshAll}
                    tintColor={semantic.success}
                  />
                }
                ListEmptyComponent={
                  !loadingDiscussions && discussions.length === 0 ? (
                    <View style={styles.emptyContainer}>
                      <MessageCircle size={32} color={neutral.muted} />
                      <Text style={styles.emptyText}>
                        No discussions yet
                      </Text>
                    </View>
                  ) : null
                }
                scrollEnabled={!refreshing}
              />
            )}
          </Animated.View>
        </View>
      </View>
    </View>
  );
}
