"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Badge, Avatar } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { ManageMembersPanel } from "@/components/chat/ManageMembersPanel";
import type { ChatGroup, ChatGroupMember, ChatMessage, User, ChatMessageStatus } from "@/types/database";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { debugLog } from "@/lib/debug";
import { trackBehavioralEvent } from "@/lib/analytics/events";

interface ChatRoomProps {
  group: ChatGroup;
  orgSlug: string;
  organizationId: string;
  currentUserId: string;
  currentUser: User;
  members: (ChatGroupMember & { users: User })[];
  canModerate: boolean;
  isCreator: boolean;
  requiresApproval: boolean;
  memberJoinedAt?: string;
}

type MessageWithAuthor = ChatMessage & {
  author?: User;
};

export function ChatRoom({
  group,
  orgSlug,
  organizationId,
  currentUserId,
  currentUser,
  members: initialMembers,
  canModerate,
  isCreator,
  requiresApproval,
  memberJoinedAt,
}: ChatRoomProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<MessageWithAuthor[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [showPendingQueue, setShowPendingQueue] = useState(false);
  const [showMembersPanel, setShowMembersPanel] = useState(false);
  const [members, setMembers] = useState(initialMembers);
  const [userCache, setUserCache] = useState<Map<string, User>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  // Debug: log chat room state on mount
  useEffect(() => {
    debugLog("chat", "ChatRoom mounted", {
      groupId: group.id,
      memberCount: members.length,
      canModerate,
      requiresApproval,
      hasEditMembersUI: true,
    });
    trackBehavioralEvent("chat_thread_open", {
      thread_id: group.id,
      open_source: "list",
    }, organizationId);
  }, [group.id, members.length, canModerate, requiresApproval, organizationId]);

  // Build a map of user IDs to user info (combining members + cached users)
  const userMap = useMemo(() => {
    const map = new Map<string, User>();
    // Add members
    members.forEach((m) => {
      if (m.users) {
        map.set(m.user_id, m.users);
      }
    });
    // Add current user
    map.set(currentUserId, currentUser);
    // Add cached users (for non-members who sent messages)
    userCache.forEach((user, id) => {
      if (!map.has(id)) {
        map.set(id, user);
      }
    });
    return map;
  }, [members, currentUserId, currentUser, userCache]);

  // Fetch user info for unknown authors
  const fetchUnknownUsers = useCallback(async (authorIds: string[]) => {
    const unknownIds = authorIds.filter(id => !userMap.has(id));
    if (unknownIds.length === 0) return;

    const { data } = await supabase
      .from("users")
      .select("id, name, email, avatar_url")
      .in("id", unknownIds);

    if (data && data.length > 0) {
      setUserCache(prev => {
        const newCache = new Map(prev);
        data.forEach(user => newCache.set(user.id, user as User));
        return newCache;
      });
    }
  }, [supabase, userMap]);

  // Update message authors when userMap changes (e.g., after fetching unknown users)
  useEffect(() => {
    setMessages(prev => prev.map(msg => ({
      ...msg,
      author: userMap.get(msg.author_id) || msg.author,
    })));
  }, [userMap]);

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Load initial messages (filtered by joined_at so new members only see messages from after they joined)
  useEffect(() => {
    async function loadMessages() {
      setIsLoading(true);
      let query = supabase
        .from("chat_messages")
        .select("*")
        .eq("chat_group_id", group.id)
        .is("deleted_at", null);

      if (memberJoinedAt) {
        query = query.gte("created_at", memberJoinedAt);
      }

      const { data, error } = await query
        .order("created_at", { ascending: true })
        .limit(100);

      if (!error && data) {
        // Fetch user info for any unknown authors
        const authorIds = [...new Set(data.map(msg => msg.author_id))];
        await fetchUnknownUsers(authorIds);
        
        const messagesWithAuthors = data.map((msg) => ({
          ...msg,
          author: userMap.get(msg.author_id),
        }));
        setMessages(messagesWithAuthors);
      }
      setIsLoading(false);
      setTimeout(scrollToBottom, 100);
    }
    loadMessages();
  }, [group.id, supabase, scrollToBottom, userMap, fetchUnknownUsers, memberJoinedAt]);

  // Subscribe to real-time updates
  useEffect(() => {
    const channel = supabase
      .channel(`chat_messages:${group.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_messages",
          filter: `chat_group_id=eq.${group.id}`,
        },
        async (payload: RealtimePostgresChangesPayload<ChatMessage>) => {
          if (payload.eventType === "INSERT") {
            const newMsg = payload.new as ChatMessage;
            // Fetch user info if unknown
            if (!userMap.has(newMsg.author_id)) {
              await fetchUnknownUsers([newMsg.author_id]);
            }
            // Only add if we should see it (approved, or our own, or we can moderate)
            if (
              newMsg.status === "approved" ||
              newMsg.author_id === currentUserId ||
              canModerate
            ) {
              setMessages((prev) => {
                // Avoid duplicates - check by id
                if (prev.some((m) => m.id === newMsg.id)) return prev;
                // Also check if we already have this message as a temp (optimistic) one
                // by matching author + body + similar timestamp (within 5 seconds)
                const hasTempVersion = prev.some(
                  (m) =>
                    m.id.startsWith("temp-") &&
                    m.author_id === newMsg.author_id &&
                    m.body === newMsg.body
                );
                if (hasTempVersion) {
                  // Replace temp with real message
                  return prev.map((m) =>
                    m.id.startsWith("temp-") &&
                    m.author_id === newMsg.author_id &&
                    m.body === newMsg.body
                      ? { ...newMsg, author: userMap.get(newMsg.author_id) }
                      : m
                  );
                }
                return [
                  ...prev,
                  { ...newMsg, author: userMap.get(newMsg.author_id) },
                ];
              });
              setTimeout(scrollToBottom, 100);
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
  }, [group.id, supabase, currentUserId, canModerate, scrollToBottom, userMap, fetchUnknownUsers]);

  const canManage = canModerate || isCreator;

  // Refresh members list (called by ManageMembersPanel and realtime)
  const refreshMembers = useCallback(async () => {
    const { data, error: refreshError } = await supabase
      .from("chat_group_members")
      .select(`
        *,
        users:user_id (id, name, email, avatar_url)
      `)
      .eq("chat_group_id", group.id)
      .is("removed_at", null);

    if (refreshError) {
      console.error("[chat-members] refreshMembers failed:", refreshError);
      return;
    }
    if (data) {
      setMembers(data as unknown as (ChatGroupMember & { users: User })[]);
    }
  }, [supabase, group.id]);

  // Subscribe to real-time member changes
  useEffect(() => {
    const channel = supabase
      .channel(`chat_group_members:${group.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_group_members",
          filter: `chat_group_id=eq.${group.id}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const deleted = payload.old as { user_id?: string };
            if (deleted.user_id === currentUserId) {
              router.push(`/${orgSlug}/chat`);
              return;
            }
          }
          // Handle soft-delete: member removal is an UPDATE setting removed_at
          if (payload.eventType === "UPDATE") {
            const updated = payload.new as { user_id?: string; removed_at?: string | null };
            if (updated.user_id === currentUserId && updated.removed_at) {
              router.push(`/${orgSlug}/chat`);
              return;
            }
          }
          refreshMembers();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [group.id, supabase, currentUserId, orgSlug, router, refreshMembers]);

  // Send message with optimistic UI
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || isSending) return;

    setIsSending(true);
    const messageBody = newMessage.trim();
    setNewMessage("");

    // Determine initial status
    const initialStatus: ChatMessageStatus = requiresApproval && !canModerate ? "pending" : "approved";

    // Generate a temporary ID for optimistic update
    const tempId = `temp-${Date.now()}`;
    const optimisticMessage: MessageWithAuthor = {
      id: tempId,
      chat_group_id: group.id,
      organization_id: organizationId,
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
      author: currentUser,
    };

    // Optimistically add message to UI immediately
    setMessages((prev) => [...prev, optimisticMessage]);
    setTimeout(scrollToBottom, 50);

    const { data, error } = await supabase
      .from("chat_messages")
      .insert({
        chat_group_id: group.id,
        organization_id: organizationId,
        author_id: currentUserId,
        body: messageBody,
        status: initialStatus,
      })
      .select()
      .single();

    if (error) {
      console.error("Failed to send message:", error);
      trackBehavioralEvent("chat_message_send", {
        thread_id: group.id,
        message_type: "text",
        result: "fail_server",
        error_code: "send_failed",
      }, organizationId);
      // Remove the optimistic message on failure
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setNewMessage(messageBody); // Restore message for retry
    } else if (data) {
      trackBehavioralEvent("chat_message_send", {
        thread_id: group.id,
        message_type: "text",
        result: "success",
      }, organizationId);
      // Replace temp message with real one from server
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId ? { ...data, author: currentUser } : m
        )
      );
    }
    setIsSending(false);
  };

  // Approve/reject message with optimistic UI
  const handleModeration = async (messageId: string, action: "approved" | "rejected") => {
    // Optimistically update the UI immediately
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
      console.error("Failed to update message:", error);
      // Revert on error - refetch messages
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("chat_group_id", group.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(100);

      if (data) {
        setMessages(data.map((msg) => ({ ...msg, author: userMap.get(msg.author_id) })));
      }
    }
  };

  // Filter messages for display
  const visibleMessages = messages.filter((m) => {
    if (showPendingQueue) {
      return m.status === "pending";
    }
    return m.status === "approved" || m.author_id === currentUserId || canModerate;
  });

  const pendingCount = messages.filter((m) => m.status === "pending").length;

  return (
    <div className="animate-fade-in flex flex-col h-[calc(100vh-8rem)]">
      <PageHeader
        title={group.name}
        description={group.description || `${members.length} members`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant={showMembersPanel ? "primary" : "secondary"}
              onClick={() => setShowMembersPanel(!showMembersPanel)}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
              <Badge variant="muted">{members.length}</Badge>
              Members
            </Button>
            {canModerate && pendingCount > 0 && (
              <Button
                variant={showPendingQueue ? "primary" : "secondary"}
                onClick={() => setShowPendingQueue(!showPendingQueue)}
              >
                <Badge variant="warning">{pendingCount}</Badge>
                Pending
              </Button>
            )}
            <Link href={`/${orgSlug}/chat`}>
              <Button variant="secondary">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                </svg>
                Back
              </Button>
            </Link>
          </div>
        }
      />

      <div className="flex-1 flex overflow-hidden mt-4">
      <Card className="flex-1 flex flex-col overflow-hidden">
        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-org-secondary)]"></div>
            </div>
          ) : visibleMessages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              {showPendingQueue ? "No pending messages" : "No messages yet. Start the conversation!"}
            </div>
          ) : (
            visibleMessages.map((message) => {
              const isOwn = message.author_id === currentUserId;
              const isPending = message.status === "pending";
              const isRejected = message.status === "rejected";

              return (
                <div
                  key={message.id}
                  className={`flex gap-3 ${isOwn ? "flex-row-reverse" : ""}`}
                >
                  <Avatar
                    src={message.author?.avatar_url || undefined}
                    name={message.author?.name || message.author?.email || "User"}
                    size="sm"
                  />
                  <div className={`max-w-[70%] ${isOwn ? "items-end" : "items-start"} flex flex-col`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-muted-foreground">
                        {message.author?.name || message.author?.email || "Unknown"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(message.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {isPending && (
                        <Badge variant="warning">Pending</Badge>
                      )}
                      {isRejected && (
                        <Badge variant="error">Rejected</Badge>
                      )}
                    </div>
                    <div
                      className={`rounded-lg px-4 py-2 ${
                        isOwn
                          ? "bg-[var(--color-org-secondary)] text-[var(--color-org-secondary-foreground)]"
                          : "bg-muted"
                      } ${isPending ? "opacity-70 border border-dashed border-yellow-500" : ""}`}
                    >
                      <p className="whitespace-pre-wrap break-words">{message.body}</p>
                    </div>

                    {/* Moderation actions */}
                    {canModerate && isPending && !isOwn && (
                      <div className="flex gap-2 mt-2">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => handleModeration(message.id, "approved")}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleModeration(message.id, "rejected")}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Message composer */}
        {!showPendingQueue && (
          <form onSubmit={handleSend} className="p-4 border-t border-border">
            <div className="flex gap-2">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder={requiresApproval && !canModerate ? "Type a message (requires approval)..." : "Type a message..."}
                className="flex-1 px-4 py-2 rounded-lg bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-[var(--color-org-secondary)]"
                disabled={isSending}
              />
              <Button type="submit" disabled={!newMessage.trim() || isSending}>
                {isSending ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                ) : (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                )}
              </Button>
            </div>
            {requiresApproval && !canModerate && (
              <p className="text-xs text-muted-foreground mt-2">
                Messages in this group require moderator approval before being visible to others.
              </p>
            )}
          </form>
        )}
      </Card>

      {showMembersPanel && (
        <ManageMembersPanel
          orgSlug={orgSlug}
          organizationId={organizationId}
          groupId={group.id}
          currentUserId={currentUserId}
          isCreator={isCreator}
          canManage={canManage}
          onClose={() => setShowMembersPanel(false)}
          onMembersChanged={refreshMembers}
        />
      )}
      </div>
    </div>
  );
}
