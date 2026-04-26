import type OpenAI from "openai";
import {
  AI_TOOL_MAP,
  type ToolName,
} from "@/lib/ai/tools/definitions";
import {
  extractCurrentDiscussionThreadRouteId,
  extractCurrentMemberRouteId,
  getCurrentPathFeatureSegment,
} from "@/lib/ai/route-entity";
import type { CacheSurface } from "@/lib/ai/semantic-cache-utils";
import type { TurnExecutionPolicy } from "@/lib/ai/turn-execution-policy";
import { getEnterprisePermissions, type EnterpriseRole } from "@/types/enterprise";
import {
  SCHEDULE_ATTACHMENT_MIME_TYPES,
  type ChatAttachment,
} from "./shared";

export const PASS1_TOOL_NAMES: Record<CacheSurface, ToolName[]> = {
  general: [
    "list_members",
    "list_events",
    "list_announcements",
    "list_discussions",
    "list_job_postings",
    "list_alumni",
    "list_parents",
    "list_philanthropy_events",
    "list_donations",
    "get_org_stats",
    "suggest_connections",
    "list_available_mentors",
    "suggest_mentors",
  ],
  members: [
    "list_members",
    "list_alumni",
    "list_parents",
    "get_org_stats",
    "suggest_connections",
    "list_available_mentors",
    "suggest_mentors",
  ],
  analytics: ["get_org_stats"],
  events: ["list_events"],
};

export const CONNECTION_PROMPT_PATTERN =
  /(?<!\w)(?:connection|connections|connect|networking|introduc(?:e|tion))(?!\w)/i;
export const MENTOR_PROMPT_PATTERN =
  /(?<!\w)(?:mentor|mentors|mentee|mentees|pair\s+with|match\s+(?:me|us|them)\s+with)(?!\w)/i;
export const MENTOR_AVAILABILITY_PROMPT_PATTERN =
  /\b(?:available|availability|accepting(?:\s+new)?|open(?:\s+spots?)?|capacity|room\s+for\s+more)\b/i;
export const DIRECT_NAVIGATION_PROMPT_PATTERN =
  /(?:(?<!\w)(?:go\s+to|take\s+me\s+to|navigate\s+to|open|where\s+is|where\s+(?:can|do)\s+i\s+find|find\s+the\s+page|link\s+to)(?!\w)|(?<!\w)show\s+me\b[\s\S]{0,80}\b(?:page|screen|tab|settings?)\b)/i;
export const CREATE_ANNOUNCEMENT_PROMPT_PATTERN =
  /(?:(?<!\w)(?:create|add|post|publish|make|send|draft|write|compose)(?!\w)[\s\S]{0,120}\b(?:announcement|update|news post|bulletin)(?!\w)|(?<!\w)(?:announcement|update|news post|bulletin)(?!\w)[\s\S]{0,80}\b(?:create|add|post|publish|make|send|draft|write|compose)(?!\w))/i;
export const CREATE_JOB_PROMPT_PATTERN =
  /(?:(?<!\w)(?:create|add|post|publish|make|open)(?!\w)[\s\S]{0,120}\b(?:job|job posting|opening|role|position)(?!\w)|(?<!\w)(?:job|job posting|opening|role|position)(?!\w)[\s\S]{0,80}\b(?:create|add|post|publish|make|open)(?!\w))/i;
export const SEND_CHAT_MESSAGE_PROMPT_PATTERN =
  /(?:(?<!\w)(?:message|dm|direct\s+message|chat\s+message|write\s+to)(?!\w)[\s\S]{0,140}\b(?:someone|somebody|them|him|her|this person|that person|member|[a-z][\w.'-]*(?:\s+[a-z][\w.'-]*){0,3})(?!\w)|(?<!\w)send(?!\w)[\s\S]{0,80}\b(?:a\s+)?(?:dm|direct\s+message|chat\s+message)\b[\s\S]{0,80}\b(?:to|for)\b[\s\S]{0,80}\b(?:someone|somebody|them|him|her|this person|that person|member|[a-z][\w.'-]*(?:\s+[a-z][\w.'-]*){0,3})(?!\w))/i;
