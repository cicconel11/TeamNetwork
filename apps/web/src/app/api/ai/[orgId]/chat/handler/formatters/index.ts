import type { ToolResultMessage } from "@/lib/ai/response-composer";
import {
  formatSuggestMentorsResponse,
  formatDonationAnalyticsResponse,
  formatListAvailableMentorsResponse,
  formatAnnouncementsResponse,
  formatEventsResponse,
  formatDiscussionsResponse,
  formatJobPostingsResponse,
  formatOrgStatsResponse,
  formatMembersResponse,
  formatAlumniResponse,
  formatEnterpriseAlumniResponse,
  formatEnterpriseStatsResponse,
  formatEnterpriseQuotaResponse,
  formatEnterpriseOrgCapacityResponse,
  formatManagedOrgsResponse,
  formatAuditEventsResponse,
  formatDonationsResponse,
  formatParentsResponse,
  formatPhilanthropyEventsResponse,
  formatChatGroupsResponse,
  formatNavigationTargetsResponse,
  formatSearchOrgContentResponse,
  type FormatterOptions,
} from "./reads";
import {
  formatPrepareJobPostingResponse,
  formatPrepareAnnouncementResponse,
  formatPrepareEnterpriseInviteResponse,
  formatRevokeEnterpriseInviteResponse,
  formatPrepareDiscussionThreadResponse,
  formatPrepareDiscussionReplyResponse,
  formatPrepareChatMessageResponse,
  formatPrepareGroupMessageResponse,
  formatPrepareEventResponse,
  formatPrepareEventsBatchResponse,
  formatPrepareUpdateAnnouncementResponse,
  formatPrepareDeleteAnnouncementResponse,
} from "./prepares";
import { formatExtractScheduleFileResponse } from "./schedules";
import { formatSuggestConnectionsResponse } from "./connections";

export function getNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function formatIsoDate(value: unknown): string | null {
  const iso = getNonEmptyString(value);
  return iso ? iso.slice(0, 10) : null;
}

export function formatDisplayRow(row: { name?: unknown; subtitle?: unknown }): string | null {
  const name = getNonEmptyString(row.name);
  if (!name) {
    return null;
  }

  const subtitle = getNonEmptyString(row.subtitle);
  return subtitle ? `${name} - ${subtitle}` : name;
}

export {
  formatSuggestConnectionsResponse,
  CONNECTION_PASS2_TEMPLATE,
  collectPhoneNumberFields,
  hasPendingConnectionDisambiguation,
  looksLikeConnectionDisambiguationReply,
} from "./connections";
export {
  formatSuggestMentorsResponse,
  formatDonationAnalyticsResponse,
  formatListAvailableMentorsResponse,
  formatAnnouncementsResponse,
  formatEventsResponse,
  formatDiscussionsResponse,
  formatJobPostingsResponse,
  formatOrgStatsResponse,
  formatMembersResponse,
  formatAlumniResponse,
  formatEnterpriseAlumniResponse,
  formatEnterpriseStatsResponse,
  formatEnterpriseQuotaResponse,
  formatEnterpriseOrgCapacityResponse,
  formatManagedOrgsResponse,
  formatAuditEventsResponse,
  formatDonationsResponse,
  formatParentsResponse,
  formatPhilanthropyEventsResponse,
  formatChatGroupsResponse,
  formatNavigationTargetsResponse,
  formatSearchOrgContentResponse,
  type DonationResponseOptions,
  type FormatterOptions,
} from "./reads";
export {
  formatPrepareJobPostingResponse,
  formatPrepareAnnouncementResponse,
  formatPrepareEnterpriseInviteResponse,
  formatRevokeEnterpriseInviteResponse,
  formatPrepareDiscussionThreadResponse,
  formatPrepareDiscussionReplyResponse,
  formatPrepareChatMessageResponse,
  formatPrepareGroupMessageResponse,
  formatPrepareEventResponse,
  formatPrepareEventsBatchResponse,
  formatPrepareUpdateAnnouncementResponse,
  formatPrepareDeleteAnnouncementResponse,
  formatRevisedPendingEventResponse,
} from "./prepares";
export { formatExtractScheduleFileResponse } from "./schedules";

