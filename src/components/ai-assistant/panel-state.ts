export interface AIPanelThread {
  id: string;
  title: string | null;
  surface: string;
  updated_at: string;
}

export interface AIPanelMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string | null;
  status: string;
  created_at: string;
  optimistic?: boolean;
}

export interface PendingActionSummary {
  title: string;
  description: string;
}

export interface PendingActionState {
  actionId: string;
  actionType: string;
  summary: PendingActionSummary;
  payload: Record<string, unknown>;
  expiresAt: string;
}

export interface RetryRequestIdentity {
  content: string;
  threadId: string | null;
  key: string;
}

export function createOptimisticUserMessage(
  content: string,
  now = new Date().toISOString(),
  id = `optimistic-${now}`
): AIPanelMessage {
  return {
    id,
    role: "user",
    content,
    status: "complete",
    created_at: now,
    optimistic: true,
  };
}

export function removePanelMessage(
  messages: AIPanelMessage[],
  messageId: string
): AIPanelMessage[] {
  return messages.filter((message) => message.id !== messageId);
}

export function resolveRetryRequestIdentity(
  previous: RetryRequestIdentity | null,
  content: string,
  threadId: string | null,
  createKey: () => string
): RetryRequestIdentity {
  if (
    previous &&
    previous.content === content &&
    previous.threadId === threadId
  ) {
    return previous;
  }

  return {
    content,
    threadId,
    key: createKey(),
  };
}

export function applyThreadDeletion(
  threads: AIPanelThread[],
  activeThreadId: string | null,
  messages: AIPanelMessage[],
  deletedThreadId: string
) {
  return {
    threads: threads.filter((thread) => thread.id !== deletedThreadId),
    activeThreadId: activeThreadId === deletedThreadId ? null : activeThreadId,
    messages: activeThreadId === deletedThreadId ? [] : messages,
  };
}
