import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { useAuth } from "@/hooks/useAuth";
import { useOrgRole } from "@/hooks/useOrgRole";
import { spacing, borderRadius, fontSize, fontWeight } from "@/lib/theme";
import type {
  ChatGroup,
  ChatGroupMember,
  ChatMessage,
  ChatMessageStatus,
  User,
} from "@teammeet/types";

const CHAT_COLORS = {
  background: "#ffffff",
  card: "#ffffff",
  border: "#e2e8f0",
  title: "#0f172a",
  subtitle: "#64748b",
  muted: "#94a3b8",
  accent: "#059669",
  pending: "#f59e0b",
  rejected: "#dc2626",
  bubble: "#f1f5f9",
};

type ChatMemberWithUser = ChatGroupMember & { users: User };
type MessageWithAuthor = ChatMessage & { author?: User };

export default function ChatRoomScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const resolvedGroupId = Array.isArray(groupId) ? groupId[0] : groupId;
  const { orgId } = useOrg();
  const { user } = useAuth();
  const { isAdmin } = useOrgRole();
  const router = useRouter();
  const styles = useMemo(() => createStyles(), []);
  const listRef = useRef<FlatList<MessageWithAuthor>>(null);
  const isMountedRef = useRef(true);

  const [group, setGroup] = useState<ChatGroup | null>(null);
  const [members, setMembers] = useState<ChatMemberWithUser[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [messages, setMessages] = useState<MessageWithAuthor[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPendingQueue, setShowPendingQueue] = useState(false);
  const [canModerate, setCanModerate] = useState(false);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [userCache, setUserCache] = useState<Map<string, User>>(new Map());

  const currentUserId = user?.id ?? null;

  const userMap = useMemo(() => {
    const map = new Map<string, User>();
    members.forEach((member) => {
      if (member.users) {
        map.set(member.user_id, member.users);
      }
    });
    if (currentUser) {
      map.set(currentUser.id, currentUser);
    }
    userCache.forEach((cachedUser, id) => {
      if (!map.has(id)) {
        map.set(id, cachedUser);
      }
    });
    return map;
  }, [members, currentUser, userCache]);

  const fetchUnknownUsers = useCallback(
    async (authorIds: string[]) => {
      const unknownIds = authorIds.filter((id) => !userMap.has(id));
      if (unknownIds.length === 0) return;

      const { data } = await supabase
        .from("users")
        .select("id, name, email, avatar_url")
        .in("id", unknownIds);

      if (data && data.length > 0) {
        setUserCache((prev) => {
          const nextCache = new Map(prev);
          data.forEach((author) => {
            nextCache.set(author.id, author as User);
          });
          return nextCache;
        });
      }
    },
    [userMap]
  );

  useEffect(() => {
    setMessages((prev) =>
      prev.map((msg) => ({
        ...msg,
        author: userMap.get(msg.author_id) || msg.author,
      }))
    );
  }, [userMap]);

  const scrollToBottom = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, []);

  const loadGroupDetails = useCallback(async () => {
    if (!orgId || !resolvedGroupId || !currentUserId) return;

    setLoading(true);
    try {
      const { data: groupData, error: groupError } = await supabase
        .from("chat_groups")
        .select("*")
        .eq("id", resolvedGroupId)
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .single();

      if (groupError || !groupData) throw groupError || new Error("Chat group not found");

      const { data: membership } = await supabase
        .from("chat_group_members")
        .select("*")
        .eq("chat_group_id", resolvedGroupId)
        .eq("user_id", currentUserId)
        .single();

      const isModerator =
        membership?.role === "admin" || membership?.role === "moderator";
      const canModerateNext = isAdmin || isModerator;

      if (!membership && !isAdmin) {
        throw new Error("You are not a member of this chat group.");
      }

      const { data: membersData } = await supabase
        .from("chat_group_members")
        .select("*, users:user_id (id, name, email, avatar_url)")
        .eq("chat_group_id", resolvedGroupId);

      const { data: currentUserData } = await supabase
        .from("users")
        .select("id, name, email, avatar_url")
        .eq("id", currentUserId)
        .single();

      if (isMountedRef.current) {
        setGroup(groupData as ChatGroup);
        setMembers((membersData || []) as ChatMemberWithUser[]);
        setCurrentUser(currentUserData as User);
        setCanModerate(canModerateNext);
        setRequiresApproval(groupData.require_approval);
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
  }, [orgId, resolvedGroupId, currentUserId, isAdmin]);

  const loadMessages = useCallback(async () => {
    if (!resolvedGroupId) return;
    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("chat_group_id", resolvedGroupId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(100);

    if (error) {
      setError(error.message);
      return;
    }

    if (data) {
      const authorIds = [...new Set(data.map((msg) => msg.author_id))];
      await fetchUnknownUsers(authorIds);
      setMessages(
        data.map((msg) => ({
          ...msg,
          author: userMap.get(msg.author_id),
        }))
      );
      setTimeout(scrollToBottom, 100);
    }
  }, [resolvedGroupId, fetchUnknownUsers, scrollToBottom, userMap]);

  useEffect(() => {
    isMountedRef.current = true;
    loadGroupDetails();
    return () => {
      isMountedRef.current = false;
    };
  }, [loadGroupDetails]);

  useEffect(() => {
    if (!group) return;
    loadMessages();
  }, [group, loadMessages]);

  useEffect(() => {
    if (!resolvedGroupId || !currentUserId) return;

    const channel = supabase
      .channel(`chat_messages:${resolvedGroupId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_messages",
          filter: `chat_group_id=eq.${resolvedGroupId}`,
        },
        async (payload: RealtimePostgresChangesPayload<ChatMessage>) => {
          if (payload.eventType === "INSERT") {
            const newMsg = payload.new as ChatMessage;
            if (!userMap.has(newMsg.author_id)) {
              await fetchUnknownUsers([newMsg.author_id]);
            }

            if (
              newMsg.status === "approved" ||
              newMsg.author_id === currentUserId ||
              canModerate
            ) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === newMsg.id)) return prev;
                const hasTempVersion = prev.some(
                  (m) =>
                    m.id.startsWith("temp-") &&
                    m.author_id === newMsg.author_id &&
                    m.body === newMsg.body
                );
                if (hasTempVersion) {
                  return prev.map((m) =>
                    m.id.startsWith("temp-") &&
                    m.author_id === newMsg.author_id &&
                    m.body === newMsg.body
                      ? { ...newMsg, author: userMap.get(newMsg.author_id) }
                      : m
                  );
                }
                return [...prev, { ...newMsg, author: userMap.get(newMsg.author_id) }];
              });
              setTimeout(scrollToBottom, 80);
            }
          } else if (payload.eventType === "UPDATE") {
            const updated = payload.new as ChatMessage;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === updated.id
                  ? { ...updated, author: userMap.get(updated.author_id) }
                  : m
              )
            );
          } else if (payload.eventType === "DELETE") {
            const deleted = payload.old as { id: string };
            setMessages((prev) => prev.filter((m) => m.id !== deleted.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [resolvedGroupId, currentUserId, canModerate, fetchUnknownUsers, userMap, scrollToBottom]);

  const handleSend = useCallback(async () => {
    if (!newMessage.trim() || sending || !group || !orgId || !currentUserId) return;

    setSending(true);
    const messageBody = newMessage.trim();
    setNewMessage("");

    const initialStatus: ChatMessageStatus =
      requiresApproval && !canModerate ? "pending" : "approved";
    const tempId = `temp-${Date.now()}`;
    const optimisticMessage: MessageWithAuthor = {
      id: tempId,
      chat_group_id: group.id,
      organization_id: orgId,
      author_id: currentUserId,
      body: messageBody,
      status: initialStatus,
      approved_by: null,
      approved_at: null,
      rejected_by: null,
      rejected_at: null,
      edited_at: null,
      created_at: new Date().toISOString(),
      deleted_at: null,
      author: currentUser ?? undefined,
    };

    setMessages((prev) => [...prev, optimisticMessage]);
    setTimeout(scrollToBottom, 60);

    const { data, error } = await supabase
      .from("chat_messages")
      .insert({
        chat_group_id: group.id,
        organization_id: orgId,
        author_id: currentUserId,
        body: messageBody,
        status: initialStatus,
      })
      .select()
      .single();

    if (error) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setNewMessage(messageBody);
    } else if (data) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId ? { ...data, author: currentUser ?? undefined } : m
        )
      );
    }

    setSending(false);
  }, [
    newMessage,
    sending,
    group,
    orgId,
    currentUserId,
    requiresApproval,
    canModerate,
    currentUser,
    scrollToBottom,
  ]);

  const handleModeration = useCallback(
    async (messageId: string, action: "approved" | "rejected") => {
      if (!currentUserId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                status: action,
                ...(action === "approved"
                  ? { approved_by: currentUserId, approved_at: new Date().toISOString() }
                  : { rejected_by: currentUserId, rejected_at: new Date().toISOString() }),
              }
            : m
        )
      );

      const updateData: Partial<ChatMessage> = {
        status: action,
        ...(action === "approved"
          ? { approved_by: currentUserId, approved_at: new Date().toISOString() }
          : { rejected_by: currentUserId, rejected_at: new Date().toISOString() }),
      };

      const { error } = await supabase
        .from("chat_messages")
        .update(updateData)
        .eq("id", messageId);

      if (error) {
        await loadMessages();
      }
    },
    [currentUserId, loadMessages]
  );

  const pendingCount = useMemo(
    () => messages.filter((m) => m.status === "pending").length,
    [messages]
  );

  const visibleMessages = useMemo(() => {
    if (!currentUserId) return [];
    if (showPendingQueue) {
      return messages.filter((m) => m.status === "pending");
    }
    return messages.filter(
      (m) =>
        m.status === "approved" ||
        m.author_id === currentUserId ||
        canModerate
    );
  }, [messages, showPendingQueue, currentUserId, canModerate]);

  useEffect(() => {
    if (!showPendingQueue) {
      setTimeout(scrollToBottom, 80);
    }
  }, [visibleMessages.length, showPendingQueue, scrollToBottom]);

  const listContentStyle = useMemo(
    () => [
      styles.listContent,
      { paddingBottom: showPendingQueue ? spacing.lg : 88 },
    ],
    [styles.listContent, showPendingQueue]
  );

  const renderMessage = useCallback(
    ({ item }: { item: MessageWithAuthor }) => {
      const isOwn = item.author_id === currentUserId;
      const isPending = item.status === "pending";
      const isRejected = item.status === "rejected";
      const authorName = item.author?.name || item.author?.email || "Unknown";
      const initials = getInitials(authorName);
      return (
        <View style={[styles.messageRow, isOwn && styles.messageRowOwn]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.messageBody}>
            <View style={styles.messageMetaRow}>
              <Text style={styles.messageAuthor} numberOfLines={1}>
                {authorName}
              </Text>
              <Text style={styles.messageTime}>
                {formatTimestamp(item.created_at)}
              </Text>
              {isPending && <Text style={styles.pendingLabel}>Pending</Text>}
              {isRejected && <Text style={styles.rejectedLabel}>Rejected</Text>}
            </View>
            <View
              style={[
                styles.messageBubble,
                isOwn ? styles.messageBubbleOwn : styles.messageBubbleOther,
                isPending && styles.messageBubblePending,
              ]}
            >
              <Text
                style={[
                  styles.messageText,
                  isOwn && styles.messageTextOwn,
                ]}
              >
                {item.body}
              </Text>
            </View>
            {canModerate && isPending && !isOwn && (
              <View style={styles.moderationRow}>
                <Pressable
                  onPress={() => handleModeration(item.id, "approved")}
                  style={({ pressed }) => [
                    styles.moderationButton,
                    styles.moderationApprove,
                    pressed && styles.moderationPressed,
                  ]}
                >
                  <Text style={styles.moderationApproveText}>Approve</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleModeration(item.id, "rejected")}
                  style={({ pressed }) => [
                    styles.moderationButton,
                    styles.moderationReject,
                    pressed && styles.moderationPressed,
                  ]}
                >
                  <Text style={styles.moderationRejectText}>Reject</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      );
    },
    [currentUserId, canModerate, handleModeration, styles]
  );

  if (loading && !group) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <Stack.Screen options={{ title: "Chat" }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={CHAT_COLORS.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !group) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <Stack.Screen options={{ title: "Chat" }} />
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Unable to load chat</Text>
          <Text style={styles.errorText}>{error || "Chat group not found."}</Text>
          <Pressable
            style={styles.backButton}
            onPress={() => router.back()}
            accessibilityRole="button"
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <Stack.Screen options={{ title: group.name }} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
      >
        <FlatList
          ref={listRef}
          data={visibleMessages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={listContentStyle}
          ListHeaderComponent={
            <View style={styles.groupMeta}>
              <Text style={styles.groupDescription}>
                {group.description || `${members.length} member${members.length !== 1 ? "s" : ""}`}
              </Text>
              {canModerate && pendingCount > 0 ? (
                <Pressable
                  onPress={() => setShowPendingQueue((prev) => !prev)}
                  style={({ pressed }) => [
                    styles.pendingToggle,
                    pressed && styles.pendingTogglePressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Toggle pending queue"
                >
                  <Text style={styles.pendingToggleText}>
                    {showPendingQueue ? "Show all" : `Pending (${pendingCount})`}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                {showPendingQueue ? "No pending messages" : "No messages yet. Start the conversation!"}
              </Text>
            </View>
          }
        />

        {!showPendingQueue && (
          <View style={styles.composer}>
            <TextInput
              value={newMessage}
              onChangeText={setNewMessage}
              placeholder={
                requiresApproval && !canModerate
                  ? "Type a message (requires approval)..."
                  : "Type a message..."
              }
              style={styles.input}
              editable={!sending}
              returnKeyType="send"
              onSubmitEditing={handleSend}
            />
            <Pressable
              onPress={handleSend}
              disabled={!newMessage.trim() || sending}
              style={({ pressed }) => [
                styles.sendButton,
                (!newMessage.trim() || sending) && styles.sendButtonDisabled,
                pressed && styles.sendButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Send message"
            >
              <Text style={styles.sendButtonText}>
                {sending ? "..." : "Send"}
              </Text>
            </Pressable>
          </View>
        )}
        {requiresApproval && !canModerate && !showPendingQueue && (
          <Text style={styles.approvalNote}>
            Messages in this group require moderator approval before being visible.
          </Text>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function getInitials(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: CHAT_COLORS.background,
    },
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: spacing.lg,
      gap: spacing.sm,
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
    backButton: {
      backgroundColor: CHAT_COLORS.accent,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.md,
    },
    backButtonText: {
      color: "#ffffff",
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
    },
    groupMeta: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    groupDescription: {
      fontSize: fontSize.sm,
      color: CHAT_COLORS.subtitle,
    },
    pendingToggle: {
      alignSelf: "flex-start",
      backgroundColor: "rgba(245, 158, 11, 0.15)",
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      borderRadius: borderRadius.sm,
    },
    pendingTogglePressed: {
      opacity: 0.7,
    },
    pendingToggleText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: CHAT_COLORS.pending,
    },
    listContent: {
      paddingHorizontal: spacing.md,
      gap: spacing.sm,
    },
    messageRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
    },
    messageRowOwn: {
      flexDirection: "row-reverse",
    },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: CHAT_COLORS.bubble,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
      color: CHAT_COLORS.subtitle,
    },
    messageBody: {
      flex: 1,
      gap: 4,
    },
    messageMetaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      flexWrap: "wrap",
    },
    messageAuthor: {
      fontSize: fontSize.xs,
      color: CHAT_COLORS.muted,
      maxWidth: 120,
    },
    messageTime: {
      fontSize: fontSize.xs,
      color: CHAT_COLORS.muted,
    },
    pendingLabel: {
      fontSize: fontSize.xs,
      color: CHAT_COLORS.pending,
      fontWeight: fontWeight.medium,
    },
    rejectedLabel: {
      fontSize: fontSize.xs,
      color: CHAT_COLORS.rejected,
      fontWeight: fontWeight.medium,
    },
    messageBubble: {
      paddingVertical: 10,
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.md,
      borderCurve: "continuous",
      maxWidth: "85%",
    },
    messageBubbleOwn: {
      backgroundColor: CHAT_COLORS.accent,
    },
    messageBubbleOther: {
      backgroundColor: CHAT_COLORS.bubble,
      borderWidth: 1,
      borderColor: CHAT_COLORS.border,
    },
    messageBubblePending: {
      borderWidth: 1,
      borderColor: CHAT_COLORS.pending,
    },
    messageText: {
      fontSize: fontSize.sm,
      color: CHAT_COLORS.title,
    },
    messageTextOwn: {
      color: "#ffffff",
    },
    moderationRow: {
      flexDirection: "row",
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    moderationButton: {
      paddingVertical: 6,
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.sm,
    },
    moderationPressed: {
      opacity: 0.7,
    },
    moderationApprove: {
      backgroundColor: CHAT_COLORS.accent,
    },
    moderationApproveText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: "#ffffff",
    },
    moderationReject: {
      backgroundColor: "rgba(220, 38, 38, 0.12)",
      borderWidth: 1,
      borderColor: "rgba(220, 38, 38, 0.3)",
    },
    moderationRejectText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: CHAT_COLORS.rejected,
    },
    emptyState: {
      alignItems: "center",
      paddingVertical: spacing.lg,
    },
    emptyText: {
      fontSize: fontSize.sm,
      color: CHAT_COLORS.subtitle,
      textAlign: "center",
    },
    composer: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: CHAT_COLORS.border,
      backgroundColor: CHAT_COLORS.card,
    },
    input: {
      flex: 1,
      backgroundColor: CHAT_COLORS.bubble,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      fontSize: fontSize.sm,
      color: CHAT_COLORS.title,
    },
    sendButton: {
      backgroundColor: CHAT_COLORS.accent,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.md,
    },
    sendButtonPressed: {
      opacity: 0.8,
    },
    sendButtonDisabled: {
      opacity: 0.5,
    },
    sendButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: "#ffffff",
    },
    approvalNote: {
      fontSize: fontSize.xs,
      color: CHAT_COLORS.muted,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
      backgroundColor: CHAT_COLORS.card,
    },
  });
