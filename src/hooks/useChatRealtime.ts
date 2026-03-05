"use client";

import { useEffect, useCallback, useRef } from "react";
import type { SupabaseClient, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import type { ChatMessage, ChatPollVote, ChatFormResponse, User } from "@/types/database";

interface UseChatRealtimeOptions {
  supabase: SupabaseClient;
  groupId: string;
  currentUserId: string;
  canModerate: boolean;
  userMap: Map<string, User>;
  fetchUnknownUsers: (ids: string[]) => Promise<Map<string, User>>;
  setMessages: React.Dispatch<React.SetStateAction<(ChatMessage & { author?: User })[]>>;
  setPollVotesMap: React.Dispatch<React.SetStateAction<Map<string, ChatPollVote[]>>>;
  setFormResponsesMap: React.Dispatch<React.SetStateAction<Map<string, ChatFormResponse[]>>>;
  scrollToBottom: () => void;
  onMemberChange: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;
}

export function useChatRealtime({
  supabase,
  groupId,
  currentUserId,
  canModerate,
  userMap,
  fetchUnknownUsers,
  setMessages,
  setPollVotesMap,
  setFormResponsesMap,
  scrollToBottom,
  onMemberChange,
}: UseChatRealtimeOptions) {
  // Keep a ref to the latest userMap so handleMessageChange never captures a stale closure
  const userMapRef = useRef(userMap);
  useEffect(() => {
    userMapRef.current = userMap;
  }, [userMap]);

  // Handle incoming realtime message changes
  const handleMessageChange = useCallback(
    async (payload: RealtimePostgresChangesPayload<ChatMessage>) => {
      if (payload.eventType === "INSERT") {
        const newMsg = payload.new as ChatMessage;
        // fetchUnknownUsers returns the merged map so we can use it immediately
        const resolvedMap = await fetchUnknownUsers([newMsg.author_id]);
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
                  ? { ...newMsg, author: resolvedMap.get(newMsg.author_id) }
                  : m
              );
            }
            return [
              ...prev,
              { ...newMsg, author: resolvedMap.get(newMsg.author_id) },
            ];
          });
          setTimeout(scrollToBottom, 100);
        }
      } else if (payload.eventType === "UPDATE") {
        const updated = payload.new as ChatMessage;
        const shouldBeVisible =
          updated.status === "approved" ||
          updated.author_id === currentUserId ||
          canModerate;

        if (!shouldBeVisible) {
          setMessages((prev) => prev.filter((m) => m.id !== updated.id));
          return;
        }

        const resolvedMap = await fetchUnknownUsers([updated.author_id]);
        setMessages((prev) => {
          const existingIndex = prev.findIndex((m) => m.id === updated.id);
          if (existingIndex === -1) {
            return [...prev, { ...updated, author: resolvedMap.get(updated.author_id) }];
          }
          return prev.map((m) =>
            m.id === updated.id
              ? { ...updated, author: resolvedMap.get(updated.author_id) }
              : m
          );
        });
      } else if (payload.eventType === "DELETE") {
        const deleted = payload.old as { id: string };
        setMessages((prev) => prev.filter((m) => m.id !== deleted.id));
      }
    },
    [currentUserId, canModerate, scrollToBottom, fetchUnknownUsers, setMessages]
  );

  // Subscribe to messages, poll votes, form responses, and member changes
  useEffect(() => {
    // Channel for chat messages
    const messagesChannel = supabase
      .channel(`chat_messages:${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_messages",
          filter: `chat_group_id=eq.${groupId}`,
        },
        handleMessageChange
      )
      .subscribe();

    // Channel for poll votes
    const votesChannel = supabase
      .channel(`chat_poll_votes:${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_poll_votes",
          filter: `chat_group_id=eq.${groupId}`,
        },
        (payload: RealtimePostgresChangesPayload<ChatPollVote>) => {
          if (payload.eventType === "INSERT") {
            const newVote = payload.new as ChatPollVote;
            setPollVotesMap((prev) => {
              const existing = prev.get(newVote.message_id) ?? [];
              // Replace existing vote from same user (vote change)
              const filtered = existing.filter((v) => v.user_id !== newVote.user_id);
              const updated = new Map(prev);
              updated.set(newVote.message_id, [...filtered, newVote]);
              return updated;
            });
          } else if (payload.eventType === "UPDATE") {
            const updatedVote = payload.new as ChatPollVote;
            setPollVotesMap((prev) => {
              const existing = prev.get(updatedVote.message_id) ?? [];
              const updated = new Map(prev);
              updated.set(
                updatedVote.message_id,
                existing.map((v) => (v.user_id === updatedVote.user_id ? updatedVote : v))
              );
              return updated;
            });
          } else if (payload.eventType === "DELETE") {
            const deleted = payload.old as ChatPollVote;
            if (deleted.message_id) {
              setPollVotesMap((prev) => {
                const existing = prev.get(deleted.message_id) ?? [];
                const updated = new Map(prev);
                updated.set(
                  deleted.message_id,
                  existing.filter((v) => v.id !== deleted.id)
                );
                return updated;
              });
            }
          }
        }
      )
      .subscribe();

    // Channel for form responses
    const responsesChannel = supabase
      .channel(`chat_form_responses:${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_form_responses",
          filter: `chat_group_id=eq.${groupId}`,
        },
        (payload: RealtimePostgresChangesPayload<ChatFormResponse>) => {
          if (payload.eventType === "INSERT") {
            const newResponse = payload.new as ChatFormResponse;
            setFormResponsesMap((prev) => {
              const existing = prev.get(newResponse.message_id) ?? [];
              const updated = new Map(prev);
              updated.set(newResponse.message_id, [...existing, newResponse]);
              return updated;
            });
          }
        }
      )
      .subscribe();

    // Channel for member changes (existing logic)
    const membersChannel = supabase
      .channel(`chat_group_members:${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_group_members",
          filter: `chat_group_id=eq.${groupId}`,
        },
        onMemberChange
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messagesChannel);
      supabase.removeChannel(votesChannel);
      supabase.removeChannel(responsesChannel);
      supabase.removeChannel(membersChannel);
    };
  }, [groupId, supabase, handleMessageChange, setPollVotesMap, setFormResponsesMap, onMemberChange]);
}