export function formatDeterministicToolErrorResponse(
  name: string,
  error: string,
  errorCode?: string | null
): string | null {
  if (name !== "extract_schedule_pdf") {
    if (
      name === "get_enterprise_quota" &&
      (errorCode === "enterprise_billing_role_required" ||
        /enterprise owner or billing admin role/i.test(error))
    ) {
      return "I can’t access enterprise quota or billing details for your role. Enterprise owners and billing admins can view alumni seat limits and billing quotas.";
    }

    return null;
  }

  switch (errorCode) {
    case "attachment_required":
      return "I need an uploaded schedule file before I can import anything. Please attach a PDF or schedule image and try again.";
    case "invalid_attachment_path":
      return "That uploaded schedule file is no longer valid for this session. Please upload it again.";
    case "org_context_failed":
      return "I couldn't load the organization context for that schedule import right now. Please try again.";
    case "attachment_unavailable":
      return "I couldn't load that uploaded schedule file. Please re-upload it and try again.";
    case "image_too_large":
      return "That schedule image is too large to process. Please upload an image under 2MB or use a PDF instead.";
    case "image_timeout":
      return "I wasn't able to extract the schedule from the attached image file because the extraction tool timed out. This can happen with larger or more complex image files. Please re-upload it and I'll try again, or upload a PDF version if you have one.";
    case "image_unreadable":
      return "I couldn't read that schedule image. Try a clearer photo, better lighting, or upload a PDF version of the schedule.";
    case "image_model_misconfigured":
      return "Schedule image extraction is misconfigured in this environment. Set ZAI_IMAGE_MODEL to a Z.AI vision model like glm-5v-turbo and restart the server.";
    case "pdf_timeout":
      return "The attached PDF schedule timed out during extraction. Please try again, or send the event details in text if the PDF keeps failing.";
    case "pdf_unreadable":
      return "I couldn't read that PDF schedule. Try re-exporting the PDF or upload a clear image instead.";
    default:
      break;
  }

  if (error === "Unable to read attached schedule image") {
    return "I couldn't read that schedule image. Try a clearer photo, better lighting, or upload a PDF version of the schedule.";
  }

  if (error === "Schedule image extraction timed out") {
    return "I wasn't able to extract the schedule from the attached image file because the extraction tool timed out. This can happen with larger or more complex image files. Please re-upload it and I'll try again, or upload a PDF version if you have one.";
  }

  if (error === "Schedule PDF extraction timed out") {
    return "The attached PDF schedule timed out during extraction. Please try again, or send the event details in text if the PDF keeps failing.";
  }

  if (
    error ===
    "Schedule image extraction is misconfigured. Set ZAI_IMAGE_MODEL to a Z.AI vision model such as glm-5v-turbo."
  ) {
    return "Schedule image extraction is misconfigured in this environment. Set ZAI_IMAGE_MODEL to a Z.AI vision model like glm-5v-turbo and restart the server.";
  }

  if (error === "Unable to read attached PDF") {
    return "I couldn't read that PDF schedule. Try re-exporting the PDF or upload a clear image instead.";
  }

  return null;
}

const GLOBAL_LOOKUP_TOOL_NAMES = new Set([
  "list_members",
  "list_alumni",
  "list_parents",
  "search_org_content",
]);

function inferLookupQuery(message: string): string | null {
  const trimmed = message.trim().replace(/[?!.\s]+$/g, "");
  const match =
    /\b(?:about|for|on|regarding)\s+["']?([^"']{2,80})["']?$/i.exec(trimmed) ??
    /\b(?:find|search|look\s+up)\s+["']?([^"']{2,80})["']?$/i.exec(trimmed);
  return match?.[1]?.trim() ?? null;
}

