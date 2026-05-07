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
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, ArrowUp, Lock } from "lucide-react-native";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { useAuth } from "@/hooks/useAuth";
import { Avatar } from "@/components/ui/Avatar";
import { spacing, borderRadius, fontSize, fontWeight } from "@/lib/theme";
import { APP_CHROME } from "@/lib/chrome";
import { formatTimestamp } from "@/lib/date-format";
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
  bubble: "#f1f5f9",
  lockedBg: "#f8fafc",
};

type DiscussionThread = Tables<"discussion_threads">;
type DiscussionReply = Tables<"discussion_replies">;

type ThreadWithAuthor = DiscussionThread & {
  author?: { id: string; name: string | null; avatar_url: string | null } | null;
};

type ReplyWithAuthor = DiscussionReply & {
  author?: { id: string; name: string | null; avatar_url: string | null } | null;
  isFirstInRun?: boolean;
};

export default function ThreadDetailScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const resolvedThreadId = Array.isArray(threadId) ? threadId[0] : threadId;
  const { orgId, orgSlug } = useOrg();
  const { user } = useAuth();
  const router = useRouter();
  const styles = useMemo(() => createStyles(), []);
  const listRef = useRef<FlatList<ReplyWithAuthor>>(null);
  const isMountedRef = useRef(true);

  const [thread, setThread] = useState<ThreadWithAuthor | null>(null);
  const [replies, setReplies] = useState<ReplyWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);

  const currentUserId = user?.id ?? null;

  const scrollToBottom = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, []);

  const loadThreadDetails = useCallback(async () => {
    if (!orgId || !resolvedThreadId || !currentUserId) return;

    setLoading(true);
    try {
      const [threadRes, repliesRes] = await Promise.all([
        supabase
          .from("discussion_threads")
          .select("*, author:users!discussion_threads_author_id_fkey(id, name, avatar_url)")
          .eq("id", resolvedThreadId)
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .single(),
        supabase
          .from("discussion_replies")
          .select("*, author:users!discussion_replies_author_id_fkey(id, name, avatar_url)")
          .eq("thread_id", resolvedThreadId)
          .is("deleted_at", null)
          .order("created_at", { ascending: true }),
      ]);

      if (threadRes.error) throw threadRes.error;
      if (repliesRes.error) throw repliesRes.error;

      if (isMountedRef.current) {
        setThread(threadRes.data as ThreadWithAuthor);
        setReplies((repliesRes.data || []) as ReplyWithAuthor[]);
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
  }, [orgId, resolvedThreadId, currentUserId]);

  useEffect(() => {
    isMountedRef.current = true;
    loadThreadDetails();
    return () => {
      isMountedRef.current = false;
    };
  }, [loadThreadDetails]);

  // Realtime subscription for thread state and new replies
  useEffect(() => {
    if (!resolvedThreadId) return;

    const threadChannel = createPostgresChangesChannel(`discussion_thread:${resolvedThreadId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "discussion_threads",
          filter: `id=eq.${resolvedThreadId}`,
        },
        (payload: RealtimePostgresChangesPayload<DiscussionThread>) => {
          if (!isMountedRef.current) return;

          if (payload.eventType === "DELETE") {
            setThread(null);
            setError("Thread not found.");
            return;
          }

          const updatedThread = payload.new as DiscussionThread;
          if (updatedThread.deleted_at) {
            setThread(null);
            setError("Thread not found.");
            return;
          }

          setThread((prev) =>
            prev
              ? {
                  ...prev,
                  ...updatedThread,
                }
              : (updatedThread as ThreadWithAuthor)
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(threadChannel);
    };
  }, [resolvedThreadId]);

  useEffect(() => {
    if (!resolvedThreadId) return;

    const channel = createPostgresChangesChannel(`discussion_replies:${resolvedThreadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "discussion_replies",
          filter: `thread_id=eq.${resolvedThreadId}`,
        },
        async (payload: RealtimePostgresChangesPayload<DiscussionReply>) => {
          const newReply = payload.new as DiscussionReply;
          const { data: replyWithAuthor } = await supabase
            .from("discussion_replies")
            .select("*, author:users!discussion_replies_author_id_fkey(id, name, avatar_url)")
            .eq("id", newReply.id)
            .single();

          if (replyWithAuthor && isMountedRef.current) {
            setReplies((prev) => {
              if (prev.some((reply) => reply.id === newReply.id)) {
                return prev;
              }

              const hasTempVersion = prev.some(
                (reply) =>
                  reply.id.startsWith("temp-") &&
                  reply.author_id === newReply.author_id &&
                  reply.body === newReply.body
              );

              if (hasTempVersion) {
                return prev.map((reply) =>
                  reply.id.startsWith("temp-") &&
                  reply.author_id === newReply.author_id &&
                  reply.body === newReply.body
                    ? (replyWithAuthor as ReplyWithAuthor)
                    : reply
                );
              }

              return [...prev, replyWithAuthor as ReplyWithAuthor];
            });
            setTimeout(scrollToBottom, 80);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [resolvedThreadId, scrollToBottom]);

  const groupedReplies = useMemo(() => {
    return replies.map((reply, index) => {
      const prev = replies[index - 1];
      const sameAuthor = prev?.author_id === reply.author_id;
      const within5Min = prev
        ? new Date(reply.created_at).getTime() - new Date(prev.created_at).getTime() <
          5 * 60 * 1000
        : false;
      return {
        ...reply,
        isFirstInRun: !sameAuthor || !within5Min,
      };
    });
  }, [replies]);

  const handleSendReply = useCallback(async () => {
    if (!replyBody.trim() || sending || !thread || thread.is_locked || !orgId || !currentUserId) {
      return;
    }

    setSending(true);
    const body = replyBody.trim();
    setReplyBody("");

    const tempId = `temp-${Date.now()}`;
    const optimisticReply: ReplyWithAuthor = {
      id: tempId,
      thread_id: thread.id,
      organization_id: orgId,
      author_id: currentUserId,
      body,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      like_count: 0,
      deleted_at: null,
      author: user
        ? { id: user.id, name: user.email || "Unknown", avatar_url: null }
        : undefined,
    };

    setReplies((prev) => [...prev, optimisticReply]);
    setTimeout(scrollToBottom, 60);

    const { data, error } = await supabase
      .from("discussion_replies")
      .insert({
        thread_id: thread.id,
        organization_id: orgId,
        author_id: currentUserId,
        body,
      })
      .select("*, author:users!discussion_replies_author_id_fkey(id, name, avatar_url)")
      .single();

    if (error) {
      setReplies((prev) => prev.filter((r) => r.id !== tempId));
      setReplyBody(body);
      await loadThreadDetails();
    } else if (data) {
      setReplies((prev) =>
        prev.map((r) => (r.id === tempId ? (data as ReplyWithAuthor) : r))
      );
    }

    setSending(false);
  }, [
    replyBody,
    sending,
    thread,
    orgId,
    currentUserId,
    user,
    scrollToBottom,
    loadThreadDetails,
  ]);

  const renderReply = useCallback(
    ({ item }: { item: ReplyWithAuthor }) => {
      const isOwn = item.author_id === currentUserId;
      const authorName = item.author?.name || "Unknown";
      const isFirstInRun = item.isFirstInRun ?? false;

      const bubbleRadius = isFirstInRun
        ? isOwn
          ? { borderTopLeftRadius: 14, borderTopRightRadius: 4, borderBottomLeftRadius: 14, borderBottomRightRadius: 14 }
          : { borderTopLeftRadius: 4, borderTopRightRadius: 14, borderBottomLeftRadius: 14, borderBottomRightRadius: 14 }
        : { borderTopLeftRadius: 14, borderTopRightRadius: 14, borderBottomLeftRadius: 14, borderBottomRightRadius: 14 };

      return (
        <View style={[styles.messageRow, isOwn && styles.messageRowOwn]}>
          {!isOwn && (
            <View style={styles.messageColumn}>
              {isFirstInRun ? (
                <Avatar size="xs" name={authorName} />
              ) : (
                <View style={styles.avatarSpacer} />
              )}
            </View>
          )}

          <View style={[styles.messageBody, isOwn && styles.messageBodyOwn]}>
            {isFirstInRun && !isOwn && (
              <View style={styles.messageMetaRow}>
                <Text style={styles.messageAuthor} numberOfLines={1}>
                  {authorName}
                </Text>
                <Text style={styles.messageTime}>{formatTimestamp(item.created_at)}</Text>
              </View>
            )}
            {isFirstInRun && isOwn && (
              <Text style={styles.messageTime}>{formatTimestamp(item.created_at)}</Text>
            )}

            <View
              style={[
                styles.messageBubble,
                bubbleRadius,
                isOwn ? styles.messageBubbleOwn : styles.messageBubbleOther,
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
          </View>
        </View>
      );
    },
    [currentUserId, styles]
  );

  const renderOpCard = useCallback(() => {
    if (!thread) return null;

    const authorName = thread.author?.name || "Unknown";

    return (
      <View style={styles.opCard}>
        <View style={styles.opMeta}>
          <Avatar size="sm" name={authorName} />
          <Text style={styles.opAuthor}>{authorName}</Text>
          <Text style={styles.opMetaSeparator}>·</Text>
          <Text style={styles.opTime}>{formatRelativeTime(thread.created_at)}</Text>
        </View>
        <Text style={styles.opTitle}>{thread.title}</Text>
        <Text style={styles.opBody}>{thread.body}</Text>
      </View>
    );
  }, [thread, styles]);

  if (loading && !thread) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={CHAT_COLORS.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !thread) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Unable to load thread</Text>
          <Text style={styles.errorText}>{error || "Thread not found."}</Text>
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
    <View style={styles.container}>
      {/* Custom gradient header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable onPress={() => router.back()} style={styles.backButtonHeader}>
              <ArrowLeft size={20} color={APP_CHROME.headerTitle} />
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {thread.title}
              </Text>
              <Text style={styles.headerMeta}>
                {replies.length} {replies.length === 1 ? "reply" : "replies"}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
      >
        <FlatList
          ref={listRef}
          data={groupedReplies}
          keyExtractor={(item) => item.id}
          renderItem={renderReply}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={renderOpCard}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No replies yet. Start the discussion!</Text>
            </View>
          }
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
        />

        {!thread.is_locked ? (
          <SafeAreaView edges={["bottom"]} style={styles.composerContainer}>
            <View style={styles.composer}>
              <TextInput
                value={replyBody}
                onChangeText={setReplyBody}
                placeholder="Reply to this thread..."
                style={styles.input}
                editable={!sending}
                returnKeyType="send"
                onSubmitEditing={handleSendReply}
                multiline
              />
              <Pressable
                onPress={handleSendReply}
                disabled={!replyBody.trim() || sending}
                style={({ pressed }) => [
                  styles.sendButton,
                  (!replyBody.trim() || sending) && styles.sendButtonDisabled,
                  pressed && styles.sendButtonPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Send reply"
              >
                <ArrowUp
                  size={20}
                  color={!replyBody.trim() || sending ? CHAT_COLORS.muted : "#ffffff"}
                />
              </Pressable>
            </View>
          </SafeAreaView>
        ) : (
          <View style={styles.lockedBanner}>
            <Lock size={16} color={CHAT_COLORS.muted} />
            <Text style={styles.lockedText}>This thread is locked</Text>
          </View>
        )}
      </KeyboardAvoidingView>
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

const createStyles = () =>
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
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    backButtonHeader: {
      padding: spacing.xs,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: APP_CHROME.headerTitle,
    },
    headerMeta: {
      fontSize: fontSize.xs,
      color: APP_CHROME.headerMeta,
      marginTop: 2,
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
    listContent: {
      paddingHorizontal: spacing.md,
      gap: spacing.sm,
    },
    opCard: {
      backgroundColor: CHAT_COLORS.lockedBg,
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: CHAT_COLORS.border,
      padding: spacing.md,
      marginBottom: spacing.md,
      gap: spacing.sm,
    },
    opMeta: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    opAuthor: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: CHAT_COLORS.title,
    },
    opMetaSeparator: {
      color: CHAT_COLORS.muted,
    },
    opTime: {
      fontSize: fontSize.xs,
      color: CHAT_COLORS.muted,
    },
    opTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: CHAT_COLORS.title,
      lineHeight: 22,
    },
    opBody: {
      fontSize: fontSize.sm,
      color: CHAT_COLORS.subtitle,
      lineHeight: 22,
    },
    messageRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
    },
    messageRowOwn: {
      flexDirection: "row-reverse",
    },
    messageColumn: {
      width: 32,
      alignItems: "center",
    },
    avatarSpacer: {
      width: 32,
      height: 32,
    },
    messageBody: {
      flex: 1,
      gap: 4,
    },
    messageBodyOwn: {
      alignItems: "flex-end",
    },
    messageMetaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingHorizontal: spacing.xs,
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
    messageBubble: {
      paddingVertical: 10,
      paddingHorizontal: spacing.sm,
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
    messageText: {
      fontSize: fontSize.sm,
      color: CHAT_COLORS.title,
      lineHeight: 20,
    },
    messageTextOwn: {
      color: "#ffffff",
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
    composerContainer: {
      backgroundColor: CHAT_COLORS.card,
      borderTopWidth: 1,
      borderTopColor: CHAT_COLORS.border,
    },
    composer: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    input: {
      flex: 1,
      backgroundColor: CHAT_COLORS.bubble,
      borderRadius: 999,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      fontSize: fontSize.sm,
      color: CHAT_COLORS.title,
      maxHeight: 120,
    },
    sendButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: CHAT_COLORS.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    sendButtonPressed: {
      opacity: 0.8,
    },
    sendButtonDisabled: {
      opacity: 0.5,
    },
    lockedBanner: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      backgroundColor: CHAT_COLORS.lockedBg,
      borderTopWidth: 1,
      borderTopColor: CHAT_COLORS.border,
    },
    lockedText: {
      fontSize: fontSize.sm,
      color: CHAT_COLORS.muted,
      fontWeight: fontWeight.medium,
    },
  });
