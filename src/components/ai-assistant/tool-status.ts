import type { SSEEvent } from "@/lib/ai/sse";

type ToolStatusEvent = Extract<SSEEvent, { type: "tool_status" }>;

export function formatToolStatusLabel(toolName: string): string {
  switch (toolName) {
    case "list_members":
      return "Looking up members...";
    case "list_events":
      return "Looking up events...";
    case "get_org_stats":
      return "Checking organization stats...";
    case "suggest_connections":
      return "Finding connections...";
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
