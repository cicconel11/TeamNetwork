import type { AiSurface } from "@/lib/schemas/ai-assistant";
import { AI_TOOL_MAP, type ToolName } from "./tools/definitions";

export interface AssistantCapabilitySnapshot {
  supported: Array<{
    toolName: ToolName;
    description: string;
  }>;
  unsupported: string[];
}

function getFeatureSegment(pathname: string): string {
  return pathname.match(/^\/[^/]+\/([^/?#]+)/)?.[1] ?? "";
}

function summarizeToolDescription(toolName: ToolName): string {
  const description = AI_TOOL_MAP[toolName].function.description.trim();
  const firstSentence = description.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
  return firstSentence ?? description;
}

function capabilitySnapshotForToolNames(
  toolNames: readonly ToolName[],
  unsupported: string[],
): AssistantCapabilitySnapshot {
  return {
    supported: toolNames.map((toolName) => ({
      toolName,
      description: summarizeToolDescription(toolName),
    })),
    unsupported,
  };
}

export function describeAttachedTools(tools: readonly ToolName[] | undefined): string[] {
  if (!tools || tools.length === 0) {
    return ["- No live tools are attached for this turn. Answer from existing context only."];
  }

  return tools.map((toolName) => `- ${summarizeToolDescription(toolName)}`);
}

export function getAssistantCapabilitySnapshot(
  pathname: string,
  surface: AiSurface,
): AssistantCapabilitySnapshot {
  const segment = getFeatureSegment(pathname);

  switch (segment) {
    case "announcements":
      return capabilitySnapshotForToolNames(
        ["list_announcements", "prepare_announcement", "find_navigation_targets"],
        ["Edit or delete existing announcements"],
      );
    case "jobs":
      return capabilitySnapshotForToolNames(
        ["list_job_postings", "prepare_job_posting", "find_navigation_targets"],
        ["Edit or close existing job postings"],
      );
    case "discussions":
    case "messages":
    case "chat":
      return capabilitySnapshotForToolNames(
        [
          "list_chat_groups",
          "list_discussions",
          "prepare_chat_message",
          "prepare_group_message",
          "prepare_discussion_thread",
          "prepare_discussion_reply",
          "find_navigation_targets",
        ],
        ["Lock threads or moderate replies"],
      );
    case "forms":
      return capabilitySnapshotForToolNames(
        ["find_navigation_targets"],
        ["Create or edit forms from chat"],
      );
    case "events":
    case "calendar":
      return capabilitySnapshotForToolNames(
        [
          "list_events",
          "prepare_event",
          "prepare_events_batch",
          "extract_schedule_pdf",
          "scrape_schedule_website",
          "find_navigation_targets",
        ],
        ["Edit or delete existing calendar events"],
      );
    case "philanthropy":
    case "donations":
    case "expenses":
    case "analytics":
      return capabilitySnapshotForToolNames(
        ["get_org_stats", "list_donations", "list_philanthropy_events", "find_navigation_targets"],
        ["Export analytics or change financial settings"],
      );
  }

  switch (surface) {
    case "members":
      return capabilitySnapshotForToolNames(
        [
          "list_members",
          "list_alumni",
          "list_parents",
          "list_chat_groups",
          "prepare_chat_message",
          "prepare_group_message",
          "suggest_connections",
          "get_org_stats",
          "find_navigation_targets",
        ],
        ["Change member roles or send invites"],
      );
    case "events":
      return capabilitySnapshotForToolNames(
        [
          "list_events",
          "prepare_event",
          "prepare_events_batch",
          "extract_schedule_pdf",
          "scrape_schedule_website",
        ],
        ["Edit or delete existing calendar events"],
      );
    case "analytics":
      return capabilitySnapshotForToolNames(
        ["get_org_stats", "list_donations", "list_philanthropy_events"],
        ["Export analytics or change financial settings"],
      );
    default:
      return capabilitySnapshotForToolNames(
        [
          "list_announcements",
          "list_chat_groups",
          "list_discussions",
          "list_job_postings",
          "prepare_announcement",
          "prepare_chat_message",
          "prepare_group_message",
          "prepare_job_posting",
          "prepare_discussion_reply",
          "prepare_discussion_thread",
          "prepare_event",
          "find_navigation_targets",
        ],
        ["Create or edit forms from chat", "Change member roles or send invites"],
      );
  }
}
