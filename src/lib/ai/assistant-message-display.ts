export const INTERRUPTED_ASSISTANT_MESSAGE =
  "This response was interrupted. You can retry when you're ready.";
export const FAILED_ASSISTANT_MESSAGE =
  "Something went wrong while generating this response. Please try again.";

const INTERRUPTED_SENTINELS = new Set([
  "[abandoned]",
  "[error]",
  INTERRUPTED_ASSISTANT_MESSAGE,
]);

export interface AssistantDisplayMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string | null;
  status: string;
  created_at: string;
  intent?: string | null;
  context_surface?: string | null;
}

export function finalizeAssistantMessage(input: {
  fullContent: string;
  streamCompletedSuccessfully: boolean;
  requestAborted: boolean;
}): { status: "complete" | "error"; content: string } {
  if (input.streamCompletedSuccessfully) {
    return {
      status: "complete",
      content: input.fullContent,
    };
  }

  return {
    status: "error",
    content: input.requestAborted
      ? INTERRUPTED_ASSISTANT_MESSAGE
      : FAILED_ASSISTANT_MESSAGE,
  };
}

export function normalizeAssistantMessageForDisplay<T extends AssistantDisplayMessage>(
  message: T
): T | (Omit<T, "status" | "content"> & { status: "interrupted"; content: string }) {
  if (message.role !== "assistant") {
    return message;
  }

  if (
    message.status === "pending" ||
    message.status === "streaming"
  ) {
    return {
      ...message,
      status: "interrupted",
      content: INTERRUPTED_ASSISTANT_MESSAGE,
    };
  }

  if (
    message.status === "error" &&
    (!message.content || INTERRUPTED_SENTINELS.has(message.content))
  ) {
    return {
      ...message,
      status: "interrupted",
      content: INTERRUPTED_ASSISTANT_MESSAGE,
    };
  }

  return message;
}
