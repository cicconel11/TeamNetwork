/* eslint-disable @typescript-eslint/no-explicit-any */
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

export async function resolveHideDonorNamesPreference(
  serviceSupabase: { from: (table: string) => any },
  orgId: string,
): Promise<boolean> {
  try {
    const { data, error } = await serviceSupabase
      .from("organizations")
      .select("hide_donor_names")
      .eq("id", orgId)
      .maybeSingle();

    if (error) {
      return true;
    }

    return Boolean((data as { hide_donor_names?: unknown } | null)?.hide_donor_names);
  } catch {
    return true;
  }
}

export async function resolveOrgSlug(
  serviceSupabase: { from: (table: string) => any },
  orgId: string,
): Promise<string | undefined> {
  try {
    const { data, error } = await serviceSupabase
      .from("organizations")
      .select("slug")
      .eq("id", orgId)
      .maybeSingle();

    if (error) {
      return undefined;
    }

    const slug = (data as { slug?: unknown } | null)?.slug;
    return typeof slug === "string" && slug.trim().length > 0 ? slug : undefined;
  } catch {
    return undefined;
  }
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
    default:
      return null;
  }
}