export const LIST_CHAT_GROUPS_PROMPT_PATTERN =
  /(?:(?<!\w)(?:list|show|what|which|tell\s+me)(?!\w)[\s\S]{0,80}\b(?:chat groups?|groups?|channels?|group chats?)(?!\w)|(?<!\w)(?:chat groups?|my groups?|channels?|group chats?)(?!\w)[\s\S]{0,60}\b(?:list|show|available|can\s+i\s+message|do\s+i\s+have)(?!\w))/i;
export const SEND_GROUP_CHAT_MESSAGE_PROMPT_PATTERN =
  /(?:(?<!\w)(?:message|write\s+to|send\s+(?:a\s+message\s+)?to|post\s+in)(?!\w)[\s\S]{0,140}\b(?:group|chat group|channel|group chat)\b|(?<!\w)(?:group|chat group|channel|group chat)(?!\w)[\s\S]{0,120}\b(?:message|write\s+to|send\s+(?:a\s+message\s+)?to|post\s+in)\b)/i;
export const CREATE_DISCUSSION_PROMPT_PATTERN =
  /(?:(?<!\w)(?:create|add|post|publish|make|start|open)(?!\w)[\s\S]{0,120}\b(?:discussion|discussion thread|thread|forum thread|chat|group chat|conversation)(?!\w)|(?<!\w)(?:discussion|discussion thread|thread|forum thread|chat|group chat|conversation)(?!\w)[\s\S]{0,80}\b(?:create|add|post|publish|make|start|open)(?!\w))/i;
export const DISCUSSION_REPLY_PROMPT_PATTERN =
  /(?:(?<!\w)(?:reply|respond|answer|comment|draft|write)(?!\w)[\s\S]{0,120}\b(?:discussion reply|reply|response|discussion|thread|post|message|conversation)(?!\w)|(?<!\w)(?:discussion reply|reply|response|discussion|thread|post|message|conversation)(?!\w)[\s\S]{0,80}\b(?:reply|respond|answer|comment|draft|write)(?!\w))/i;
export const CREATE_EVENT_PROMPT_PATTERN =
  /(?:(?<!\w)(?:create|add|schedule|plan|make|organize|set\s+up)(?!\w)[\s\S]{0,120}\b(?:event|calendar event|meeting|fundraiser|social|philanthropy event)(?!\w)|(?<!\w)(?:event|calendar event|meeting|fundraiser|social|philanthropy event)(?!\w)[\s\S]{0,80}\b(?:create|add|schedule|plan|make|organize|set\s+up)(?!\w))/i;
export const EXPLICIT_EVENT_DRAFT_SWITCH_PATTERN =
  /(?:(?<!\w)(?:create|add|schedule|plan|make|set\s+up)(?!\w)[\s\S]{0,80}\b(?:event|calendar event|meeting|fundraiser|social|philanthropy event)(?!\w)|(?<!\w)(?:event|calendar event|meeting|fundraiser|social|philanthropy event)(?!\w)[\s\S]{0,60}\b(?:create|add|schedule|plan|make|set\s+up)(?!\w))/i;
export const MEMBER_COUNT_PROMPT_PATTERN =
  /(?:(?<!\w)(?:how many|count|number of|total|totals|snapshot|stats)(?!\w)[\s\S]{0,80}\b(?:member|members|active members|alumni|parents?|donors?|donations?)\b|(?<!\w)(?:member|members|active members|alumni|parents?|donors?|donations?)(?!\w)[\s\S]{0,40}\b(?:how many|count|number of|total|totals)\b)/i;
