import type OpenAI from "openai";
import {
  AI_TOOL_MAP,
  type ToolName,
} from "@/lib/ai/tools/definitions";
import {
  extractCurrentDiscussionThreadRouteId,
  extractCurrentEventRouteId,
  extractCurrentJobPostingRouteId,
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

// Read-only, low-risk tools reachable from every surface so cross-domain
// queries (people search, content search, navigation) resolve from any page.
// Role gating downstream (filterAllowedTools) still applies.
const GLOBAL_READ_TOOL_NAMES: ReadonlyArray<ToolName> = [
  "search_org_content",
  "find_navigation_targets",
  "list_members",
  "list_alumni",
  "list_parents",
];

const RAW_PASS1_TOOL_NAMES: Record<CacheSurface, ToolName[]> = {
  general: [
    "list_members",
    "list_member_preferences",
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
    "list_member_preferences",
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

// Surface-specific tools come first so per-surface biasing is preserved.
// Globals appended and deduped via Set.
export const PASS1_TOOL_NAMES: Record<CacheSurface, ToolName[]> = Object.fromEntries(
  Object.entries(RAW_PASS1_TOOL_NAMES).map(([surface, names]) => [
    surface,
    Array.from(new Set<ToolName>([...names, ...GLOBAL_READ_TOOL_NAMES])),
  ]),
) as Record<CacheSurface, ToolName[]>;

export const CONNECTION_PROMPT_PATTERN =
  /(?<!\w)(?:connection|connections|connect|networking|introduc(?:e|tion))(?!\w)/i;
export const MENTOR_PROMPT_PATTERN =
  /(?<!\w)(?:mentor|mentors|mentee|mentees|pair\s+with|match\s+(?:me|us|them)\s+with)(?!\w)/i;
export const MENTOR_AVAILABILITY_PROMPT_PATTERN =
  /\b(?:available|availability|accepting(?:\s+new)?|open(?:\s+spots?)?|capacity|room\s+for\s+more)\b/i;
// Sport/interest/personal-availability questions about regular members (not mentor capacity).
// Matches "who plays tennis", "members interested in fundraising", "anyone free Tuesday evening",
// "find members who like X". Intentionally broad on the noun side so it picks up casual phrasings.
export const MEMBER_INTEREST_PROMPT_PATTERN =
  /(?:\b(?:who|which|any|find|list|show|tell)\b[\s\S]{0,40}\b(?:plays?|play|playing|interested\s+in|likes?|enjoys?|does|practices?)\b|\binterest(?:s|ed)?\b|\bhobby\b|\bhobbies\b|\b(?:tennis|soccer|football|basketball|baseball|golf|hockey|swim(?:ming)?|run(?:ning)?|cycling|lacrosse|volleyball|rugby|cricket|track|cross[-\s]?country|crew|rowing|wrestling|gymnastics|skiing|snowboarding|climbing)\b)/i;
export const MEMBER_AVAILABILITY_PROMPT_PATTERN =
  /(?:\b(?:who|which|anyone|anybody)\b[\s\S]{0,40}\b(?:free|available|around|open)\b|\bavailability\b[\s\S]{0,40}\b(?:overlap|match|share|same)\b|\b(?:free|available)\b[\s\S]{0,40}\b(?:tuesday|monday|wednesday|thursday|friday|saturday|sunday|weekday|weekend|morning|afternoon|evening|night|lunch|am|pm)\b|\b(?:overlap|matches?)\b[\s\S]{0,40}\bschedule\b)/i;
export const DIRECT_NAVIGATION_PROMPT_PATTERN =
  /(?:(?<!\w)(?:go\s+to|take\s+me\s+to|navigate\s+to|open|where\s+is|where\s+(?:can|do)\s+i\s+find|find\s+the\s+page|link\s+to)(?!\w)|(?<!\w)show\s+me\b[\s\S]{0,80}\b(?:page|screen|tab|settings?)\b)/i;
export const CONTENT_SEARCH_PROMPT_PATTERN =
  /(?:(?<!\w)(?:find|search|look\s+up)(?!\w)[\s\S]{0,140}\b(?:announcements?|events?|discussions?|threads?|jobs?|posts?|content)\b|(?<!\w)(?:announcements?|events?|discussions?|threads?|jobs?|posts?|content)(?!\w)[\s\S]{0,140}\b(?:mentioning|about|regarding)\b)/i;
export const CREATE_ANNOUNCEMENT_PROMPT_PATTERN =
  /(?:(?<!\w)(?:create|add|post|publish|make|send|draft|write|compose)(?!\w)[\s\S]{0,120}\b(?:announcements?|updates?|news posts?|bulletins?)(?!\w)|(?<!\w)(?:announcements?|updates?|news posts?|bulletins?)(?!\w)[\s\S]{0,80}\b(?:create|add|post|publish|make|send|draft|write|compose)(?!\w))/i;
export const CREATE_JOB_PROMPT_PATTERN =
  /(?:(?<!\w)(?:create|add|post|publish|make|open)(?!\w)[\s\S]{0,120}\b(?:jobs?|job postings?|openings?|roles?|positions?)(?!\w)|(?<!\w)(?:jobs?|job postings?|openings?|roles?|positions?)(?!\w)[\s\S]{0,80}\b(?:create|add|post|publish|make|open)(?!\w))/i;
export const UPDATE_JOB_PROMPT_PATTERN =
  /(?:(?<!\w)(?:edit|update|change|revise|close|deactivate|reactivate)(?!\w)[\s\S]{0,120}\b(?:jobs?|job postings?|postings?|listings?|openings?)(?!\w)|(?<!\w)(?:jobs?|job postings?|postings?|listings?|openings?)(?!\w)[\s\S]{0,80}\b(?:edit|update|change|revise|close|deactivate|reactivate)(?!\w))/i;
export const DELETE_JOB_PROMPT_PATTERN =
  /(?:(?<!\w)(?:delete|remove|take\s+down)(?!\w)[\s\S]{0,120}\b(?:jobs?|job postings?|postings?|listings?|openings?)(?!\w)|(?<!\w)(?:jobs?|job postings?|postings?|listings?|openings?)(?!\w)[\s\S]{0,80}\b(?:delete|remove|take\s+down)(?!\w))/i;
export const UPDATE_CURRENT_JOB_PROMPT_PATTERN =
  /(?<!\w)(?:edit|update|change|revise|close|deactivate|reactivate)(?!\w)[\s\S]{0,80}\b(?:this|it|this\s+(?:posting|listing|opening))(?!\w)/i;
export const DELETE_CURRENT_JOB_PROMPT_PATTERN =
  /(?<!\w)(?:delete|remove|take\s+down)(?!\w)[\s\S]{0,80}\b(?:this|it|this\s+(?:posting|listing|opening))(?!\w)/i;
export const SEND_CHAT_MESSAGE_PROMPT_PATTERN =
  /(?:(?<!\w)(?:message|dm|direct\s+message|chat\s+message|write\s+to)(?!\w)[\s\S]{0,140}\b(?:someone|somebody|them|him|her|this person|that person|member|[a-z][\w.'-]*(?:\s+[a-z][\w.'-]*){0,3})(?!\w)|(?<!\w)send(?!\w)[\s\S]{0,80}\b(?:a\s+)?(?:dm|direct\s+message|chat\s+message)\b[\s\S]{0,80}\b(?:to|for)\b[\s\S]{0,80}\b(?:someone|somebody|them|him|her|this person|that person|member|[a-z][\w.'-]*(?:\s+[a-z][\w.'-]*){0,3})(?!\w))/i;
export const LIST_CHAT_GROUPS_PROMPT_PATTERN =
  /(?:(?<!\w)(?:list|show|what|which|tell\s+me)(?!\w)[\s\S]{0,80}\b(?:chat groups?|groups?|channels?|group chats?)(?!\w)|(?<!\w)(?:chat groups?|my groups?|channels?|group chats?)(?!\w)[\s\S]{0,60}\b(?:list|show|available|can\s+i\s+message|do\s+i\s+have)(?!\w))/i;
export const SEND_GROUP_CHAT_MESSAGE_PROMPT_PATTERN =
  /(?:(?<!\w)(?:message|write\s+to|send\s+(?:a\s+message\s+)?to|post\s+in)(?!\w)[\s\S]{0,140}\b(?:group|chat group|channel|group chat)\b|(?<!\w)(?:group|chat group|channel|group chat)(?!\w)[\s\S]{0,120}\b(?:message|write\s+to|send\s+(?:a\s+message\s+)?to|post\s+in)\b)/i;
export const CREATE_DISCUSSION_PROMPT_PATTERN =
  /(?:(?<!\w)(?:create|add|post|publish|make|start|open)(?!\w)[\s\S]{0,120}\b(?:discussions?|discussion threads?|threads?|forum threads?|chats?|group chats?|conversations?)(?!\w)|(?<!\w)(?:discussions?|discussion threads?|threads?|forum threads?|chats?|group chats?|conversations?)(?!\w)[\s\S]{0,80}\b(?:create|add|post|publish|make|start|open)(?!\w))/i;
export const DISCUSSION_REPLY_PROMPT_PATTERN =
  /(?:(?<!\w)(?:reply|replies|respond|answer|comment|draft|write)(?!\w)[\s\S]{0,120}\b(?:discussion repl(?:y|ies)|repl(?:y|ies)|responses?|discussions?|threads?|posts?|messages?|conversations?)(?!\w)|(?<!\w)(?:discussion repl(?:y|ies)|repl(?:y|ies)|responses?|discussions?|threads?|posts?|messages?|conversations?)(?!\w)[\s\S]{0,80}\b(?:reply|replies|respond|answer|comment|draft|write)(?!\w))/i;
export const CREATE_EVENT_PROMPT_PATTERN =
  /(?:(?<!\w)(?:create|add|schedule|plan|make|organize|set\s+up)(?!\w)[\s\S]{0,120}\b(?:events?|calendar events?|meetings?|fundraisers?|socials?|philanthropy events?|practices?|games?|matches|workouts?|trainings?|rehearsals?|lessons?|sessions?|tournaments?|tryouts?)(?!\w)|(?<!\w)(?:events?|calendar events?|meetings?|fundraisers?|socials?|philanthropy events?|practices?|games?|matches|workouts?|trainings?|rehearsals?|lessons?|sessions?|tournaments?|tryouts?)(?!\w)[\s\S]{0,80}\b(?:create|add|schedule|plan|make|organize|set\s+up)(?!\w))/i;
export const UPDATE_EVENT_PROMPT_PATTERN =
  /(?:(?<!\w)(?:edit|update|change|revise|move|rename|reschedule)(?!\w)[\s\S]{0,120}\b(?:events?|calendar events?|meetings?|fundraisers?|socials?|philanthropy events?|practices?|games?|matches|workouts?|trainings?|rehearsals?|lessons?|sessions?|tournaments?|tryouts?)(?!\w)|(?<!\w)(?:events?|calendar events?|meetings?|fundraisers?|socials?|philanthropy events?|practices?|games?|matches|workouts?|trainings?|rehearsals?|lessons?|sessions?|tournaments?|tryouts?)(?!\w)[\s\S]{0,80}\b(?:edit|update|change|revise|move|rename|reschedule)(?!\w))/i;
export const DELETE_EVENT_PROMPT_PATTERN =
  /(?:(?<!\w)(?:delete|remove|cancel)(?!\w)[\s\S]{0,120}\b(?:events?|calendar events?|meetings?|fundraisers?|socials?|philanthropy events?|practices?|games?|matches|workouts?|trainings?|rehearsals?|lessons?|sessions?|tournaments?|tryouts?)(?!\w)|(?<!\w)(?:events?|calendar events?|meetings?|fundraisers?|socials?|philanthropy events?|practices?|games?|matches|workouts?|trainings?|rehearsals?|lessons?|sessions?|tournaments?|tryouts?)(?!\w)[\s\S]{0,80}\b(?:delete|remove|cancel)(?!\w))/i;
export const UPDATE_CURRENT_EVENT_PROMPT_PATTERN =
  /(?<!\w)(?:edit|update|change|revise|move|rename|reschedule)(?!\w)[\s\S]{0,80}\b(?:this|it|this\s+event)(?!\w)/i;
export const DELETE_CURRENT_EVENT_PROMPT_PATTERN =
  /(?<!\w)(?:delete|remove|cancel)(?!\w)[\s\S]{0,80}\b(?:this|it|this\s+event)(?!\w)/i;
export const EXPLICIT_EVENT_DRAFT_SWITCH_PATTERN =
  /(?:(?<!\w)(?:create|add|schedule|plan|make|set\s+up|edit|update|change|move|rename|reschedule|delete|remove|cancel)(?!\w)[\s\S]{0,80}\b(?:events?|calendar events?|meetings?|fundraisers?|socials?|philanthropy events?|practices?|games?|matches|workouts?|trainings?|rehearsals?|lessons?|sessions?|tournaments?|tryouts?)(?!\w)|(?<!\w)(?:events?|calendar events?|meetings?|fundraisers?|socials?|philanthropy events?|practices?|games?|matches|workouts?|trainings?|rehearsals?|lessons?|sessions?|tournaments?|tryouts?)(?!\w)[\s\S]{0,60}\b(?:create|add|schedule|plan|make|set\s+up|edit|update|change|move|rename|reschedule|delete|remove|cancel)(?!\w))/i;
// Match explicit member-role-change intent. Requires either:
//   (a) a role-change verb followed (within ~80 chars) by `to|as|an?` and a role
//       token, e.g. "promote Jane to alumni", "make John an admin",
//       "change Sarah's role to active member"; or
//   (b) explicit "<role|membership> change/update" phrasing; or
//   (c) "revoke|reactivate <person>'s (access|membership)".
// Intentionally excludes bare "member" + standalone status words ("active",
// "pending") to avoid false positives like "make a member feel welcome" or
// "I want an active role here".
export const MEMBER_ROLE_CHANGE_PROMPT_PATTERN =
  /(?:(?<!\w)(?:make|change|set|promote|demote|update)(?!\w)[\s\S]{0,80}\b(?:to|as|an?|into)\s+(?:an?\s+)?(?:admin|administrator|active[_\s-]?member|alumni|alumnus|alumna|parent|coach|coaches|captain|staff|volunteer)\b|(?<!\w)(?:role|membership|access)\s+(?:change|update|to)\b[\s\S]{0,40}\b(?:admin|administrator|active[_\s-]?member|alumni|parent|coach|captain|staff|volunteer)\b|(?<!\w)(?:revoke|reactivate)\s+(?:[\w'.-]+(?:\s+[\w'.-]+){0,3}(?:'s)?\s+)?(?:access|membership|account|admin\s+rights?|admin\s+role)\b)/i;
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
  /^(?:show|tell|list|what|which|who|when|where|why|how|give|summarize|explain|open|find)\b/i;

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
const SEARCH_QUERY_PREFIX_PATTERN =
  /^(?:find|search|look\s+up|show|get|list)?\s*(?:posts?|content|announcements?|events?|discussions?|jobs?)?\s*(?:mentioning|about|for|on|regarding)?\s+/i;
const NAVIGATION_QUERY_PREFIX_PATTERN =
  /^(?:go\s+to|take\s+me\s+to|navigate\s+to|open|where\s+is|where\s+(?:can|do)\s+i\s+find|find\s+the\s+page(?:\s+for)?|link\s+to|show\s+me)\s+/i;

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

function stripQueryPrefix(message: string, prefixPattern: RegExp): string | undefined {
  const trimmed = message.trim().replace(/[?.!]+$/g, "");
  const stripped = trimmed.replace(prefixPattern, "").trim();
  const query = stripped || trimmed;
  return query.length > 0 ? query : undefined;
}

export function deriveSearchOrgContentQuery(message: string): string | undefined {
  return stripQueryPrefix(message, SEARCH_QUERY_PREFIX_PATTERN);
}

export function deriveNavigationQuery(message: string): string | undefined {
  return stripQueryPrefix(message, NAVIGATION_QUERY_PREFIX_PATTERN);
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
  if (toolName === "search_org_content") {
    const query = deriveSearchOrgContentQuery(message);
    return query ? { query } : undefined;
  }
  if (toolName === "find_navigation_targets") {
    const query = deriveNavigationQuery(message);
    return query ? { query } : undefined;
  }
  return undefined;
}

// Treat a prompt as a structured job draft only when it has job context and
// enough field markers + length that it is clearly a paste-in, not a casual
// "post a job" mention. Tuned to avoid false positives on short prompts.
const MIN_STRUCTURED_JOB_FIELD_HITS = 2;
const MIN_STRUCTURED_JOB_LENGTH = 80;

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

  return (
    hasJobContext &&
    structuredFieldMatches >= MIN_STRUCTURED_JOB_FIELD_HITS &&
    message.trim().length >= MIN_STRUCTURED_JOB_LENGTH
  );
}

// Multi-event intent: "create 3 events", "schedule multiple events", numbered
// list patterns. Lives near its only usage.
const MULTI_EVENT_PROMPT_PATTERN =
  /(?:\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten|multiple|several|a few|some|batch)\s+events?\b|(?:events?.*,.*(?:and|&)\s))/i;

interface RoutingContext {
  message: string;
  trimmedMessage: string;
  isQuestionLike: boolean;
  surface: CacheSurface;
  intentType: TurnExecutionPolicy["intentType"];
  attachment?: ChatAttachment;
  currentEventId: string | null;
  currentJobPostingId: string | null;
  currentMemberId: string | null;
  currentDiscussionThreadId: string | null;
  currentFeatureSegment: string | null;
  isEnterpriseScopedRequest: boolean;
  canManageEnterpriseBilling: boolean;
}

interface RoutingRule {
  id: string;
  when: (ctx: RoutingContext) => boolean;
  tools: (ctx: RoutingContext) => ToolName[];
}

// Guard for fallback rules that should not fire on direct queries/questions
// (e.g. on /members/[id], "who is this member?" must not route to role-change).
function isImperative(ctx: RoutingContext): boolean {
  return !DIRECT_QUERY_START_PATTERN.test(ctx.trimmedMessage) && !ctx.isQuestionLike;
}

// Ordered intent rules. Precedence = array order; first match wins. Each rule
// is self-contained so adding/removing one is a local edit. Rule ids double
// as eval labels when chasing false positives/negatives.
const PASS1_ROUTING_RULES: ReadonlyArray<RoutingRule> = [
  {
    id: "create_announcement",
    when: (ctx) => CREATE_ANNOUNCEMENT_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["prepare_announcement"],
  },
  {
    id: "create_job",
    when: (ctx) =>
      CREATE_JOB_PROMPT_PATTERN.test(ctx.message) || looksLikeStructuredJobDraft(ctx.message),
    tools: () => ["prepare_job_posting"],
  },
  {
    id: "delete_current_event",
    when: (ctx) =>
      ctx.currentEventId != null && DELETE_CURRENT_EVENT_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["prepare_delete_event"],
  },
  {
    id: "update_current_event",
    when: (ctx) =>
      ctx.currentEventId != null && UPDATE_CURRENT_EVENT_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["prepare_update_event"],
  },
  {
    id: "delete_current_job",
    when: (ctx) =>
      ctx.currentJobPostingId != null && DELETE_CURRENT_JOB_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["prepare_delete_job_posting"],
  },
  {
    id: "update_current_job",
    when: (ctx) =>
      ctx.currentJobPostingId != null && UPDATE_CURRENT_JOB_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["prepare_update_job_posting"],
  },
  {
    id: "member_role_change",
    when: (ctx) =>
      MEMBER_ROLE_CHANGE_PROMPT_PATTERN.test(ctx.message) && isImperative(ctx),
    tools: () => ["prepare_member_role_change"],
  },
  {
    id: "delete_job",
    when: (ctx) => DELETE_JOB_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["prepare_delete_job_posting"],
  },
  {
    id: "update_job",
    when: (ctx) => UPDATE_JOB_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["prepare_update_job_posting"],
  },
  {
    id: "list_chat_groups",
    when: (ctx) => LIST_CHAT_GROUPS_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["list_chat_groups"],
  },
  {
    id: "send_group_chat_message",
    when: (ctx) => SEND_GROUP_CHAT_MESSAGE_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["prepare_group_message"],
  },
  {
    id: "send_chat_message",
    when: (ctx) => SEND_CHAT_MESSAGE_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["prepare_chat_message"],
  },
  {
    id: "discussion_reply",
    when: (ctx) => DISCUSSION_REPLY_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["prepare_discussion_reply"],
  },
  {
    id: "create_discussion",
    when: (ctx) => CREATE_DISCUSSION_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["prepare_discussion_thread"],
  },
  {
    id: "schedule_pdf",
    when: (ctx) =>
      PDF_SCHEDULE_PROMPT_PATTERN.test(ctx.message) ||
      (ctx.attachment?.mimeType != null &&
        SCHEDULE_ATTACHMENT_MIME_TYPES.has(ctx.attachment.mimeType)),
    tools: () => ["extract_schedule_pdf"],
  },
  {
    id: "scrape_schedule",
    when: (ctx) =>
      SCRAPE_SCHEDULE_PROMPT_PATTERN.test(ctx.message) ||
      (HTTPS_URL_PATTERN.test(ctx.message) &&
        CREATE_EVENT_PROMPT_PATTERN.test(ctx.message)),
    tools: () => ["scrape_schedule_website"],
  },
  {
    id: "create_event",
    when: (ctx) => CREATE_EVENT_PROMPT_PATTERN.test(ctx.message),
    // Multi-event variant exposes both tools — model can batch via
    // prepare_events_batch or fan out prepare_event calls. We do NOT force
    // tool choice when length > 1 because the batch schema is too complex
    // for the 15s pass-1 timeout when forced.
    tools: (ctx) =>
      MULTI_EVENT_PROMPT_PATTERN.test(ctx.message)
        ? ["prepare_events_batch", "prepare_event"]
        : ["prepare_event"],
  },
  {
    id: "delete_event",
    when: (ctx) => DELETE_EVENT_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["prepare_delete_event"],
  },
  {
    id: "update_event",
    when: (ctx) => UPDATE_EVENT_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["prepare_update_event"],
  },
  {
    id: "navigation",
    when: (ctx) =>
      ctx.intentType === "navigation" && DIRECT_NAVIGATION_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["find_navigation_targets"],
  },
  {
    id: "content_search",
    when: (ctx) => CONTENT_SEARCH_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["search_org_content"],
  },

  // ── Enterprise-scoped rules ────────────────────────────────────────────
  // Each rule gates on `isEnterpriseScopedRequest` so precedence stays flat.
  {
    id: "enterprise_invite_revoke",
    when: (ctx) =>
      ctx.isEnterpriseScopedRequest &&
      ENTERPRISE_INVITE_REVOKE_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["revoke_enterprise_invite"],
  },
  {
    id: "enterprise_invite_create",
    when: (ctx) =>
      ctx.isEnterpriseScopedRequest &&
      ENTERPRISE_INVITE_CREATE_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["prepare_enterprise_invite"],
  },
  {
    id: "enterprise_audit",
    when: (ctx) =>
      ctx.isEnterpriseScopedRequest && ENTERPRISE_AUDIT_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["list_enterprise_audit_events"],
  },
  {
    id: "enterprise_billing_quota",
    when: (ctx) =>
      ctx.isEnterpriseScopedRequest &&
      (ctx.currentFeatureSegment === "billing" ||
        ENTERPRISE_QUOTA_PROMPT_PATTERN.test(ctx.message)),
    tools: (ctx) => {
      if (ctx.canManageEnterpriseBilling) return ["get_enterprise_quota"];
      if (ENTERPRISE_SUB_ORG_CAPACITY_PROMPT_PATTERN.test(ctx.message)) {
        return ["get_enterprise_org_capacity"];
      }
      return ["get_enterprise_quota"];
    },
  },
  {
    id: "enterprise_managed_orgs",
    when: (ctx) =>
      ctx.isEnterpriseScopedRequest &&
      (ctx.currentFeatureSegment === "organizations" ||
        MANAGED_ORGS_PROMPT_PATTERN.test(ctx.message)),
    tools: () => ["list_managed_orgs"],
  },
  {
    id: "enterprise_alumni",
    when: (ctx) =>
      ctx.isEnterpriseScopedRequest &&
      (ctx.currentFeatureSegment === "alumni" ||
        ALUMNI_ROSTER_PROMPT_PATTERN.test(ctx.message)),
    tools: (ctx) =>
      MEMBER_COUNT_PROMPT_PATTERN.test(ctx.message)
        ? ["get_enterprise_stats"]
        : ["list_enterprise_alumni"],
  },

  // Member interest / personal availability (sport, hobby, free-time) — fires
  // on any surface. Routes to list_member_preferences which surfaces mentor
  // profile sports/topics and mentee free-text time_availability.
  {
    id: "member_interest_or_availability",
    when: (ctx) =>
      !MENTOR_PROMPT_PATTERN.test(ctx.message) &&
      (MEMBER_INTEREST_PROMPT_PATTERN.test(ctx.message) ||
        MEMBER_AVAILABILITY_PROMPT_PATTERN.test(ctx.message)),
    tools: () => ["list_member_preferences"],
  },

  // ── Members-surface specials ───────────────────────────────────────────
  {
    id: "mentor_intent",
    when: (ctx) => ctx.surface === "members" && MENTOR_PROMPT_PATTERN.test(ctx.message),
    tools: (ctx) =>
      MENTOR_AVAILABILITY_PROMPT_PATTERN.test(ctx.message)
        ? ["list_available_mentors"]
        : ["suggest_mentors"],
  },
  {
    id: "connection_intent",
    when: (ctx) =>
      ctx.surface === "members" && CONNECTION_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["suggest_connections"],
  },

  // ── Generic readers ────────────────────────────────────────────────────
  {
    id: "alumni_roster",
    when: (ctx) =>
      ALUMNI_ROSTER_PROMPT_PATTERN.test(ctx.message) &&
      !MEMBER_COUNT_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["list_alumni"],
  },
  {
    id: "parent_list",
    when: (ctx) => PARENT_LIST_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["list_parents"],
  },
  {
    id: "philanthropy_events",
    when: (ctx) => PHILANTHROPY_EVENTS_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["list_philanthropy_events"],
  },
  {
    id: "donation_analytics",
    when: (ctx) => DONATION_ANALYTICS_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["get_donation_analytics"],
  },
  {
    id: "donation_list",
    when: (ctx) =>
      DONATION_LIST_PROMPT_PATTERN.test(ctx.message) &&
      !MEMBER_COUNT_PROMPT_PATTERN.test(ctx.message) &&
      !DONATION_STATS_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["list_donations"],
  },
  {
    id: "members_surface_count",
    when: (ctx) =>
      ctx.surface === "members" && MEMBER_COUNT_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["get_org_stats"],
  },
  {
    id: "members_surface_roster",
    when: (ctx) =>
      ctx.surface === "members" && MEMBER_ROSTER_PROMPT_PATTERN.test(ctx.message),
    tools: () => ["list_members"],
  },

  // ── Route-context fallbacks (only fire on imperative phrasing) ─────────
  {
    id: "announcement_detail_fallback",
    when: (ctx) =>
      ctx.currentFeatureSegment === "announcements" &&
      ANNOUNCEMENT_DETAIL_FALLBACK_PATTERN.test(ctx.message) &&
      isImperative(ctx),
    tools: () => ["prepare_announcement"],
  },
  {
    id: "member_route_role_change",
    when: (ctx) =>
      ctx.currentMemberId != null &&
      MEMBER_ROLE_CHANGE_PROMPT_PATTERN.test(ctx.message) &&
      isImperative(ctx),
    tools: () => ["prepare_member_role_change"],
  },
  {
    id: "member_route_chat_fallback",
    when: (ctx) =>
      ctx.currentMemberId != null &&
      CHAT_MESSAGE_FALLBACK_PATTERN.test(ctx.message) &&
      isImperative(ctx),
    tools: () => ["prepare_chat_message"],
  },
  {
    id: "messages_route_group_fallback",
    when: (ctx) =>
      ctx.currentFeatureSegment === "messages" &&
      GROUP_CHAT_MESSAGE_FALLBACK_PATTERN.test(ctx.message) &&
      isImperative(ctx),
    tools: () => ["prepare_group_message"],
  },
  {
    id: "discussion_thread_reply_fallback",
    when: (ctx) =>
      ctx.currentDiscussionThreadId != null &&
      DISCUSSION_REPLY_FALLBACK_PATTERN.test(ctx.message) &&
      isImperative(ctx),
    tools: () => ["prepare_discussion_reply"],
  },
];

export const PASS1_ROUTING_RULE_IDS: ReadonlyArray<string> = PASS1_ROUTING_RULES.map(
  (r) => r.id,
);

function buildRoutingContext(
  message: string,
  effectiveSurface: CacheSurface,
  intentType: TurnExecutionPolicy["intentType"],
  attachment: ChatAttachment | undefined,
  currentPath: string | undefined,
  enterpriseEnabled: boolean | undefined,
  enterpriseRole: EnterpriseRole | undefined,
): RoutingContext {
  const trimmedMessage = message.trim();
  const currentFeatureSegment = getCurrentPathFeatureSegment(currentPath);
  const isEnterprisePortal =
    enterpriseEnabled === true && currentPath?.startsWith("/enterprise/") === true;
  const isEnterpriseScopedRequest =
    enterpriseEnabled === true &&
    (isEnterprisePortal || ENTERPRISE_SCOPE_PROMPT_PATTERN.test(message));
  const canManageEnterpriseBilling =
    enterpriseRole != null && getEnterprisePermissions(enterpriseRole).canManageBilling;

  return {
    message,
    trimmedMessage,
    isQuestionLike: trimmedMessage.endsWith("?"),
    surface: effectiveSurface,
    intentType,
    attachment,
    currentEventId: extractCurrentEventRouteId(currentPath),
    currentJobPostingId: extractCurrentJobPostingRouteId(currentPath),
    currentMemberId: extractCurrentMemberRouteId(currentPath),
    currentDiscussionThreadId: extractCurrentDiscussionThreadRouteId(currentPath),
    currentFeatureSegment,
    isEnterpriseScopedRequest,
    canManageEnterpriseBilling,
  };
}

/**
 * Diagnostic helper: returns the id of the first matching rule, or `null` for
 * the surface fallback. Useful when investigating why a prompt routed to a
 * given tool. Not used in production hot path.
 */
export function matchPass1RoutingRule(
  message: string,
  effectiveSurface: CacheSurface,
  toolPolicy: TurnExecutionPolicy["toolPolicy"],
  intentType: TurnExecutionPolicy["intentType"],
  attachment?: ChatAttachment,
  currentPath?: string,
  enterpriseEnabled?: boolean,
  enterpriseRole?: EnterpriseRole,
): string | null {
  if (toolPolicy !== "surface_read_tools") return null;
  const ctx = buildRoutingContext(
    message,
    effectiveSurface,
    intentType,
    attachment,
    currentPath,
    enterpriseEnabled,
    enterpriseRole,
  );
  for (const rule of PASS1_ROUTING_RULES) {
    if (rule.when(ctx)) return rule.id;
  }
  return null;
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

  const ctx = buildRoutingContext(
    message,
    effectiveSurface,
    intentType,
    attachment,
    currentPath,
    enterpriseEnabled,
    enterpriseRole,
  );

  for (const rule of PASS1_ROUTING_RULES) {
    if (rule.when(ctx)) {
      return rule.tools(ctx).map((toolName) => AI_TOOL_MAP[toolName]);
    }
  }

  return PASS1_TOOL_NAMES[effectiveSurface].map((toolName) => AI_TOOL_MAP[toolName]);
}

export const FORCED_PASS1_TOOL_CHOICE_ELIGIBLE: ReadonlySet<ToolName> = new Set<ToolName>([
  "prepare_announcement",
  "prepare_job_posting",
  "prepare_update_job_posting",
  "prepare_delete_job_posting",
  "prepare_chat_message",
  "list_chat_groups",
  "prepare_group_message",
  "prepare_discussion_reply",
  "prepare_discussion_thread",
  "prepare_event",
  "prepare_update_event",
  "prepare_delete_event",
  "prepare_member_role_change",
  "list_members",
  "list_member_preferences",
  "get_org_stats",
  "get_donation_analytics",
  "get_enterprise_stats",
  "get_enterprise_quota",
  "get_enterprise_org_capacity",
  "list_events",
  "list_alumni",
  "list_enterprise_alumni",
  "list_donations",
  "list_managed_orgs",
  "list_enterprise_audit_events",
  "prepare_enterprise_invite",
  "revoke_enterprise_invite",
  "list_parents",
  "list_philanthropy_events",
  "find_navigation_targets",
  "search_org_content",
  "scrape_schedule_website",
  "extract_schedule_pdf",
]);

export function getForcedPass1ToolChoice(
  pass1Tools: ReturnType<typeof getPass1Tools>
): OpenAI.Chat.ChatCompletionToolChoiceOption | undefined {
  if (!pass1Tools || pass1Tools.length !== 1) {
    return undefined;
  }

  const forcedToolName = pass1Tools[0]?.function.name;
  if (!forcedToolName || !FORCED_PASS1_TOOL_CHOICE_ELIGIBLE.has(forcedToolName as ToolName)) {
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
  "find_navigation_targets",
  "search_org_content",
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

export const TOOL_FIRST_ELIGIBLE: ReadonlySet<ToolName> = new Set<ToolName>([
  "list_members",
  "list_member_preferences",
  "get_org_stats",
  "get_donation_analytics",
  "find_navigation_targets",
  "search_org_content",
  "list_announcements",
  "list_chat_groups",
  "list_events",
  "list_discussions",
  "list_job_postings",
  "list_alumni",
  "list_enterprise_alumni",
  "list_donations",
  "list_managed_orgs",
  "list_enterprise_audit_events",
  "list_parents",
  "list_philanthropy_events",
  "get_enterprise_stats",
  "get_enterprise_quota",
  "get_enterprise_org_capacity",
  "suggest_connections",
  "prepare_group_message",
]);

export function isToolFirstEligible(
  pass1Tools: ReturnType<typeof getPass1Tools>
): boolean {
  if (!pass1Tools || pass1Tools.length !== 1) {
    return false;
  }

  const toolName = pass1Tools[0]?.function.name;
  return Boolean(toolName) && TOOL_FIRST_ELIGIBLE.has(toolName as ToolName);
}
