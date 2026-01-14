"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Badge, Avatar } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { ManageMembersPanel } from "@/components/chat/ManageMembersPanel";
import { MessageBody } from "@/components/chat/MessageBody";
import { AttachmentMenu } from "@/components/chat/AttachmentMenu";
import { PollComposer } from "@/components/chat/PollComposer";
import { FormComposer } from "@/components/chat/FormComposer";
import { useChatRealtime } from "@/hooks/useChatRealtime";
import type { ChatGroup, ChatGroupMember, ChatMessage, ChatPollVote, ChatFormResponse, User, ChatMessageStatus } from "@/types/database";
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
  const [composerMode, setComposerMode] = useState<"text" | "poll" | "form">("text");
  const [pollVotesMap, setPollVotesMap] = useState<Map<string, ChatPollVote[]>>(new Map());
  const [formResponsesMap, setFormResponsesMap] = useState<Map<string, ChatFormResponse[]>>(new Map());
  const [isCreatingPoll, setIsCreatingPoll] = useState(false);
  const [isCreatingForm, setIsCreatingForm] = useState(false);
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

  // Keep a stable ref to the latest userMap so fetchUnknownUsers never captures a stale closure
  const userMapRef = useRef(userMap);
  useEffect(() => {
    userMapRef.current = userMap;
  }, [userMap]);

  // Fetch user info for unknown authors.
  // Returns the merged map immediately so callers can use fresh data without waiting for a re-render.
  const fetchUnknownUsers = useCallback(async (authorIds: string[]): Promise<Map<string, User>> => {
    const currentMap = userMapRef.current;
    const unknownIds = authorIds.filter(id => !currentMap.has(id));
    if (unknownIds.length === 0) return currentMap;

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
      // Return a merged map so the caller gets fresh data immediately (before the next render)
      const merged = new Map(currentMap);
      data.forEach(user => merged.set(user.id, user as User));
      return merged;
    }
    return currentMap;
  }, [supabase]);

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
        // Fetch user info for any unknown authors.
        // fetchUnknownUsers returns the merged map immediately so we don't need to wait for a re-render.
        const authorIds = [...new Set(data.map(msg => msg.author_id))];
        const resolvedMap = await fetchUnknownUsers(authorIds);

        const messagesWithAuthors = data.map((msg) => ({
          ...msg,
          author: resolvedMap.get(msg.author_id),
        }));
        setMessages(messagesWithAuthors);

        // Load poll votes and form responses for special message types
        const pollMessageIds = data
          .filter((msg) => msg.message_type === "poll")
          .map((msg) => msg.id);
        const formMessageIds = data
          .filter((msg) => msg.message_type === "form")
          .map((msg) => msg.id);

        if (pollMessageIds.length > 0) {
          const { data: votes } = await supabase
            .from("chat_poll_votes")
            .select("*")
            .in("message_id", pollMessageIds);

          if (votes) {
            const votesMap = new Map<string, ChatPollVote[]>();
            votes.forEach((v) => {
              const existing = votesMap.get(v.message_id) ?? [];
              votesMap.set(v.message_id, [...existing, v]);
            });
            setPollVotesMap(votesMap);
          }
        }

        if (formMessageIds.length > 0) {
          const { data: responses } = await supabase
            .from("chat_form_responses")
            .select("*")
            .in("message_id", formMessageIds);

          if (responses) {
            const responsesMap = new Map<string, ChatFormResponse[]>();
            responses.forEach((r) => {
              const existing = responsesMap.get(r.message_id) ?? [];
              responsesMap.set(r.message_id, [...existing, r]);
            });
            setFormResponsesMap(responsesMap);
          }
        }
      }
      setIsLoading(false);
      setTimeout(scrollToBottom, 100);
    }
    loadMessages();
  }, [group.id, supabase, scrollToBottom, fetchUnknownUsers, memberJoinedAt]);

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

  // Handle member changes: redirect if current user removed, otherwise refresh
  const onMemberChange = useCallback(
    (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
      if (payload.eventType === "DELETE") {
        const deleted = payload.old as { user_id?: string };
        if (deleted.user_id === currentUserId) {
          router.push(`/${orgSlug}/chat`);
          return;
        }
      }
      if (payload.eventType === "UPDATE") {
        const updated = payload.new as { user_id?: string; removed_at?: string | null };
        if (updated.user_id === currentUserId && updated.removed_at) {
          router.push(`/${orgSlug}/chat`);
          return;
        }
      }
      refreshMembers();
    },
    [currentUserId, orgSlug, router, refreshMembers]
  );

  // Subscribe to all real-time changes (messages, poll votes, form responses, members)
  useChatRealtime({
    supabase,
    groupId: group.id,
    currentUserId,
    canModerate,
    userMap,
    fetchUnknownUsers,
    setMessages,
    setPollVotesMap,
    setFormResponsesMap,
    scrollToBottom,
    onMemberChange,
  });

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
      message_type: null,
      metadata: null,
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

    let responseData: { message?: ChatMessage; error?: string } | null = null;
    try {
      const response = await fetch(`/api/chat/${group.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: messageBody }),
      });
      responseData = await response.json().catch(() => null);

      if (!response.ok || !responseData?.message) {
        console.error("Failed to send message:", responseData?.error || "request_failed");
        trackBehavioralEvent("chat_message_send", {
          thread_id: group.id,
          message_type: "text",
          result: "fail_server",
          error_code: "send_failed",
        }, organizationId);
        // Remove the optimistic message on failure
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setNewMessage(messageBody); // Restore message for retry
        setIsSending(false);
        return;
      }
    } catch (error) {
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
      setIsSending(false);
      return;
    }

    trackBehavioralEvent("chat_message_send", {
      thread_id: group.id,
      message_type: "text",
      result: "success",
    }, organizationId);
    // Replace temp message with real one from server
    setMessages((prev) =>
      prev.map((m) =>
        m.id === tempId ? { ...responseData.message!, author: currentUser } : m
      )
    );
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

  // Handle poll vote
  const handleVote = useCallback(async (messageId: string, optionIndex: number) => {
    try {
      const res = await fetch(`/api/chat/${group.id}/polls/${messageId}/votes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ option_index: optionIndex }),
      });
      if (!res.ok) {
        const err = await res.json();
        console.error("Vote failed:", err);
      }
    } catch (error) {
      console.error("Vote failed:", error);
    }
  }, [group.id]);

  // Retract poll vote
  const handleRetractVote = useCallback(async (messageId: string) => {
    try {
      const res = await fetch(`/api/chat/${group.id}/polls/${messageId}/votes`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        console.error("Retract vote failed:", err);
      }
    } catch (error) {
      console.error("Retract vote failed:", error);
    }
  }, [group.id]);

  // Submit form response
  const handleFormSubmit = useCallback(async (messageId: string, responses: Record<string, string>) => {
    try {
      const res = await fetch(`/api/chat/${group.id}/forms/${messageId}/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(responses),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        console.error("Form submit failed:", err);
        return { ok: false, error: err?.error || "Failed to submit form response" };
      }
      return { ok: true };
    } catch (error) {
      console.error("Form submit failed:", error);
      return { ok: false, error: "Failed to submit form response" };
    }
  }, [group.id]);

  // Create poll
  const handleCreatePoll = useCallback(async (data: { question: string; options: string[]; allow_change: boolean }) => {
    setIsCreatingPoll(true);
    try {
      const res = await fetch(`/api/chat/${group.id}/polls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setComposerMode("text");
        trackBehavioralEvent("chat_message_send", {
          thread_id: group.id,
          message_type: "poll",
          result: "success",
        }, organizationId);
      } else {
        const err = await res.json();
        console.error("Create poll failed:", err);
      }
    } catch (error) {
      console.error("Create poll failed:", error);
    } finally {
      setIsCreatingPoll(false);
    }
  }, [group.id, organizationId]);

  // Create form
  const handleCreateForm = useCallback(async (data: {
    title: string;
    fields: Array<{
      id: string;
      label: string;
      type: "text" | "select" | "radio";
      required: boolean;
      options?: string[];
    }>;
  }) => {
    setIsCreatingForm(true);
    try {
      const res = await fetch(`/api/chat/${group.id}/forms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setComposerMode("text");
        trackBehavioralEvent("chat_message_send", {
          thread_id: group.id,
          message_type: "form",
          result: "success",
        }, organizationId);
      } else {
        const err = await res.json();
        console.error("Create form failed:", err);
      }
    } catch (error) {
      console.error("Create form failed:", error);
    } finally {
      setIsCreatingForm(false);
    }
  }, [group.id, organizationId]);

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
                        isOwn && !message.message_type
                          ? "bg-[var(--color-org-secondary)] text-[var(--color-org-secondary-foreground)]"
                          : message.message_type ? "" : "bg-muted"
                      } ${isPending ? "opacity-70 border border-dashed border-yellow-500" : ""}`}
                    >
                      <MessageBody
                        message={message}
                        currentUserId={currentUserId}
                        votes={pollVotesMap.get(message.id) ?? []}
                        userMap={userMap}
                        ownFormResponse={
                          (formResponsesMap.get(message.id) ?? []).find(
                            (r) => r.user_id === currentUserId
                          ) ?? null
                        }
                        responseCount={(formResponsesMap.get(message.id) ?? []).length}
                        onVote={handleVote}
                        onRetractVote={handleRetractVote}
                        onFormSubmit={handleFormSubmit}
                      />
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

        {/* Poll/Form composer panels */}
        {!showPendingQueue && composerMode === "poll" && (
          <PollComposer
            onCreatePoll={handleCreatePoll}
            onCancel={() => setComposerMode("text")}
            isSubmitting={isCreatingPoll}
          />
        )}
        {!showPendingQueue && composerMode === "form" && (
          <FormComposer
            onCreateForm={handleCreateForm}
            onCancel={() => setComposerMode("text")}
            isSubmitting={isCreatingForm}
          />
        )}

        {/* Message composer */}
        {!showPendingQueue && composerMode === "text" && (
          <form onSubmit={handleSend} className="p-4 border-t border-border">
            <div className="flex gap-2 items-center">
              <AttachmentMenu
                onSelectPoll={() => setComposerMode("poll")}
                onSelectForm={() => setComposerMode("form")}
              />
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