export const MEMBER_ROSTER_PROMPT_PATTERN =
  /(?:(?<!\w)(?:tell|give|summarize)(?!\w)[\s\S]{0,80}\b(?:member|members|people|roster|team)\b|(?<!\w)(?:who(?:'s|\s+are)?|recent|new)(?!\w)[\s\S]{0,40}\b(?:member|members|people|roster|team)\b|(?<!\w)member roster(?!\w))/i;
export const SCRAPE_SCHEDULE_PROMPT_PATTERN =
  /(?:scrape|import|extract|pull|get|grab|fetch|load)\b[\s\S]{0,120}\b(?:schedule|events?|calendar)[\s\S]{0,60}(?:from|at|on)\s+(?:https?:\/\/|(?:the\s+)?(?:website|page|url|link|site))/i;
export const PDF_SCHEDULE_PROMPT_PATTERN =
  /(?:extract|import|upload|read|parse|pull)\b[\s\S]{0,120}\b(?:schedule|events?|calendar)[\s\S]{0,60}(?:pdf|file|document|upload)/i;
export const ALUMNI_ROSTER_PROMPT_PATTERN =
  /(?<!\w)(?:alumni|alumnus|alumna|alumnae|graduates?|who\s+graduated|graduation\s+(?:year|class)|class\s+of\b)(?!\w)/i;
export const DONATION_STATS_PROMPT_PATTERN =
  /(?<!\w)(?:donation|donations|fundraising)\s+(?:metric|metrics|stats|statistics|total|totals|summary|overview|revenue|amount)(?!\w)/i;
export const DONATION_ANALYTICS_PROMPT_PATTERN =
  /(?:(?<!\w)(?:donation|donations|fundraising|revenue|donor|donors)(?!\w)[\s\S]{0,120}\b(?:trend|trends|breakdown|performance|average|largest|monthly|weekly|daily|by month|by week|by day|last\s+\d+\s+days?|recent)\b|(?<!\w)(?:trend|trends|breakdown|performance|average|largest|monthly|weekly|daily|by month|by week|by day|last\s+\d+\s+days?|recent)(?!\w)[\s\S]{0,120}\b(?:donation|donations|fundraising|revenue|donor|donors)\b|(?<!\w)(?:donation|donations|fundraising)(?!\w)[\s\S]{0,40}\b(?:metric|metrics|statistics)\b)/i;
export const DONATION_LIST_PROMPT_PATTERN =
  /(?<!\w)(?:donations?|fundraising\s+details|donation\s+history|who\s+donated|list\s+(?:the\s+)?donors?)(?!\w)/i;
export const PARENT_LIST_PROMPT_PATTERN =
  /(?<!\w)(?:parent\s+directory|parent\s+(?:list|roster|contacts)|guardians?|(?:list|show)\s+(?:the\s+)?parents)(?!\w)/i;
export const PHILANTHROPY_EVENTS_PROMPT_PATTERN =
  /(?<!\w)(?:philanthropy\s+events?|service\s+events?|volunteer\s+events?)(?!\w)/i;
export const ENTERPRISE_SCOPE_PROMPT_PATTERN =
  /(?<!\w)(?:enterprise|across all orgs?|across all organizations|managed orgs?|sub[-\s]?orgs?)(?!\w)/i;
export const ENTERPRISE_QUOTA_PROMPT_PATTERN =
  /(?<!\w)(?:quota|capacity|seat|seats|slot|slots|billing|bucket|limit|remaining)(?!\w)/i;
export const ENTERPRISE_SUB_ORG_CAPACITY_PROMPT_PATTERN =
  /(?<!\w)(?:sub[-\s]?orgs?|managed orgs?|managed organizations?|free orgs?|free organizations?)(?!\w)/i;
export const MANAGED_ORGS_PROMPT_PATTERN =
  /(?<!\w)(?:managed orgs?|managed organizations?|sub[-\s]?orgs?|which orgs?|list orgs?|organizations?)(?!\w)/i;
export const ENTERPRISE_AUDIT_PROMPT_PATTERN =
  /(?:who\s+(?:added|adopted|approved|invited|removed|revoked)\b|\baudit\b|\badoption\s+(?:history|requests?|log)\b|\bwhen\s+was\b[\s\S]{0,40}\badopted\b|\bhistory\s+of\s+adoptions?\b)/i;
export const ENTERPRISE_INVITE_CREATE_PROMPT_PATTERN =
  /(?:invite\s+(?:a\s+|an\s+)?(?:new\s+)?(?:admin|member|alumni|active\s+member|user|person)\b[\s\S]{0,80}\b(?:to\s+)?(?:enterprise|org|organization)?|create\s+(?:an?\s+)?enterprise\s+invite|enterprise\s+invite\s+(?:for|to))/i;
export const ENTERPRISE_INVITE_REVOKE_PROMPT_PATTERN =
  /(?:revoke\s+(?:an?\s+|the\s+)?(?:enterprise\s+)?invite|cancel\s+(?:an?\s+|the\s+)?(?:enterprise\s+)?invite|kill\s+(?:an?\s+|the\s+)?(?:enterprise\s+)?invite)/i;
export const HTTPS_URL_PATTERN = /https?:\/\//i;
export const ANNOUNCEMENT_DETAIL_FALLBACK_PATTERN =
  /\b(?:title|body|audience|pin(?:ned)?|notify|notification|all members|active members|alumni|parents|individuals)\b/i;
export const CHAT_MESSAGE_FALLBACK_PATTERN =
  /\b(?:message|dm|direct message|chat message|write to|send to|message this person)\b/i;
export const GROUP_CHAT_MESSAGE_FALLBACK_PATTERN =
  /\b(?:message|write to|send to|post in)\b[\s\S]{0,80}\b(?:group|chat group|channel|group chat)\b/i;
export const DISCUSSION_REPLY_FALLBACK_PATTERN =
  /\b(?:reply|respond|response|comment|answer)\b/i;
export const DIRECT_QUERY_START_PATTERN =
  /^(?:show|tell|list|what|who|when|where|why|how|give|summarize|explain|open|find)\b/i;

export type OrgStatsScope =
  | "members"
  | "alumni"
  | "parents"
  | "events"
  | "donations"
  | "all";

const ORG_STATS_DONATION_PATTERN = /\b(?:donor|donors|donation|donations|fundraising|donated|raised)\b/i;
const ORG_STATS_ALUMNI_PATTERN = /\b(?:alumni|alumnus|alumna|alumnae|graduates?)\b/i;
const ORG_STATS_PARENTS_PATTERN = /\b(?:parents?|guardians?)\b/i;
const ORG_STATS_EVENTS_PATTERN = /\b(?:events?|calendar|meetings?|fundraisers?)\b/i;
const ORG_STATS_MEMBERS_PATTERN = /\b(?:active\s+members?|members?)\b/i;

/**
 * Derive a scope hint for `get_org_stats` from the user's message. Returns
 * "all" when the question is generic (no sub-keyword) so existing kitchen-sink
 * behavior is preserved for "stats"/"snapshot"/"overview" prompts.
 */
export function deriveOrgStatsScope(message: string): OrgStatsScope {
  if (ORG_STATS_DONATION_PATTERN.test(message)) return "donations";
  if (ORG_STATS_ALUMNI_PATTERN.test(message)) return "alumni";
  if (ORG_STATS_PARENTS_PATTERN.test(message)) return "parents";
  if (ORG_STATS_EVENTS_PATTERN.test(message)) return "events";
  if (ORG_STATS_MEMBERS_PATTERN.test(message)) return "members";
  return "all";
}

export type DonationAnalyticsDimension =
  | "trend"
  | "totals"
  | "top_purposes"
  | "status_mix"
  | "all";

const DONATION_DIM_TREND_PATTERN =
  /\b(?:trend|trends|monthly|weekly|daily|by\s+(?:month|week|day)|over\s+time|this\s+month|last\s+month)\b/i;
const DONATION_DIM_PURPOSES_PATTERN =
  /\b(?:purpose|purposes|cause|causes|fund|funds|category|categories)\b/i;
const DONATION_DIM_STATUS_PATTERN =
  /\b(?:status|succeeded|failed|pending|refund|refunded)\b/i;
const DONATION_DIM_TOTALS_PATTERN =
  /\b(?:total|totals|raised|sum|average|largest|biggest|smallest|highest|lowest)\b/i;

/**
 * Derive a dimension hint for `get_donation_analytics`. Returns "all" when no
 * sub-keyword is detected so existing full-payload behavior is preserved.
 */
export function deriveDonationAnalyticsDimension(message: string): DonationAnalyticsDimension {
  if (DONATION_DIM_TREND_PATTERN.test(message)) return "trend";
  if (DONATION_DIM_PURPOSES_PATTERN.test(message)) return "top_purposes";
  if (DONATION_DIM_STATUS_PATTERN.test(message)) return "status_mix";
  if (DONATION_DIM_TOTALS_PATTERN.test(message)) return "totals";
  return "all";
}

/**
 * Pre-bind args for forced single-tool Pass-1 calls so the tool runs with the
 * narrow scope the user actually asked for instead of the model's default
 * empty-object args. Returns undefined when there's nothing to inject.
 */
export function deriveForcedPass1ToolArgs(
  toolName: string,
  message: string,
): Record<string, unknown> | undefined {
  if (toolName === "get_org_stats") {
    const scope = deriveOrgStatsScope(message);
    if (scope === "all") return undefined;
    return { scope };
  }
  if (toolName === "get_donation_analytics") {
    const dimension = deriveDonationAnalyticsDimension(message);
    if (dimension === "all") return undefined;
    return { dimension };
  }
  return undefined;
}

export function looksLikeStructuredJobDraft(message: string): boolean {
  const hasJobContext =
    /\b(job|job posting|opening|role|position|hiring|apply|application)\b/i.test(message);
  const structuredFieldMatches = [
    /\blocation type\b/i,
    /\bexperience level\b/i,
    /\bapplication (?:url|link)\b/i,
    /\bcontact email\b/i,
    /\bdescription\s*:/i,
    /\blink\s*:/i,
    /https?:\/\//i,
  ].filter((pattern) => pattern.test(message)).length;

  return hasJobContext && structuredFieldMatches >= 2 && message.trim().length >= 80;
}

export function getPass1Tools(
  message: string,
  effectiveSurface: CacheSurface,
  toolPolicy: TurnExecutionPolicy["toolPolicy"],
  intentType: TurnExecutionPolicy["intentType"],
  attachment?: ChatAttachment,
  currentPath?: string,
  enterpriseEnabled?: boolean,
  enterpriseRole?: EnterpriseRole,
) {
  if (toolPolicy !== "surface_read_tools") {
    return undefined;
  }

  if (CREATE_ANNOUNCEMENT_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.prepare_announcement];
  }

  if (CREATE_JOB_PROMPT_PATTERN.test(message) || looksLikeStructuredJobDraft(message)) {
    return [AI_TOOL_MAP.prepare_job_posting];
  }

  if (LIST_CHAT_GROUPS_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.list_chat_groups];
  }

  if (SEND_GROUP_CHAT_MESSAGE_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.prepare_group_message];
  }

  if (SEND_CHAT_MESSAGE_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.prepare_chat_message];
  }

  if (DISCUSSION_REPLY_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.prepare_discussion_reply];
  }

  if (CREATE_DISCUSSION_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.prepare_discussion_thread];
  }

  if (
    PDF_SCHEDULE_PROMPT_PATTERN.test(message) ||
    (attachment?.mimeType && SCHEDULE_ATTACHMENT_MIME_TYPES.has(attachment.mimeType))
  ) {
    return [AI_TOOL_MAP.extract_schedule_pdf];
  }

  if (
    SCRAPE_SCHEDULE_PROMPT_PATTERN.test(message) ||
    (HTTPS_URL_PATTERN.test(message) && CREATE_EVENT_PROMPT_PATTERN.test(message))
  ) {
    return [AI_TOOL_MAP.scrape_schedule_website];
  }

  if (CREATE_EVENT_PROMPT_PATTERN.test(message)) {
    // Detect multi-event intent: "create 3 events", "schedule multiple events", numbered list patterns
    const multiEventPattern = /(?:\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten|multiple|several|a few|some|batch)\s+events?\b|(?:events?.*,.*(?:and|&)\s))/i;
    if (multiEventPattern.test(message)) {
      // Provide both tools — the model can use prepare_events_batch for all
      // events in one call, or call prepare_event multiple times via parallel
      // tool calls. Either path works because the frontend accumulates
      // pending actions. Importantly, we do NOT force tool choice here — the
      // batch schema is too complex for the 15s pass-1 timeout when forced.
      return [AI_TOOL_MAP.prepare_events_batch, AI_TOOL_MAP.prepare_event];
    }
    return [AI_TOOL_MAP.prepare_event];
  }

  if (intentType === "navigation" && DIRECT_NAVIGATION_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.find_navigation_targets];
  }

  const currentFeatureSegment = getCurrentPathFeatureSegment(currentPath);
  const isEnterprisePortal =
    enterpriseEnabled === true && currentPath?.startsWith("/enterprise/") === true;
  const isEnterpriseScopedRequest =
    enterpriseEnabled === true &&
    (isEnterprisePortal || ENTERPRISE_SCOPE_PROMPT_PATTERN.test(message));
  const canManageEnterpriseBilling =
    enterpriseRole != null && getEnterprisePermissions(enterpriseRole).canManageBilling;

  if (isEnterpriseScopedRequest) {
    if (ENTERPRISE_INVITE_REVOKE_PROMPT_PATTERN.test(message)) {
      return [AI_TOOL_MAP.revoke_enterprise_invite];
    }

    if (ENTERPRISE_INVITE_CREATE_PROMPT_PATTERN.test(message)) {
      return [AI_TOOL_MAP.prepare_enterprise_invite];
    }

    if (ENTERPRISE_AUDIT_PROMPT_PATTERN.test(message)) {
      return [AI_TOOL_MAP.list_enterprise_audit_events];
    }

    if (
      currentFeatureSegment === "billing" ||
      ENTERPRISE_QUOTA_PROMPT_PATTERN.test(message)
    ) {
      if (canManageEnterpriseBilling) {
        return [AI_TOOL_MAP.get_enterprise_quota];
      }

      if (ENTERPRISE_SUB_ORG_CAPACITY_PROMPT_PATTERN.test(message)) {
        return [AI_TOOL_MAP.get_enterprise_org_capacity];
      }

      return [AI_TOOL_MAP.get_enterprise_quota];
    }

    if (
      currentFeatureSegment === "organizations" ||
      MANAGED_ORGS_PROMPT_PATTERN.test(message)
    ) {
      return [AI_TOOL_MAP.list_managed_orgs];
    }

    if (
      currentFeatureSegment === "alumni" ||
      ALUMNI_ROSTER_PROMPT_PATTERN.test(message)
    ) {
      if (MEMBER_COUNT_PROMPT_PATTERN.test(message)) {
        return [AI_TOOL_MAP.get_enterprise_stats];
      }

      return [AI_TOOL_MAP.list_enterprise_alumni];
    }
  }

  if (effectiveSurface === "members" && MENTOR_PROMPT_PATTERN.test(message)) {
    if (MENTOR_AVAILABILITY_PROMPT_PATTERN.test(message)) {
      return [AI_TOOL_MAP.list_available_mentors];
    }
    return [AI_TOOL_MAP.suggest_mentors];
  }

  if (effectiveSurface === "members" && CONNECTION_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.suggest_connections];
  }

  if (ALUMNI_ROSTER_PROMPT_PATTERN.test(message) && !MEMBER_COUNT_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.list_alumni];
  }

  if (PARENT_LIST_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.list_parents];
  }

  if (PHILANTHROPY_EVENTS_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.list_philanthropy_events];
  }

  if (DONATION_ANALYTICS_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.get_donation_analytics];
  }

  if (
    DONATION_LIST_PROMPT_PATTERN.test(message) &&
    !MEMBER_COUNT_PROMPT_PATTERN.test(message) &&
    !DONATION_STATS_PROMPT_PATTERN.test(message)
  ) {
    return [AI_TOOL_MAP.list_donations];
  }

  if (effectiveSurface === "members") {
    if (MEMBER_COUNT_PROMPT_PATTERN.test(message)) {
      return [AI_TOOL_MAP.get_org_stats];
    }

    if (MEMBER_ROSTER_PROMPT_PATTERN.test(message)) {
      return [AI_TOOL_MAP.list_members];
    }
  }

  if (
    currentFeatureSegment === "announcements" &&
    ANNOUNCEMENT_DETAIL_FALLBACK_PATTERN.test(message) &&
    !DIRECT_QUERY_START_PATTERN.test(message.trim()) &&
    !message.trim().endsWith("?")
  ) {
    return [AI_TOOL_MAP.prepare_announcement];
  }

  if (
    extractCurrentMemberRouteId(currentPath) &&
    CHAT_MESSAGE_FALLBACK_PATTERN.test(message) &&
    !DIRECT_QUERY_START_PATTERN.test(message.trim()) &&
    !message.trim().endsWith("?")
  ) {
    return [AI_TOOL_MAP.prepare_chat_message];
  }

  if (
    currentFeatureSegment === "messages" &&
    GROUP_CHAT_MESSAGE_FALLBACK_PATTERN.test(message) &&
    !DIRECT_QUERY_START_PATTERN.test(message.trim()) &&
    !message.trim().endsWith("?")
  ) {
    return [AI_TOOL_MAP.prepare_group_message];
  }

  if (
    extractCurrentDiscussionThreadRouteId(currentPath) &&
    DISCUSSION_REPLY_FALLBACK_PATTERN.test(message) &&
    !DIRECT_QUERY_START_PATTERN.test(message.trim()) &&
    !message.trim().endsWith("?")
  ) {
    return [AI_TOOL_MAP.prepare_discussion_reply];
  }

  return PASS1_TOOL_NAMES[effectiveSurface].map((toolName) => AI_TOOL_MAP[toolName]);
}

