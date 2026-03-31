"use client";

import { UserContent } from "@/components/i18n/UserContent";
import type { ChatMessage, ChatPollVote, ChatFormResponse, User } from "@/types/database";
import { PollMessage } from "./PollMessage";
import { InlineFormMessage } from "./InlineFormMessage";

interface MessageBodyProps {
  message: ChatMessage;
  currentUserId: string;
  votes?: ChatPollVote[];
  userMap: Map<string, User>;
  ownFormResponse?: ChatFormResponse | null;
  responseCount?: number;
  onVote?: (messageId: string, optionIndex: number) => void;
  onRetractVote?: (messageId: string) => void;
  onFormSubmit?: (
    messageId: string,
    responses: Record<string, string>
  ) => Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string } | void;
}

export function MessageBody({
  message,
  currentUserId,
  votes = [],
  userMap,
  ownFormResponse,
  responseCount,
  onVote,
  onRetractVote,
  onFormSubmit,
}: MessageBodyProps) {
  if (message.message_type === "poll") {
    return (
      <PollMessage
        message={message}
        currentUserId={currentUserId}
        votes={votes}
        userMap={userMap}
        onVote={onVote}
        onRetractVote={onRetractVote}
      />
    );
  }

  if (message.message_type === "form") {
    return (
      <InlineFormMessage
        message={message}
        currentUserId={currentUserId}
        ownResponse={ownFormResponse}
        responseCount={responseCount}
        onSubmit={onFormSubmit}
      />
    );
  }

  return (
    <UserContent as="p" className="whitespace-pre-wrap break-words">
      {message.body}
    </UserContent>
  );
}
