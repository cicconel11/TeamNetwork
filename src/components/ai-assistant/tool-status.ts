import type { SSEEvent } from "@/lib/ai/sse";

type ToolStatusEvent = Extract<SSEEvent, { type: "tool_status" }>;

export function formatToolStatusLabel(toolName: string): string {
  switch (toolName) {
    case "list_members":
      return "Looking up members...";
    case "list_events":
      return "Looking up events...";
    case "list_announcements":
      return "Looking up announcements...";
    case "list_chat_groups":
      return "Looking up chat groups...";
    case "list_discussions":
      return "Looking up discussions...";
    case "list_job_postings":
      return "Looking up job postings...";
    case "prepare_announcement":
      return "Preparing announcement...";
    case "prepare_job_posting":
      return "Preparing job posting...";
    case "prepare_chat_message":
      return "Preparing chat message...";
    case "prepare_group_message":
      return "Preparing group message...";
    case "prepare_discussion_reply":
      return "Preparing discussion reply...";
    case "prepare_discussion_thread":
      return "Preparing discussion thread...";
    case "get_org_stats":
      return "Checking organization stats...";
    case "suggest_connections":
      return "Finding connections...";
    case "find_navigation_targets":
      return "Finding the right page...";
    default:
      return "Working...";
  }
}

export function deriveToolStatusLabel(
  currentLabel: string | null,
  event: ToolStatusEvent
): string | null {
  if (event.status !== "calling") {
    return currentLabel;
  }

  return formatToolStatusLabel(event.toolName);
}