export function getForcedPass1ToolChoice(
  pass1Tools: ReturnType<typeof getPass1Tools>
): OpenAI.Chat.ChatCompletionToolChoiceOption | undefined {
  if (!pass1Tools || pass1Tools.length !== 1) {
    return undefined;
  }

  const forcedToolName = pass1Tools[0]?.function.name;
  if (
    forcedToolName !== "prepare_announcement" &&
    forcedToolName !== "prepare_job_posting" &&
    forcedToolName !== "prepare_chat_message" &&
    forcedToolName !== "list_chat_groups" &&
    forcedToolName !== "prepare_group_message" &&
    forcedToolName !== "prepare_discussion_reply" &&
    forcedToolName !== "prepare_discussion_thread" &&
    forcedToolName !== "prepare_event" &&
    forcedToolName !== "list_members" &&
    forcedToolName !== "get_org_stats" &&
    forcedToolName !== "get_donation_analytics" &&
    forcedToolName !== "get_enterprise_stats" &&
    forcedToolName !== "get_enterprise_quota" &&
    forcedToolName !== "get_enterprise_org_capacity" &&
    forcedToolName !== "list_events" &&
    forcedToolName !== "list_alumni" &&
    forcedToolName !== "list_enterprise_alumni" &&
    forcedToolName !== "list_donations" &&
    forcedToolName !== "list_managed_orgs" &&
    forcedToolName !== "list_enterprise_audit_events" &&
    forcedToolName !== "prepare_enterprise_invite" &&
    forcedToolName !== "revoke_enterprise_invite" &&
    forcedToolName !== "list_parents" &&
    forcedToolName !== "list_philanthropy_events" &&
    forcedToolName !== "scrape_schedule_website" &&
    forcedToolName !== "extract_schedule_pdf"
  ) {
    return undefined;
  }

  return {
    type: "function",
    function: {
      name: forcedToolName,
    },
  };
}

