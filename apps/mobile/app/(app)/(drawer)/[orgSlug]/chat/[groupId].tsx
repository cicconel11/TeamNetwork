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
import { ArrowLeft, ArrowUp, X, Plus, ChevronLeft, Users } from "lucide-react-native";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { useAuth } from "@/hooks/useAuth";
import { useOrgRole } from "@/hooks/useOrgRole";
import { Avatar } from "@/components/ui/Avatar";
import { showToast } from "@/components/ui/Toast";
import { spacing, borderRadius, fontSize, fontWeight } from "@/lib/theme";
import { APP_CHROME } from "@/lib/chrome";
import { formatTimestamp } from "@/lib/date-format";
import {
  buildChatGroupMemberInsertPayload,
  buildChatGroupMemberReactivationPayload,
  canAccessMobileChatGroup,
  canManageMobileChatMembers,
  MOBILE_CHAT_MEMBER_DIRECTORY_ROLES,
} from "@/lib/chat-helpers";
import type {
  ChatGroup,
  ChatGroupMember,
  ChatMessage,
  ChatMessageStatus,
  User,
} from "@teammeet/types";

let BottomSheet: any = null;
let BottomSheetView: any = null;
let BottomSheetFlatList: any = null;
let BottomSheetBackdrop: any = null;
try {
  const bs = require("@gorhom/bottom-sheet");
  BottomSheet = bs.default;
  BottomSheetView = bs.BottomSheetView;
  BottomSheetFlatList = bs.BottomSheetFlatList;
  BottomSheetBackdrop = bs.BottomSheetBackdrop;
} catch {}

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
type MessageWithAuthor = ChatMessage & {
  author?: User;
  isFirstInRun?: boolean;
};
type OrgMemberRow = {
  user_id: string;
  role: string;
  user: { id: string; name: string | null; email: string | null; avatar_url: string | null } | null;
};