function normalizeForLookup(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9@.]+/g, " ").trim();
}

function rowMatchesLookup(row: Record<string, unknown>, query: string): boolean {
  const haystack = normalizeForLookup(
    [
      row.name,
      row.email,
      row.title,
      row.snippet,
      row.relationship,
      row.student_name,
      row.current_company,
      row.current_city,
    ]
      .filter((value): value is string => typeof value === "string")
      .join(" "),
  );
  const tokens = normalizeForLookup(query).split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => haystack.includes(token));
}

function rowsForTool(result: ToolResultMessage, query: string): Array<Record<string, unknown>> {
  if (!Array.isArray(result.data)) {
    return [];
  }
  const rows = result.data.filter(
    (row): row is Record<string, unknown> => row != null && typeof row === "object",
  );
  if (result.name === "search_org_content") {
    return rows;
  }
  return rows.filter((row) => rowMatchesLookup(row, query));
}

function formatLookupPersonRow(row: Record<string, unknown>, fallbackRole: string): string | null {
  const name = getNonEmptyString(row.name) ?? getNonEmptyString(row.title);
  if (!name) {
    return null;
  }
  const email = getNonEmptyString(row.email);
  const role = formatMemberRoleForLookup(row.role) ?? fallbackRole;
  const joinedAt = formatIsoDate(row.created_at);
  const metadata = [
    role,
    email,
    joinedAt ? `joined ${joinedAt}` : null,
  ].filter((value): value is string => Boolean(value));
  return `- **${name}**${metadata.length > 0 ? ` - ${metadata.join(", ")}` : ""}`;
}

function formatMemberRoleForLookup(value: unknown): string | null {
  const role = getNonEmptyString(value);
  if (!role) return null;
  if (role === "active_member") return "active member";
  return role.replace(/_/g, " ");
}

function formatLookupContentRow(row: Record<string, unknown>): string | null {
  const title = getNonEmptyString(row.title);
  if (!title) return null;
  const entityType = getNonEmptyString(row.entity_type)?.replace(/_/g, " ") ?? "content";
  const urlPath = getNonEmptyString(row.url_path);
  const label = urlPath ? `[${title}](${urlPath})` : title;
  const snippet = getNonEmptyString(row.snippet);
  return `- ${label} (${entityType})${snippet ? `\n  ${snippet}` : ""}`;
}

export function formatGlobalLookupToolResponse(
  toolResults: ToolResultMessage[],
  message: string,
): string | null {
  if (toolResults.length < 2 || toolResults.some((result) => !GLOBAL_LOOKUP_TOOL_NAMES.has(result.name))) {
    return null;
  }

  const query = inferLookupQuery(message);
  if (!query) {
    return null;
  }

  const byName = new Map(toolResults.map((result) => [result.name, result]));
  const members = byName.get("list_members") ? rowsForTool(byName.get("list_members")!, query) : [];
  const alumni = byName.get("list_alumni") ? rowsForTool(byName.get("list_alumni")!, query) : [];
  const parents = byName.get("list_parents") ? rowsForTool(byName.get("list_parents")!, query) : [];
  const content = byName.get("search_org_content")
    ? rowsForTool(byName.get("search_org_content")!, query)
    : [];

  const lines = [`Here's what I found for ${query}:`];
  let matched = false;

  const memberLines = members
    .map((row) => formatLookupPersonRow(row, "active member"))
    .filter((line): line is string => Boolean(line));
  if (memberLines.length > 0) {
    matched = true;
    lines.push("", "**Active Members:**", ...memberLines);
  }

  const alumniLines = alumni
    .map((row) => formatLookupPersonRow(row, "alumni"))
    .filter((line): line is string => Boolean(line));
  if (alumniLines.length > 0) {
    matched = true;
    lines.push("", "**Alumni:**", ...alumniLines);
  }

  const parentLines = parents
    .map((row) => formatLookupPersonRow(row, "parent"))
    .filter((line): line is string => Boolean(line));
  if (parentLines.length > 0) {
    matched = true;
    lines.push("", "**Parents:**", ...parentLines);
  }

  const contentLines = content
    .map(formatLookupContentRow)
    .filter((line): line is string => Boolean(line));
  if (contentLines.length > 0) {
    matched = true;
    lines.push("", "**Organization Content:**", ...contentLines);
  }

  if (!matched) {
    lines.push("", "No matches found in active members, alumni, parents, or organization content.");
  } else {
    const missing = [
      memberLines.length === 0 ? "active members" : null,
      alumniLines.length === 0 ? "alumni" : null,
      parentLines.length === 0 ? "parents" : null,
      contentLines.length === 0 ? "organization content" : null,
    ].filter((value): value is string => Boolean(value));
    if (missing.length > 0) {
      lines.push("", `No matches found in ${missing.join(", ")}.`);
    }
  }

  return lines.join("\n");
}