/**
 * Tools whose forced single-tool Pass-1 turn can be safely bypassed: args are
 * either zero (lister tools) or fully derivable from the user message via
 * `deriveForcedPass1ToolArgs`. Must be a subset of `getForcedPass1ToolChoice`'s
 * allowlist (test enforces).
 */
export const BYPASS_ELIGIBLE_TOOLS: ReadonlyArray<ToolName> = [
  "get_org_stats",
  "get_donation_analytics",
  "list_members",
  "list_events",
  "list_alumni",
  "list_parents",
  "list_donations",
  "list_philanthropy_events",
  "list_chat_groups",
];

export interface CanBypassPass1Input {
  pass1Tools: ReadonlyArray<OpenAI.Chat.ChatCompletionTool> | undefined;
  pass1ToolChoice: OpenAI.Chat.ChatCompletionToolChoiceOption | undefined;
  activeDraftSession: unknown | null;
  pendingEventRevisionAnalysis: { kind: string } | null | undefined;
  pendingConnectionDisambiguation: boolean;
  attachment: ChatAttachment | null | undefined;
  executionPolicy: { toolPolicy: TurnExecutionPolicy["toolPolicy"] };
}

/**
 * Decide whether the forced single-tool Pass-1 round-trip can be replaced
 * with an in-process synthetic tool call. Returns false on any suppressor.
 */