export default function ChatRoomScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const resolvedGroupId = Array.isArray(groupId) ? groupId[0] : groupId;
  const { orgId, orgSlug } = useOrg();
  const { user } = useAuth();
  const { isAdmin } = useOrgRole();
  const router = useRouter();
  const styles = useMemo(() => createStyles(), []);
  const listRef = useRef<FlatList<MessageWithAuthor>>(null);
  const isMountedRef = useRef(true);
  const membersSheetRef = useRef<any>(null);

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
  const [canManageMembers, setCanManageMembers] = useState(false);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [userCache, setUserCache] = useState<Map<string, User>>(new Map());

  // Members sheet state
  const [addMembersMode, setAddMembersMode] = useState(false);
  const [orgMembers, setOrgMembers] = useState<OrgMemberRow[]>([]);
  const [loadingOrgMembers, setLoadingOrgMembers] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [mutatingMemberId, setMutatingMemberId] = useState<string | null>(null);

  const currentUserId = user?.id ?? null;

  const sheetSnapPoints = useMemo(() => ["60%", "90%"], []);

  const userMap = useMemo(() => {
    const map = new Map<string, User>();
    members.forEach((member) => {
      if (member.users) map.set(member.user_id, member.users);
    });
    if (currentUser) map.set(currentUser.id, currentUser);
    userCache.forEach((cachedUser, id) => {
      if (!map.has(id)) map.set(id, cachedUser);
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
          const next = new Map(prev);
          data.forEach((u) => next.set(u.id, u as User));
          return next;
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

      const { data: membership, error: membershipError } = await supabase
        .from("chat_group_members")
        .select("*")
        .eq("chat_group_id", resolvedGroupId)
        .eq("user_id", currentUserId)
        .is("removed_at", null)
        .maybeSingle();

      if (membershipError) throw membershipError;

      const isModerator =
        membership?.role === "admin" || membership?.role === "moderator";
      const canModerateNext = isAdmin || isModerator;
      const canManageMembersNext = canManageMobileChatMembers({
        isOrgAdmin: isAdmin,
        isGroupModerator: isModerator,
        isGroupCreator: groupData.created_by === currentUserId,
      });

      if (
        !canAccessMobileChatGroup({
          hasActiveMembership: !!membership,
          isOrgAdmin: isAdmin,
        })
      ) {
        throw new Error("You are not a member of this chat group.");
      }

      const { data: membersData } = await supabase
        .from("chat_group_members")
        .select("*, users:user_id (id, name, email, avatar_url)")
        .eq("chat_group_id", resolvedGroupId)
        .is("removed_at", null);

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
        setCanManageMembers(canManageMembersNext);
        setRequiresApproval(groupData.require_approval);
        setError(null);
      }
    } catch (e) {
      if (isMountedRef.current) setError((e as Error).message);
    } finally {
      if (isMountedRef.current) setLoading(false);
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

    if (error) { setError(error.message); return; }

    if (data) {
      const authorIds = [...new Set(data.map((msg) => msg.author_id))];
      await fetchUnknownUsers(authorIds);
      setMessages(data.map((msg) => ({ ...msg, author: userMap.get(msg.author_id) })));
      setTimeout(scrollToBottom, 100);
    }
  }, [resolvedGroupId, fetchUnknownUsers, scrollToBottom, userMap]);

  useEffect(() => {
    isMountedRef.current = true;
    loadGroupDetails();
    return () => { isMountedRef.current = false; };
  }, [loadGroupDetails]);

  useEffect(() => {
    if (!group) return;
    loadMessages();
  }, [group, loadMessages]);

  useEffect(() => {
    if (!resolvedGroupId || !currentUserId) return;
    const channel = createPostgresChangesChannel(`chat_messages:${resolvedGroupId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_messages", filter: `chat_group_id=eq.${resolvedGroupId}` },
        async (payload: RealtimePostgresChangesPayload<ChatMessage>) => {
          if (payload.eventType === "INSERT") {
            const newMsg = payload.new as ChatMessage;
            if (!userMap.has(newMsg.author_id)) await fetchUnknownUsers([newMsg.author_id]);
            if (newMsg.status === "approved" || newMsg.author_id === currentUserId || canModerate) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === newMsg.id)) return prev;
                const hasTempVersion = prev.some(
                  (m) => m.id.startsWith("temp-") && m.author_id === newMsg.author_id && m.body === newMsg.body
                );
                if (hasTempVersion) {
                  return prev.map((m) =>
                    m.id.startsWith("temp-") && m.author_id === newMsg.author_id && m.body === newMsg.body
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
              prev.map((m) => m.id === updated.id ? { ...updated, author: userMap.get(updated.author_id) } : m)
            );
          } else if (payload.eventType === "DELETE") {
            const deleted = payload.old as { id: string };
            setMessages((prev) => prev.filter((m) => m.id !== deleted.id));
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [resolvedGroupId, currentUserId, canModerate, fetchUnknownUsers, userMap, scrollToBottom]);

  const pendingCount = useMemo(
    () => messages.filter((m) => m.status === "pending").length,
    [messages]
  );

  const visibleMessages = useMemo(() => {
    if (!currentUserId) return [];
    if (showPendingQueue) return messages.filter((m) => m.status === "pending");
    return messages.filter(
      (m) => m.status === "approved" || m.author_id === currentUserId || canModerate
    );
  }, [messages, showPendingQueue, currentUserId, canModerate]);

  const groupedMessages = useMemo(() => {
    return visibleMessages.map((msg, index) => {
      const prev = visibleMessages[index - 1];
      const sameAuthor = prev?.author_id === msg.author_id;
      const within5Min = prev
        ? new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000
        : false;
      return { ...msg, isFirstInRun: !sameAuthor || !within5Min };
    });
  }, [visibleMessages]);

  useEffect(() => {
    if (!showPendingQueue) setTimeout(scrollToBottom, 80);
  }, [groupedMessages.length, showPendingQueue, scrollToBottom]);

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
      message_type: null,
      metadata: null,
      status: initialStatus,
      approved_by: null,
      approved_at: null,
      rejected_by: null,
      rejected_at: null,
      edited_at: null,
      like_count: 0,
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
        prev.map((m) => m.id === tempId ? { ...data, author: currentUser ?? undefined } : m)
      );
    }
    setSending(false);
  }, [newMessage, sending, group, orgId, currentUserId, requiresApproval, canModerate, currentUser, scrollToBottom]);

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
      const { error } = await supabase.from("chat_messages").update(updateData).eq("id", messageId);
      if (error) await loadMessages();
    },
    [currentUserId, loadMessages]
  );

  // ─── Members sheet ────────────────────────────────────────────────────────

  const openMembersSheet = useCallback(() => {
    setAddMembersMode(false);
    setMemberSearch("");
    membersSheetRef.current?.expand();
  }, []);

  const fetchOrgMembers = useCallback(async () => {
    if (!orgId) return;
    setLoadingOrgMembers(true);
    try {
      const { data, error } = await supabase
        .from("user_organization_roles")
        .select("user_id, role, user:users(id, name, email, avatar_url)")
        .eq("organization_id", orgId)
        .eq("status", "active")
        .in("role", [...MOBILE_CHAT_MEMBER_DIRECTORY_ROLES]);

      if (error) throw error;
      if (isMountedRef.current) setOrgMembers((data || []) as OrgMemberRow[]);
    } catch (e) {
      if (isMountedRef.current) {
        setOrgMembers([]);
      }
      showToast((e as Error).message || "Failed to load organization members", "error");
    } finally {
      if (isMountedRef.current) setLoadingOrgMembers(false);
    }
  }, [orgId]);

  const handleShowAddMembers = useCallback(() => {
    setAddMembersMode(true);
    setMemberSearch("");
    fetchOrgMembers();
  }, [fetchOrgMembers]);

  const handleAddMember = useCallback(
    async (userId: string) => {
      if (!resolvedGroupId || !orgId || !currentUserId || mutatingMemberId) return;
      setMutatingMemberId(userId);
      try {
        const { error } = await supabase
          .from("chat_group_members")
          .insert(
            buildChatGroupMemberInsertPayload({
              groupId: resolvedGroupId,
              organizationId: orgId,
              userId,
              addedBy: currentUserId,
            })
          );

        if (error?.code === "23505") {
          const { error: reactivateError } = await supabase
            .from("chat_group_members")
            .update(buildChatGroupMemberReactivationPayload(currentUserId))
            .eq("chat_group_id", resolvedGroupId)
            .eq("user_id", userId);

          if (reactivateError) throw reactivateError;
        } else if (error) {
          throw error;
        }

        await loadGroupDetails();
      } catch (e) {
        showToast((e as Error).message || "Failed to add member", "error");
      } finally {
        if (isMountedRef.current) setMutatingMemberId(null);
      }
    },
    [resolvedGroupId, orgId, currentUserId, mutatingMemberId, loadGroupDetails]
  );

  const handleRemoveMember = useCallback(
    async (userId: string) => {
      if (!resolvedGroupId || mutatingMemberId) return;
      setMutatingMemberId(userId);
      try {
        const { error } = await supabase
          .from("chat_group_members")
          .update({ removed_at: new Date().toISOString() })
          .eq("chat_group_id", resolvedGroupId)
          .eq("user_id", userId);

        if (error) throw error;

        if (userId === currentUserId) {
          membersSheetRef.current?.close();
          router.back();
        } else {
          await loadGroupDetails();
        }
      } catch (e) {
        showToast((e as Error).message || "Failed to remove member", "error");
      } finally {
        if (isMountedRef.current) setMutatingMemberId(null);
      }
    },
    [resolvedGroupId, currentUserId, mutatingMemberId, loadGroupDetails, router]
  );

  // Members not yet in the group, filtered by search
  const memberGroupIds = useMemo(
    () => new Set(members.map((m) => m.user_id)),
    [members]
  );

  const filteredOrgMembers = useMemo(() => {
    const q = memberSearch.toLowerCase().trim();
    return orgMembers.filter((m) => {
      if (!m.user) return false;
      if (memberGroupIds.has(m.user_id)) return false;
      if (!q) return true;
      const name = (m.user.name ?? "").toLowerCase();
      const email = (m.user.email ?? "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [orgMembers, memberGroupIds, memberSearch]);

  const renderBackdrop = useCallback(
    (props: any) =>
      BottomSheetBackdrop ? (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          opacity={0.4}
        />
      ) : null,
    []
  );

  // ─── Render helpers ───────────────────────────────────────────────────────

  const listContentStyle = useMemo(
    () => [styles.listContent, { paddingBottom: showPendingQueue ? spacing.lg : 88 }],
    [styles.listContent, showPendingQueue]
  );

  const renderMessage = useCallback(
    ({ item }: { item: MessageWithAuthor }) => {
      const isOwn = item.author_id === currentUserId;
      const isPending = item.status === "pending";
      const isRejected = item.status === "rejected";
      const authorName = item.author?.name || item.author?.email || "Unknown";
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
                <Text style={styles.messageAuthor} numberOfLines={1}>{authorName}</Text>
                <Text style={styles.messageTime}>{formatTimestamp(item.created_at)}</Text>
              </View>
            )}
            {isFirstInRun && isOwn && (
              <Text style={styles.messageTime}>{formatTimestamp(item.created_at)}</Text>
            )}
            <View style={[styles.messageBubble, bubbleRadius, isOwn ? styles.messageBubbleOwn : styles.messageBubbleOther, isPending && styles.messageBubblePending]}>
              <Text style={[styles.messageText, isOwn && styles.messageTextOwn]}>{item.body}</Text>
            </View>
            {isPending && <Text style={styles.pendingLabel}>Pending</Text>}
            {isRejected && <Text style={styles.rejectedLabel}>Rejected</Text>}
            {canModerate && isPending && !isOwn && (
              <View style={styles.moderationRow}>
                <Pressable onPress={() => handleModeration(item.id, "approved")} style={({ pressed }) => [styles.moderationButton, styles.moderationApprove, pressed && styles.moderationPressed]}>
                  <Text style={styles.moderationApproveText}>Approve</Text>
                </Pressable>
                <Pressable onPress={() => handleModeration(item.id, "rejected")} style={({ pressed }) => [styles.moderationButton, styles.moderationReject, pressed && styles.moderationPressed]}>
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

  const renderMemberRow = useCallback(
    ({ item }: { item: ChatMemberWithUser }) => {
      const isSelf = item.user_id === currentUserId;
      const isLoading = mutatingMemberId === item.user_id;
      const userName = item.users?.name || item.users?.email || "Unknown";
      const roleBadge = item.role === "admin" ? "Admin" : item.role === "moderator" ? "Mod" : null;

      return (
        <View style={styles.memberRow}>
          <Avatar size="sm" uri={item.users?.avatar_url} name={userName} />
          <View style={styles.memberInfo}>
            <Text style={styles.memberName} numberOfLines={1}>{userName}</Text>
            {roleBadge && <Text style={styles.memberRoleBadge}>{roleBadge}</Text>}
          </View>
          {isLoading ? (
            <ActivityIndicator size="small" color={CHAT_COLORS.accent} />
          ) : isSelf ? (
            <Pressable
              onPress={() => handleRemoveMember(item.user_id)}
              style={({ pressed }) => [styles.leaveButton, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel="Leave group"
            >
              <Text style={styles.leaveButtonText}>Leave</Text>
            </Pressable>
          ) : canManageMembers ? (
            <Pressable
              onPress={() => handleRemoveMember(item.user_id)}
              style={({ pressed }) => [styles.removeButton, pressed && { opacity: 0.7 }]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${userName}`}
            >
              <X size={14} color={CHAT_COLORS.muted} />
            </Pressable>
          ) : null}
        </View>
      );
    },
    [currentUserId, canManageMembers, mutatingMemberId, handleRemoveMember, styles]
  );

  const renderOrgMemberRow = useCallback(
    ({ item }: { item: OrgMemberRow }) => {
      if (!item.user) return null;
      const isLoading = mutatingMemberId === item.user_id;
      const userName = item.user.name || item.user.email || "Unknown";

      return (
        <View style={styles.memberRow}>
          <Avatar size="sm" uri={item.user.avatar_url} name={userName} />
          <View style={styles.memberInfo}>
            <Text style={styles.memberName} numberOfLines={1}>{userName}</Text>
          </View>
          {isLoading ? (
            <ActivityIndicator size="small" color={CHAT_COLORS.accent} />
          ) : (
            <Pressable
              onPress={() => handleAddMember(item.user_id)}
              style={({ pressed }) => [styles.addButton, pressed && { opacity: 0.7 }]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Add ${userName}`}
            >
              <Plus size={14} color="#ffffff" />
            </Pressable>
          )}
        </View>
      );
    },
    [mutatingMemberId, handleAddMember, styles]
  );

  // ─── Loading / error states ───────────────────────────────────────────────

  if (loading && !group) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={CHAT_COLORS.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !group) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Unable to load chat</Text>
          <Text style={styles.errorText}>{error || "Chat group not found."}</Text>
          <Pressable style={styles.backButton} onPress={() => router.back()} accessibilityRole="button">
            <Text style={styles.backButtonText}>Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Main render ──────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Gradient header */}
      <LinearGradient colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]} style={styles.headerGradient}>
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable onPress={() => router.back()} style={styles.backButtonHeader} accessibilityRole="button" accessibilityLabel="Go back">
              <ArrowLeft size={20} color={APP_CHROME.headerTitle} />
            </Pressable>

            {/* Tappable avatar + name → opens members sheet */}
            <Pressable style={styles.headerGroupButton} onPress={openMembersSheet} accessibilityRole="button" accessibilityLabel="View group members">
              <Avatar size="sm" name={group.name} uri={(group as any).avatar_url ?? null} />
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>{group.name}</Text>
                <Text style={styles.headerMeta}>
                  {members.length} member{members.length !== 1 ? "s" : ""} · tap to view
                </Text>
              </View>
            </Pressable>

            {canModerate && pendingCount > 0 && (
              <Pressable
                onPress={() => setShowPendingQueue((prev) => !prev)}
                style={({ pressed }) => [styles.pendingToggle, pressed && styles.pendingTogglePressed]}
                accessibilityRole="button"
              >
                <Text style={styles.pendingToggleText}>{pendingCount}</Text>
              </Pressable>
            )}
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Chat body */}
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
      >
        <FlatList
          ref={listRef}
          data={groupedMessages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={listContentStyle}
          ListHeaderComponent={
            <View style={styles.groupMeta}>
              <Text style={styles.groupDescription}>
                {group.description || `${members.length} member${members.length !== 1 ? "s" : ""}`}
              </Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                {showPendingQueue ? "No pending messages" : "No messages yet. Start the conversation!"}
              </Text>
            </View>
          }
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews
        />

        {!showPendingQueue && (
          <SafeAreaView edges={["bottom"]} style={styles.composerContainer}>
            <View style={styles.composer}>
              <TextInput
                value={newMessage}
                onChangeText={setNewMessage}
                placeholder={requiresApproval && !canModerate ? "Type a message (requires approval)..." : "Type a message..."}
                style={styles.input}
                editable={!sending}
                returnKeyType="send"
                onSubmitEditing={handleSend}
                multiline
              />
              <Pressable
                onPress={handleSend}
                disabled={!newMessage.trim() || sending}
                style={({ pressed }) => [styles.sendButton, (!newMessage.trim() || sending) && styles.sendButtonDisabled, pressed && styles.sendButtonPressed]}
                accessibilityRole="button"
                accessibilityLabel="Send message"
              >
                <ArrowUp size={20} color={!newMessage.trim() || sending ? CHAT_COLORS.muted : "#ffffff"} />
              </Pressable>
            </View>
          </SafeAreaView>
        )}

        {requiresApproval && !canModerate && !showPendingQueue && (
          <Text style={styles.approvalNote}>
            Messages in this group require moderator approval before being visible.
          </Text>
        )}
      </KeyboardAvoidingView>

      {/* Members bottom sheet */}
      {BottomSheet && (
        <BottomSheet
          ref={membersSheetRef}
          index={-1}
          snapPoints={sheetSnapPoints}
          enablePanDownToClose
          backdropComponent={renderBackdrop}
          backgroundStyle={styles.sheetBackground}
          handleIndicatorStyle={styles.sheetIndicator}
        >
          {addMembersMode ? (
            /* ── Add Members view ── */
            <BottomSheetView style={styles.sheetContent}>
              {/* Header */}
              <View style={styles.sheetHeader}>
                <Pressable onPress={() => setAddMembersMode(false)} style={styles.sheetBackButton} hitSlop={8}>
                  <ChevronLeft size={20} color={CHAT_COLORS.title} />
                </Pressable>
                <Text style={styles.sheetTitle}>Add Members</Text>
                <View style={{ width: 32 }} />
              </View>

              {/* Search */}
              <View style={styles.searchContainer}>
                <TextInput
                  value={memberSearch}
                  onChangeText={setMemberSearch}
                  placeholder="Search members..."
                  style={styles.searchInput}
                  autoFocus
                  clearButtonMode="while-editing"
                />
              </View>

              {loadingOrgMembers ? (
                <View style={styles.sheetLoading}>
                  <ActivityIndicator size="small" color={CHAT_COLORS.accent} />
                </View>
              ) : (
                <BottomSheetFlatList
                  data={filteredOrgMembers}
                  keyExtractor={(item: OrgMemberRow) => item.user_id}
                  renderItem={renderOrgMemberRow}
                  contentContainerStyle={styles.sheetList}
                  ListEmptyComponent={
                    <View style={styles.sheetEmpty}>
                      <Text style={styles.sheetEmptyText}>
                        {memberSearch ? "No members match your search" : "All org members are already in this group"}
                      </Text>
                    </View>
                  }
                  keyboardShouldPersistTaps="handled"
                />
              )}
            </BottomSheetView>
          ) : (
            /* ── Members list view ── */
            <BottomSheetView style={styles.sheetContent}>
              {/* Header */}
              <View style={styles.sheetHeader}>
                <Users size={18} color={CHAT_COLORS.subtitle} />
                <Text style={styles.sheetTitle}>
                  {members.length} Member{members.length !== 1 ? "s" : ""}
                </Text>
                <Pressable onPress={() => membersSheetRef.current?.close()} hitSlop={8} style={styles.sheetCloseButton}>
                  <X size={18} color={CHAT_COLORS.muted} />
                </Pressable>
              </View>

              <BottomSheetFlatList
                data={members}
                keyExtractor={(item: ChatMemberWithUser) => item.id}
                renderItem={renderMemberRow}
                contentContainerStyle={styles.sheetList}
                ListFooterComponent={
                  canManageMembers ? (
                    <Pressable
                      onPress={handleShowAddMembers}
                      style={({ pressed }) => [styles.addMembersButton, pressed && { opacity: 0.8 }]}
                      accessibilityRole="button"
                    >
                      <Plus size={16} color="#ffffff" />
                      <Text style={styles.addMembersButtonText}>Add Members</Text>
                    </Pressable>
                  ) : null
                }
                ListEmptyComponent={
                  <View style={styles.sheetEmpty}>
                    <Text style={styles.sheetEmptyText}>No members found</Text>
                  </View>
                }
              />
            </BottomSheetView>
          )}
        </BottomSheet>
      )}
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: CHAT_COLORS.background },
    headerGradient: { paddingBottom: spacing.md },
    headerSafeArea: {},
    headerContent: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    backButtonHeader: { padding: spacing.xs },
    headerGroupButton: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    headerTextContainer: { flex: 1 },
    headerTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: APP_CHROME.headerTitle,
    },
    headerMeta: {
      fontSize: fontSize.xs,
      color: APP_CHROME.headerMeta,
      marginTop: 1,
    },
    pendingToggle: {
      backgroundColor: "rgba(245, 158, 11, 0.15)",
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: borderRadius.sm,
    },
    pendingTogglePressed: { opacity: 0.7 },
    pendingToggleText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
      color: CHAT_COLORS.pending,
    },
    centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.lg, gap: spacing.sm },
    errorTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: CHAT_COLORS.title },
    errorText: { fontSize: fontSize.sm, color: CHAT_COLORS.subtitle, textAlign: "center" },
    backButton: {
      backgroundColor: CHAT_COLORS.accent,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.md,
    },
    backButtonText: { color: "#ffffff", fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
    groupMeta: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
    groupDescription: { fontSize: fontSize.sm, color: CHAT_COLORS.subtitle },
    listContent: { paddingHorizontal: spacing.md, gap: spacing.sm },
    messageRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
    messageRowOwn: { flexDirection: "row-reverse" },
    messageColumn: { width: 32, alignItems: "center" },
    avatarSpacer: { width: 32, height: 32 },
    messageBody: { flex: 1, gap: 4 },
    messageBodyOwn: { alignItems: "flex-end" },
    messageMetaRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.xs },
    messageAuthor: { fontSize: fontSize.xs, color: CHAT_COLORS.muted, maxWidth: 120 },
    messageTime: { fontSize: fontSize.xs, color: CHAT_COLORS.muted },
    messageBubble: { paddingVertical: 10, paddingHorizontal: spacing.sm, maxWidth: "85%" },
    messageBubbleOwn: { backgroundColor: CHAT_COLORS.accent },
    messageBubbleOther: { backgroundColor: CHAT_COLORS.bubble, borderWidth: 1, borderColor: CHAT_COLORS.border },
    messageBubblePending: { borderWidth: 1, borderColor: CHAT_COLORS.pending },
    messageText: { fontSize: fontSize.sm, color: CHAT_COLORS.title, lineHeight: 20 },
    messageTextOwn: { color: "#ffffff" },
    pendingLabel: { fontSize: fontSize.xs, color: CHAT_COLORS.pending, fontWeight: fontWeight.medium, paddingHorizontal: spacing.xs },
    rejectedLabel: { fontSize: fontSize.xs, color: CHAT_COLORS.rejected, fontWeight: fontWeight.medium, paddingHorizontal: spacing.xs },
    moderationRow: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.xs, paddingHorizontal: spacing.xs },
    moderationButton: { paddingVertical: 6, paddingHorizontal: spacing.xs, borderRadius: borderRadius.sm },
    moderationPressed: { opacity: 0.7 },
    moderationApprove: { backgroundColor: CHAT_COLORS.accent },
    moderationApproveText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: "#ffffff" },
    moderationReject: { backgroundColor: "rgba(220, 38, 38, 0.12)", borderWidth: 1, borderColor: "rgba(220, 38, 38, 0.3)" },
    moderationRejectText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: CHAT_COLORS.rejected },
    emptyState: { alignItems: "center", paddingVertical: spacing.lg },
    emptyText: { fontSize: fontSize.sm, color: CHAT_COLORS.subtitle, textAlign: "center" },
    composerContainer: { backgroundColor: CHAT_COLORS.card, borderTopWidth: 1, borderTopColor: CHAT_COLORS.border },
    composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
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
    sendButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: CHAT_COLORS.accent, alignItems: "center", justifyContent: "center" },
    sendButtonPressed: { opacity: 0.8 },
    sendButtonDisabled: { opacity: 0.5 },
    approvalNote: {
      fontSize: fontSize.xs,
      color: CHAT_COLORS.muted,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: CHAT_COLORS.card,
      borderTopWidth: 1,
      borderTopColor: CHAT_COLORS.border,
    },
    // ── Members sheet ──────────────────────────────────────────────────────
    sheetBackground: {
      backgroundColor: "#ffffff",
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
    },
    sheetIndicator: {
      backgroundColor: "#e2e8f0",
      width: 36,
    },
    sheetContent: { flex: 1 },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: "#f1f5f9",
      gap: spacing.sm,
    },
    sheetTitle: {
      flex: 1,
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: CHAT_COLORS.title,
    },
    sheetBackButton: {
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
    },
    sheetCloseButton: {
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
    },
    sheetList: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xl,
    },
    sheetLoading: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: spacing.xl,
    },
    sheetEmpty: {
      alignItems: "center",
      paddingVertical: spacing.xl,
    },
    sheetEmptyText: {
      fontSize: fontSize.sm,
      color: CHAT_COLORS.muted,
      textAlign: "center",
    },
    // Member rows
    memberRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: spacing.sm,
      gap: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: "#f8fafc",
    },
    memberInfo: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    memberName: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: CHAT_COLORS.title,
      flex: 1,
    },
    memberRoleBadge: {
      fontSize: 10,
      fontWeight: fontWeight.semibold,
      color: CHAT_COLORS.accent,
      backgroundColor: "rgba(5,150,105,0.1)",
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      overflow: "hidden",
    },
    removeButton: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: "#f1f5f9",
      alignItems: "center",
      justifyContent: "center",
    },
    leaveButton: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 5,
      borderRadius: borderRadius.sm,
      borderWidth: 1,
      borderColor: "#e2e8f0",
    },
    leaveButtonText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: CHAT_COLORS.subtitle,
    },
    addButton: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: CHAT_COLORS.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    // Search
    searchContainer: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    searchInput: {
      backgroundColor: "#f1f5f9",
      borderRadius: 10,
      paddingHorizontal: spacing.sm,
      paddingVertical: 9,
      fontSize: fontSize.sm,
      color: CHAT_COLORS.title,
    },
    // Add members button
    addMembersButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xs,
      backgroundColor: CHAT_COLORS.accent,
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.md,
    },
    addMembersButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: "#ffffff",
    },
  });