export function formatDeterministicToolResponse(
  name: string,
  data: unknown,
  options?: FormatterOptions,
): string | null {
  switch (name) {
    case "suggest_connections":
      return formatSuggestConnectionsResponse(data);
    case "suggest_mentors":
      return formatSuggestMentorsResponse(data);
    case "list_available_mentors":
      return formatListAvailableMentorsResponse(data);
    case "list_events":
      return formatEventsResponse(data);
    case "list_announcements":
      return formatAnnouncementsResponse(data);
    case "list_chat_groups":
      return formatChatGroupsResponse(data, options);
    case "list_discussions":
      return formatDiscussionsResponse(data);
    case "list_job_postings":
      return formatJobPostingsResponse(data);
    case "prepare_announcement":
      return formatPrepareAnnouncementResponse(data);
    case "prepare_update_announcement":
      return formatPrepareUpdateAnnouncementResponse(data);
    case "prepare_delete_announcement":
      return formatPrepareDeleteAnnouncementResponse(data);
    case "prepare_job_posting":
      return formatPrepareJobPostingResponse(data);
    case "prepare_chat_message":
      return formatPrepareChatMessageResponse(data);
    case "prepare_group_message":
      return formatPrepareGroupMessageResponse(data);
    case "prepare_discussion_reply":
      return formatPrepareDiscussionReplyResponse(data);
    case "prepare_discussion_thread":
      return formatPrepareDiscussionThreadResponse(data);
    case "prepare_event":
      return formatPrepareEventResponse(data);
    case "prepare_events_batch":
      return formatPrepareEventsBatchResponse(data);
    case "extract_schedule_pdf":
      return formatExtractScheduleFileResponse(data);
    case "get_org_stats":
      return formatOrgStatsResponse(data);
    case "get_donation_analytics":
      return formatDonationAnalyticsResponse(data);
    case "get_enterprise_stats":
      return formatEnterpriseStatsResponse(data);
    case "get_enterprise_quota":
      return formatEnterpriseQuotaResponse(data);
    case "get_enterprise_org_capacity":
      return formatEnterpriseOrgCapacityResponse(data);
    case "list_members":
      return formatMembersResponse(data);
    case "list_alumni":
      return formatAlumniResponse(data);
    case "list_enterprise_alumni":
      return formatEnterpriseAlumniResponse(data);
    case "list_donations":
      return formatDonationsResponse(data, options);
    case "list_managed_orgs":
      return formatManagedOrgsResponse(data);
    case "list_enterprise_audit_events":
      return formatAuditEventsResponse(data);
    case "prepare_enterprise_invite":
      return formatPrepareEnterpriseInviteResponse(data);
    case "revoke_enterprise_invite":
      return formatRevokeEnterpriseInviteResponse(data);
    case "list_parents":
      return formatParentsResponse(data);
    case "list_philanthropy_events":
      return formatPhilanthropyEventsResponse(data);
    case "find_navigation_targets":
      return formatNavigationTargetsResponse(data);
    case "search_org_content":
      return formatSearchOrgContentResponse(data);
    default:
      return null;
  }
}