export function canBypassPass1(input: CanBypassPass1Input): boolean {
  if (!input.pass1Tools || input.pass1Tools.length !== 1) return false;
  if (input.pass1ToolChoice == null) return false;
  if (input.executionPolicy.toolPolicy !== "surface_read_tools") return false;
  if (input.activeDraftSession != null) return false;
  // Pending-event revision branch handles its own SSE/tool flow; never bypass
  // when an analysis other than "none" is in flight.
  if (
    input.pendingEventRevisionAnalysis != null &&
    input.pendingEventRevisionAnalysis.kind !== "none"
  ) {
    return false;
  }
  if (input.pendingConnectionDisambiguation) return false;
  if (input.attachment != null) return false;

  const firstTool = input.pass1Tools[0];
  if (!firstTool || !("function" in firstTool)) return false;
  const toolName = firstTool.function.name;
  if (!toolName) return false;
  return (BYPASS_ELIGIBLE_TOOLS as ReadonlyArray<string>).includes(toolName);
}

export function isToolFirstEligible(
  pass1Tools: ReturnType<typeof getPass1Tools>
): boolean {
  if (!pass1Tools || pass1Tools.length !== 1) {
    return false;
  }

  const toolName = pass1Tools[0]?.function.name;
  return (
    toolName === "list_members" ||
    toolName === "get_org_stats" ||
    toolName === "get_donation_analytics" ||
    toolName === "find_navigation_targets" ||
    toolName === "list_announcements" ||
    toolName === "list_chat_groups" ||
    toolName === "list_events" ||
    toolName === "list_discussions" ||
    toolName === "list_job_postings" ||
    toolName === "list_alumni" ||
    toolName === "list_enterprise_alumni" ||
    toolName === "list_donations" ||
    toolName === "list_managed_orgs" ||
    toolName === "list_enterprise_audit_events" ||
    toolName === "list_parents" ||
    toolName === "list_philanthropy_events" ||
    toolName === "get_enterprise_stats" ||
    toolName === "get_enterprise_quota" ||
    toolName === "get_enterprise_org_capacity" ||
    toolName === "suggest_connections" ||
    toolName === "prepare_group_message"
  );
}
