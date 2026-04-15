import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PrepareEventArgs, ToolName } from "./definitions";
import { TOOL_NAMES } from "./definitions";
import { listEnterpriseAlumni } from "./enterprise/list-alumni";
import { getEnterpriseStats } from "./enterprise/stats";
import { listManagedOrgs } from "./enterprise/managed-orgs";
import { getEnterpriseOrgCapacity, getEnterpriseQuota } from "./enterprise/quota";
import { listEnterpriseAuditEvents } from "./enterprise/audit-visibility";
import { getEnterprisePermissions, type EnterpriseRole } from "@/types/enterprise";
import {
  EXTRACTION_TOOL_TIMEOUT_MS,
  isStageTimeoutError,
  TOOL_EXECUTION_TIMEOUT_MS,
  withStageTimeout,
} from "@/lib/ai/timeout";
import type { AiToolAuthMode } from "@/lib/ai/chat-telemetry";
import { searchNavigationTargets } from "@/lib/ai/navigation-targets";
import type { NavConfig } from "@/lib/navigation/nav-items";
import {
  assistantAnnouncementDraftSchema,
  assistantPreparedAnnouncementSchema,
  type AssistantPreparedAnnouncement,
} from "@/lib/schemas/content";
import {
  assistantJobDraftSchema,
  assistantPreparedJobSchema,
  type AssistantPreparedJob,
} from "@/lib/schemas/jobs";
import {
  assistantDiscussionDraftSchema,
  assistantDiscussionReplyDraftSchema,
  assistantPreparedDiscussionReplySchema,
  assistantPreparedDiscussionSchema,
} from "@/lib/schemas/discussion";
import {
  assistantChatMessageDraftSchema,
  assistantPreparedChatMessageSchema,
  assistantGroupMessageDraftSchema,
  assistantPreparedGroupMessageSchema,
} from "@/lib/schemas/chat-ai";
import {
  assistantEventDraftSchema,
  assistantPreparedEventSchema,
} from "@/lib/schemas/events-ai";
import { fetchJobSourceDraft, JobSourceIntakeError } from "@/lib/jobs/source-intake";
import { ScheduleSecurityError } from "@/lib/schedule-security/errors";
import { fetchUrlSafe } from "@/lib/schedule-security/fetchUrlSafe";
import { isOwnedScheduleUploadPath } from "@/lib/ai/schedule-upload-path";
import {
  buildPendingActionSummary,
  type CreateAnnouncementPendingPayload,
  type SendChatMessagePendingPayload,
  type SendGroupChatMessagePendingPayload,
  type CreateDiscussionReplyPendingPayload,
  createPendingAction,
  type CreateDiscussionThreadPendingPayload,
  type CreateEventPendingPayload,
  type CreateJobPostingPendingPayload,
  type CreateEnterpriseInvitePendingPayload,
  type RevokeEnterpriseInvitePendingPayload,
} from "@/lib/ai/pending-actions";
import { aiLog, type AiLogContext } from "@/lib/ai/logger";
import { sanitizeIlikeInput } from "@/lib/security/validation";
import {
  resolveChatMessageRecipient,
  type DirectChatSupabase,
} from "@/lib/chat/direct-chat";
import {
  listUserChatGroups,
  resolveGroupChatTarget,
  type GroupChatSupabase,
} from "@/lib/chat/group-chat";
import type {
  ScheduleImageMimeType,
  ScheduleExtractionResult,
} from "@/lib/ai/schedule-extraction";

export type ToolExecutionAuthorization =
  | { kind: "preverified_admin"; source: "ai_org_context" }
  | { kind: "verify_membership" };

export interface ToolExecutionContext {
  orgId: string;
  userId: string;
  enterpriseId?: string;
  enterpriseRole?: EnterpriseRole;
  serviceSupabase: SupabaseClient;
  authorization: ToolExecutionAuthorization;
  threadId?: string;
  requestId?: string;
  attachment?: {
    storagePath: string;
    fileName: string;
    mimeType: string;
  };
}

export type ScheduleFileToolErrorCode =
  | "attachment_required"
  | "invalid_attachment_path"
  | "org_context_failed"
  | "attachment_unavailable"
  | "image_too_large"
  | "image_timeout"
  | "image_unreadable"
  | "image_model_misconfigured"
  | "pdf_unreadable"
  | "pdf_timeout";

export type ToolExecutionErrorCode =
  | ScheduleFileToolErrorCode
  | "enterprise_billing_role_required"
  | "enterprise_invite_role_required";

export type ToolExecutionResult =
  | { kind: "ok"; data: unknown }
  | { kind: "forbidden"; error: "Forbidden" }
  | { kind: "auth_error"; error: "Auth check failed" }
  | { kind: "tool_error"; error: string; code?: ToolExecutionErrorCode }
  | { kind: "timeout"; error: "Tool timed out" };

type CountResult =
  | { ok: true; count: number }
  | { ok: false; error: string };

const listMembersSchema = z
  .object({
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

const listEventsSchema = z
  .object({
    limit: z.number().int().min(1).max(25).optional(),
    upcoming: z.boolean().optional(),
  })
  .strict();

const listAnnouncementsSchema = z
  .object({
    limit: z.number().int().min(1).max(25).optional(),
    pinned_only: z.boolean().optional(),
  })
  .strict();

const listDiscussionsSchema = z
  .object({
    limit: z.number().int().min(1).max(25).optional(),
  })
  .strict();

const listJobPostingsSchema = z
  .object({
    limit: z.number().int().min(1).max(25).optional(),
  })
  .strict();

const listAlumniSchema = z
  .object({
    limit: z.number().int().min(1).max(25).optional(),
    graduation_year: z.number().int().min(1900).max(2100).optional(),
    industry: z.string().trim().min(1).optional(),
    company: z.string().trim().min(1).optional(),
    city: z.string().trim().min(1).optional(),
  })
  .strict();

const listDonationsSchema = z
  .object({
    limit: z.number().int().min(1).max(25).optional(),
    status: z.enum(["succeeded", "failed", "pending"]).optional(),
    purpose: z.string().trim().min(1).optional(),
  })
  .strict();

const listParentsSchema = z
  .object({
    limit: z.number().int().min(1).max(25).optional(),
    relationship: z.string().trim().min(1).optional(),
  })
  .strict();

const listPhilanthropyEventsSchema = z
  .object({
    limit: z.number().int().min(1).max(25).optional(),
    upcoming: z.boolean().optional(),
  })
  .strict();

const prepareAnnouncementSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    body: z.string().trim().optional(),
    is_pinned: z.boolean().optional(),
    audience: z.enum(["all", "members", "active_members", "alumni", "individuals"]).optional(),
    send_notification: z.boolean().optional(),
    audience_user_ids: z.array(z.string().uuid()).optional(),
  })
  .strict();

const prepareJobPostingSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    company: z.string().trim().min(1).optional(),
    location: z.string().trim().min(1).optional(),
    location_type: z.enum(["remote", "hybrid", "onsite"]).optional(),
    description: z.string().trim().min(1).optional(),
    application_url: z.string().trim().min(1).optional(),
    contact_email: z.string().trim().min(1).optional(),
    industry: z.string().trim().min(1).optional(),
    experience_level: z.enum(["entry", "mid", "senior", "lead", "executive"]).optional(),
    expires_at: z.string().datetime().optional().nullable(),
    mediaIds: z.array(z.string().uuid()).optional(),
  })
  .strict();

const prepareDiscussionThreadSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    body: z.string().trim().min(1).optional(),
    mediaIds: z.array(z.string().uuid()).optional(),
  })
  .strict();

const prepareDiscussionReplySchema = z
  .object({
    discussion_thread_id: z.string().uuid().optional(),
    thread_title: z.string().trim().min(1).optional(),
    body: z.string().trim().min(1).optional(),
  })
  .strict();

const prepareChatMessageSchema = z
  .object({
    recipient_member_id: z.string().uuid().optional(),
    person_query: z.string().trim().min(1).optional(),
    body: z.string().trim().min(1).optional(),
  })
  .strict();

const listChatGroupsSchema = z
  .object({
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

const prepareGroupMessageSchema = z
  .object({
    chat_group_id: z.string().uuid().optional(),
    group_name_query: z.string().trim().min(1).optional(),
    body: z.string().trim().min(1).optional(),
  })
  .strict();

const prepareEventSchema = z
  .object({
    title: z.string().trim().optional(),
    description: z.string().trim().optional(),
    start_date: z.string().trim().optional(),
    start_time: z.string().trim().optional(),
    end_date: z.string().trim().optional(),
    end_time: z.string().trim().optional(),
    location: z.string().trim().optional(),
    event_type: z
      .enum(["general", "philanthropy", "game", "practice", "meeting", "social", "workout", "fundraiser", "class"])
      .optional(),
    is_philanthropy: z.boolean().optional(),
  })
  .strict();

const prepareEventsBatchSchema = z
  .object({
    events: z.array(prepareEventSchema).min(1).max(10),
  })
  .strict();
const scrapeScheduleWebsiteSchema = z
  .object({
    url: z.string().url(),
  })
  .strict();
const extractSchedulePdfSchema = z.object({}).strict();

const getOrgStatsSchema = z.object({}).strict();
const getEnterpriseStatsSchema = z.object({}).strict();
const getEnterpriseQuotaSchema = z.object({}).strict();
const getEnterpriseOrgCapacitySchema = z.object({}).strict();
const listManagedOrgsSchema = z.object({}).strict();
const listEnterpriseAuditEventsSchema = z
  .object({
    organization_id: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
const prepareEnterpriseInviteSchema = z
  .object({
    role: z.enum(["admin", "active_member", "alumni"]).optional(),
    organization_id: z.string().trim().min(1).optional(),
    organization_query: z.string().trim().min(1).optional(),
    uses_remaining: z.number().int().min(1).max(1000).optional(),
    expires_at: z.string().datetime().optional(),
  })
  .strict();
const revokeEnterpriseInviteSchema = z
  .object({
    invite_id: z.string().trim().min(1).optional(),
    invite_code: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (value) =>
      (typeof value.invite_id === "string" && value.invite_id.length > 0) ||
      (typeof value.invite_code === "string" && value.invite_code.length > 0),
    { message: "Expected invite_id or invite_code" },
  );
const listEnterpriseAlumniSchema = z
  .object({
    org: z.string().trim().min(1).optional(),
    graduation_year: z.number().int().min(1900).max(2100).optional(),
    industry: z.string().trim().min(1).optional(),
    company: z.string().trim().min(1).optional(),
    city: z.string().trim().min(1).optional(),
    position: z.string().trim().min(1).optional(),
    has_email: z.boolean().optional(),
    has_phone: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).max(5000).optional(),
  })
  .strict();
const suggestConnectionsSchema = z
  .object({
    person_type: z.enum(["member", "alumni"]).optional(),
    person_id: z.string().uuid().optional(),
    person_query: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(25).optional(),
  })
  .refine(
    (value) =>
      (typeof value.person_query === "string" && value.person_query.length > 0) ||
      (typeof value.person_type === "string" && typeof value.person_id === "string"),
    {
      message: "Expected person_query or both person_type and person_id",
    }
  )
  .strict();
const findNavigationTargetsSchema = z
  .object({
    query: z.string().trim().min(1),
    limit: z.number().int().min(1).max(10).optional(),
  })
  .strict();

const ARG_SCHEMAS: Record<ToolName, z.ZodSchema> = {
  list_members: listMembersSchema,
  list_events: listEventsSchema,
  list_announcements: listAnnouncementsSchema,
  list_discussions: listDiscussionsSchema,
  list_job_postings: listJobPostingsSchema,
  list_chat_groups: listChatGroupsSchema,
  list_alumni: listAlumniSchema,
  list_enterprise_alumni: listEnterpriseAlumniSchema,
  list_donations: listDonationsSchema,
  list_parents: listParentsSchema,
  list_philanthropy_events: listPhilanthropyEventsSchema,
  list_managed_orgs: listManagedOrgsSchema,
  list_enterprise_audit_events: listEnterpriseAuditEventsSchema,
  prepare_enterprise_invite: prepareEnterpriseInviteSchema,
  revoke_enterprise_invite: revokeEnterpriseInviteSchema,
  prepare_announcement: prepareAnnouncementSchema,
  prepare_job_posting: prepareJobPostingSchema,
  prepare_chat_message: prepareChatMessageSchema,
  prepare_group_message: prepareGroupMessageSchema,
  prepare_discussion_reply: prepareDiscussionReplySchema,
  prepare_discussion_thread: prepareDiscussionThreadSchema,
  prepare_event: prepareEventSchema,
  prepare_events_batch: prepareEventsBatchSchema,
  scrape_schedule_website: scrapeScheduleWebsiteSchema,
  extract_schedule_pdf: extractSchedulePdfSchema,
  get_org_stats: getOrgStatsSchema,
  get_enterprise_stats: getEnterpriseStatsSchema,
  get_enterprise_quota: getEnterpriseQuotaSchema,
  get_enterprise_org_capacity: getEnterpriseOrgCapacitySchema,
  suggest_connections: suggestConnectionsSchema,
  find_navigation_targets: findNavigationTargetsSchema,
};

const ENTERPRISE_TOOL_NAMES = new Set<ToolName>([
  "list_enterprise_alumni",
  "get_enterprise_stats",
  "list_managed_orgs",
  "get_enterprise_quota",
  "get_enterprise_org_capacity",
  "list_enterprise_audit_events",
  "prepare_enterprise_invite",
  "revoke_enterprise_invite",
]);

const BILLING_ONLY_ENTERPRISE_TOOLS = new Set<ToolName>([
  "get_enterprise_quota",
]);

const ENTERPRISE_INVITE_TOOLS = new Set<ToolName>([
  "prepare_enterprise_invite",
  "revoke_enterprise_invite",
]);

function validateArgs(
  name: ToolName,
  raw: unknown
): { valid: true; args: unknown } | { valid: false; error: string } {
  const schema = ARG_SCHEMAS[name];
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: false,
      error: `Invalid tool arguments: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
    };
  }
  return { valid: true, args: parsed.data };
}

function getSafeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = error.message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }

  return "unknown_error";
}

function toolError(error: string, code?: ToolExecutionErrorCode): ToolExecutionResult {
  return code ? { kind: "tool_error", error, code } : { kind: "tool_error", error };
}

function isScheduleImageConfigurationError(error: unknown): boolean {
  const message = getSafeErrorMessage(error);
  return /ZAI_IMAGE_MODEL|vision model|model such as glm-5v-turbo/i.test(message);
}

function buildLogContext(
  ctx: Pick<ToolExecutionContext, "orgId" | "userId" | "threadId" | "requestId">
): AiLogContext {
  return {
    requestId: ctx.requestId ?? "unknown_request",
    orgId: ctx.orgId,
    userId: ctx.userId,
    ...(ctx.threadId ? { threadId: ctx.threadId } : {}),
  };
}

async function safeToolQuery(
  logContext: AiLogContext,
  fn: () => Promise<{ data: unknown; error: unknown }>
): Promise<ToolExecutionResult> {
  try {
    const { data, error } = await fn();
    if (error) {
      aiLog("warn", "ai-tools", "query failed", logContext, {
        error: getSafeErrorMessage(error),
      });
      return toolError("Query failed");
    }
    return { kind: "ok", data: data ?? [] };
  } catch (err) {
    if (isStageTimeoutError(err)) {
      throw err;
    }
    aiLog("warn", "ai-tools", "unexpected error", logContext, {
      error: getSafeErrorMessage(err),
    });
    return toolError("Unexpected error");
  }
}

async function safeToolCount(
  logContext: AiLogContext,
  fn: () => Promise<{ count: number | null; error: unknown }>
): Promise<CountResult> {
  try {
    const { count, error } = await fn();
    if (error || count === null) {
      if (error) {
        aiLog("warn", "ai-tools", "count query failed", logContext, {
          error: getSafeErrorMessage(error),
        });
      } else {
        aiLog("warn", "ai-tools", "count query failed", logContext, {
          error: "count_unavailable",
        });
      }
      return { ok: false, error: "Query failed" };
    }
    return { ok: true, count };
  } catch (err) {
    if (isStageTimeoutError(err)) {
      throw err;
    }
    aiLog("warn", "ai-tools", "unexpected count error", logContext, {
      error: getSafeErrorMessage(err),
    });
    return { ok: false, error: "Unexpected error" };
  }
}

const MAX_BODY_PREVIEW_CHARS = 500;
const SCRAPE_SCHEDULE_FETCH_TIMEOUT_MS = 10_000;
const SCRAPE_SCHEDULE_MAX_BYTES = 512 * 1024;
const MAX_SOURCE_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB — prevents oversized base64 payloads to LLM
const IMAGE_EXTRACTION_TOOL_TIMEOUT_MS = 60_000;
const PDF_EXTRACTION_TOOL_TIMEOUT_MS = 60_000;
const SCHEDULE_UPLOAD_BUCKET = "ai-schedule-uploads";
const SCHEDULE_IMAGE_MIME_TYPES = new Set<ScheduleImageMimeType>([
  "image/png",
  "image/jpeg",
  "image/jpg",
]);
type CheerioLoad = typeof import("cheerio").load;
type PdfParseCtor = typeof import("pdf-parse").PDFParse;
type ScheduleExtractionModule = typeof import("@/lib/ai/schedule-extraction");

let cachedCheerioLoad: CheerioLoad | null = null;
let cachedPdfParseCtor: PdfParseCtor | null = null;
let cachedScheduleExtractionModule: ScheduleExtractionModule | null = null;

async function getCheerioLoad(): Promise<CheerioLoad> {
  if (cachedCheerioLoad) {
    return cachedCheerioLoad;
  }

  const { load } = await import("cheerio");
  cachedCheerioLoad = load;
  return load;
}

async function getPdfParseCtor(): Promise<PdfParseCtor> {
  if (cachedPdfParseCtor) {
    return cachedPdfParseCtor;
  }

  const { PDFParse } = await import("pdf-parse");
  cachedPdfParseCtor = PDFParse;
  return PDFParse;
}

async function getScheduleExtractionModule(): Promise<ScheduleExtractionModule> {
  if (cachedScheduleExtractionModule) {
    return cachedScheduleExtractionModule;
  }

  cachedScheduleExtractionModule = await import("@/lib/ai/schedule-extraction");
  return cachedScheduleExtractionModule;
}

function isScheduleImageAttachment(
  attachment?: ToolExecutionContext["attachment"]
): boolean {
  return Boolean(
    attachment
      && SCHEDULE_IMAGE_MIME_TYPES.has(attachment.mimeType as ScheduleImageMimeType)
  );
}

function truncateBody(body: string | null | undefined): string | null {
  if (typeof body !== "string" || body.trim().length === 0) {
    return null;
  }
  return body.trim().slice(0, MAX_BODY_PREVIEW_CHARS);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

interface MemberToolRow {
  id: string;
  user_id: string | null;
  status: string | null;
  role: string | null;
  created_at: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
}

interface UserNameRow {
  id: string;
  name: string | null;
}

interface MembershipRow {
  role: string | null;
  status: string | null;
}

interface EventPendingActionRecord {
  id: string;
  action_type: string;
  payload: CreateEventPendingPayload;
  expires_at: string;
  summary: { title: string; description: string };
}

interface EventValidationErrorRecord {
  index: number;
  missing_fields: string[];
  draft: Record<string, unknown>;
}

function buildMemberName(firstName: string, lastName: string): string {
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

function isPlaceholderMemberName(firstName: string, lastName: string): boolean {
  const normalizedFirstName = firstName.trim();
  const normalizedLastName = lastName.trim();

  return (
    (normalizedFirstName.length === 0 && normalizedLastName.length === 0) ||
    (normalizedFirstName === "Member" && normalizedLastName.length === 0)
  );
}

function isTrustworthyHumanName(value: string | null | undefined): value is string {
  const normalizedValue = value?.trim() ?? "";
  return normalizedValue.length > 0 && normalizedValue !== "Member" && !normalizedValue.includes("@");
}

async function listMembers(
  sb: SB,
  orgId: string,
  args: z.infer<typeof listMembersSchema>,
  logContext: AiLogContext
): Promise<ToolExecutionResult> {
  const limit = Math.min(args.limit ?? 20, 50);
  return safeToolQuery(logContext, async () => {
    const { data, error } = await sb
      .from("members")
      .select("id, user_id, status, role, created_at, first_name, last_name, email")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!Array.isArray(data) || error) {
      return { data, error };
    }

    const members = data as MemberToolRow[];
    const linkedUserIds = [...new Set(
      members
        .map((member) => member.user_id)
        .filter((userId): userId is string => typeof userId === "string" && userId.length > 0)
    )];

    const userNameById = new Map<string, string>();

    if (linkedUserIds.length > 0) {
      const { data: userRows, error: userError } = await sb
        .from("users")
        .select("id, name")
        .in("id", linkedUserIds);

      if (userError) {
        return { data: null, error: userError };
      }

      if (Array.isArray(userRows)) {
        for (const user of userRows as UserNameRow[]) {
          if (isTrustworthyHumanName(user.name)) {
            userNameById.set(user.id, user.name.trim());
          }
        }
      }
    }

    return {
      data: members.map((member) => {
        const memberName = buildMemberName(member.first_name, member.last_name);
        const fallbackUserName =
          member.user_id && !isPlaceholderMemberName(member.first_name, member.last_name)
            ? null
            : member.user_id
              ? userNameById.get(member.user_id) ?? null
              : null;

        return {
          id: member.id,
          user_id: member.user_id,
          status: member.status,
          role: member.role,
          created_at: member.created_at,
          name:
            memberName && !isPlaceholderMemberName(member.first_name, member.last_name)
              ? memberName
              : fallbackUserName ?? "",
          email: member.email,
        };
      }),
      error,
    };
  });
}

async function listEvents(
  sb: SB,
  orgId: string,
  args: z.infer<typeof listEventsSchema>,
  logContext: AiLogContext
): Promise<ToolExecutionResult> {
  const limit = Math.min(args.limit ?? 10, 25);
  const upcoming = args.upcoming ?? true;
  const now = new Date().toISOString();
  return safeToolQuery(logContext, () => {
    let query = sb
      .from("events")
      .select("id, title, start_date, end_date, location, description")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("start_date", { ascending: upcoming })
      .limit(limit);
    if (upcoming) {
      query = query.gte("start_date", now);
    } else {
      query = query.lt("start_date", now);
    }
    return query;
  });
}

async function listAnnouncements(
  sb: SB,
  orgId: string,
  args: z.infer<typeof listAnnouncementsSchema>,
  logContext: AiLogContext
): Promise<ToolExecutionResult> {
  const limit = Math.min(args.limit ?? 10, 25);
  const pinnedOnly = args.pinned_only ?? false;
  return safeToolQuery(logContext, async () => {
    let query = sb
      .from("announcements")
      .select("id, title, body, audience, is_pinned, published_at, created_at")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("is_pinned", { ascending: false })
      .order("published_at", { ascending: false })
      .limit(limit);

    if (pinnedOnly) {
      query = query.eq("is_pinned", true);
    }

    const { data, error } = await query;

    if (!Array.isArray(data) || error) {
      return { data, error };
    }

    return {
      data: data.map((announcement) => ({
        id: announcement.id,
        title: announcement.title,
        audience: announcement.audience,
        is_pinned: Boolean(announcement.is_pinned),
        published_at: announcement.published_at ?? announcement.created_at ?? null,
        body_preview: truncateBody(announcement.body),
      })),
      error: null,
    };
  });
}

async function listDiscussions(
  sb: SB,
  orgId: string,
  args: z.infer<typeof listDiscussionsSchema>,
  logContext: AiLogContext
): Promise<ToolExecutionResult> {
  const limit = Math.min(args.limit ?? 10, 25);
  return safeToolQuery(logContext, async () => {
    const { data, error } = await sb
      .from("discussion_threads")
      .select("id, title, body, author_id, reply_count, created_at")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!Array.isArray(data) || error) {
      return { data, error };
    }

    return {
      data: data.map((discussion) => ({
        id: discussion.id,
        title: discussion.title,
        author_id: discussion.author_id,
        reply_count: discussion.reply_count ?? 0,
        created_at: discussion.created_at ?? null,
        body_preview: truncateBody(discussion.body),
      })),
      error: null,
    };
  });
}

async function listJobPostings(
  sb: SB,
  orgId: string,
  args: z.infer<typeof listJobPostingsSchema>,
  logContext: AiLogContext
): Promise<ToolExecutionResult> {
  const limit = Math.min(args.limit ?? 10, 25);
  return safeToolQuery(logContext, async () => {
    const { data, error } = await sb
      .from("job_postings")
      .select("id, title, company, location, job_type, description, created_at")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!Array.isArray(data) || error) {
      return { data, error };
    }

    return {
      data: data.map((job) => ({
        id: job.id,
        title: job.title,
        company: job.company ?? null,
        location: job.location ?? null,
        job_type: job.job_type ?? null,
        created_at: job.created_at ?? null,
        description_preview: truncateBody(job.description),
      })),
      error: null,
    };
  });
}

async function listAlumni(
  sb: SB,
  orgId: string,
  args: z.infer<typeof listAlumniSchema>,
  logContext: AiLogContext
): Promise<ToolExecutionResult> {
  const limit = Math.min(args.limit ?? 10, 25);
  return safeToolQuery(logContext, async () => {
    let query = sb
      .from("alumni")
      .select("id, first_name, last_name, graduation_year, current_company, industry, current_city, position_title, job_title, linkedin_url, email")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("graduation_year", { ascending: false })
      .limit(limit);

    if (args.graduation_year !== undefined) {
      query = query.eq("graduation_year", args.graduation_year);
    }
    if (args.industry) {
      query = query.ilike("industry", `%${sanitizeIlikeInput(args.industry)}%`);
    }
    if (args.company) {
      query = query.ilike("current_company", `%${sanitizeIlikeInput(args.company)}%`);
    }
    if (args.city) {
      query = query.ilike("current_city", `%${sanitizeIlikeInput(args.city)}%`);
    }

    const { data, error } = await query;

    if (!Array.isArray(data) || error) {
      return { data, error };
    }

    return {
      data: data.map((row) => ({
        id: row.id,
        name: buildMemberName(row.first_name ?? "", row.last_name ?? ""),
        graduation_year: row.graduation_year ?? null,
        current_company: row.current_company ?? null,
        industry: row.industry ?? null,
        current_city: row.current_city ?? null,
        title: row.position_title ?? row.job_title ?? null,
        linkedin_url: row.linkedin_url ?? null,
        email: row.email ?? null,
      })),
      error: null,
    };
  });
}

async function listDonations(
  sb: SB,
  orgId: string,
  args: z.infer<typeof listDonationsSchema>,
  logContext: AiLogContext
): Promise<ToolExecutionResult> {
  const limit = Math.min(args.limit ?? 10, 25);
  return safeToolQuery(logContext, async () => {
    let query = sb
      .from("organization_donations")
      .select("id, donor_name, donor_email, amount_cents, purpose, status, created_at, anonymous")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (args.status) {
      query = query.eq("status", args.status);
    }
    if (args.purpose) {
      query = query.ilike("purpose", `%${sanitizeIlikeInput(args.purpose)}%`);
    }

    const { data, error } = await query;

    if (!Array.isArray(data) || error) {
      return { data, error };
    }

    return {
      data: data.map((row) => {
        const isAnonymous = Boolean(row.anonymous);
        return {
          id: row.id,
          donor_name: isAnonymous ? "Anonymous" : (row.donor_name ?? null),
          donor_email: isAnonymous ? "Anonymous" : (row.donor_email ?? null),
          amount_dollars: typeof row.amount_cents === "number" ? row.amount_cents / 100 : null,
          purpose: row.purpose ?? null,
          status: row.status ?? null,
          created_at: row.created_at ?? null,
          anonymous: isAnonymous,
        };
      }),
      error: null,
    };
  });
}

async function listParents(
  sb: SB,
  orgId: string,
  args: z.infer<typeof listParentsSchema>,
  logContext: AiLogContext
): Promise<ToolExecutionResult> {
  const limit = Math.min(args.limit ?? 10, 25);
  return safeToolQuery(logContext, async () => {
    let query = sb
      .from("parents")
      .select("id, first_name, last_name, email, relationship, student_name, phone_number")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("last_name", { ascending: true })
      .limit(limit);

    if (args.relationship) {
      query = query.ilike("relationship", `%${sanitizeIlikeInput(args.relationship)}%`);
    }

    const { data, error } = await query;

    if (!Array.isArray(data) || error) {
      return { data, error };
    }

    return {
      data: data.map((row) => ({
        id: row.id,
        name: buildMemberName(row.first_name ?? "", row.last_name ?? ""),
        relationship: row.relationship ?? null,
        student_name: row.student_name ?? null,
        email: row.email ?? null,
        phone_number: row.phone_number ?? null,
      })),
      error: null,
    };
  });
}

async function listPhilanthropyEvents(
  sb: SB,
  orgId: string,
  args: z.infer<typeof listPhilanthropyEventsSchema>,
  logContext: AiLogContext
): Promise<ToolExecutionResult> {
  const limit = Math.min(args.limit ?? 10, 25);
  const upcoming = args.upcoming ?? true;
  const now = new Date().toISOString();
  return safeToolQuery(logContext, () => {
    let query = sb
      .from("events")
      .select("id, title, start_date, end_date, location, description")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .or("is_philanthropy.eq.true,event_type.eq.philanthropy")
      .order("start_date", { ascending: upcoming })
      .limit(limit);
    if (upcoming) {
      query = query.gte("start_date", now);
    } else {
      query = query.lt("start_date", now);
    }
    return query;
  });
}

const REQUIRED_PREPARED_JOB_FIELDS: Array<keyof AssistantPreparedJob> = [
  "title",
  "company",
  "location",
  "industry",
  "experience_level",
  "description",
];
const REQUIRED_PREPARED_ANNOUNCEMENT_FIELDS: Array<keyof AssistantPreparedAnnouncement> = [
  "title",
];
const REQUIRED_PREPARED_EVENT_FIELDS = [
  "title",
  "start_date",
  "start_time",
] as const satisfies ReadonlyArray<keyof z.infer<typeof assistantPreparedEventSchema>>;

async function createEventPendingActionsFromDrafts(
  sb: SB,
  ctx: ToolExecutionContext,
  events: PrepareEventArgs[],
  logContext: AiLogContext,
  orgSlug: string | null
): Promise<{
  pendingActions: EventPendingActionRecord[];
  validationErrors: EventValidationErrorRecord[];
}> {
  const threadId = ctx.threadId;
  if (!threadId) {
    throw new Error("Event preparation requires a thread context");
  }

  const pendingActions: EventPendingActionRecord[] = [];
  const validationErrors: EventValidationErrorRecord[] = [];

  for (let i = 0; i < events.length; i++) {
    const eventArgs = events[i];
    const normalized = Object.fromEntries(
      Object.entries(eventArgs).filter(
        ([, value]) => !(typeof value === "string" && value.trim().length === 0)
      )
    ) as PrepareEventArgs;

    const draftWithDefaults = {
      ...normalized,
      event_type: normalized.event_type ?? "general",
      is_philanthropy:
        normalized.is_philanthropy ?? normalized.event_type === "philanthropy",
    };

    const parsedDraft = assistantEventDraftSchema.safeParse(draftWithDefaults);
    if (!parsedDraft.success) {
      validationErrors.push({
        index: i,
        missing_fields: parsedDraft.error.issues.map((issue) => issue.path.join(".") || "body"),
        draft: draftWithDefaults,
      });
      continue;
    }

    const missingFields = REQUIRED_PREPARED_EVENT_FIELDS.filter((field) => {
      const value = parsedDraft.data[field];
      return typeof value !== "string" || value.trim().length === 0;
    });

    if (missingFields.length > 0) {
      validationErrors.push({
        index: i,
        missing_fields: [...missingFields],
        draft: parsedDraft.data as unknown as Record<string, unknown>,
      });
      continue;
    }

    const prepared = assistantPreparedEventSchema.safeParse(parsedDraft.data);
    if (!prepared.success) {
      validationErrors.push({
        index: i,
        missing_fields: prepared.error.issues.map((issue) => issue.path.join(".") || "body"),
        draft: parsedDraft.data as unknown as Record<string, unknown>,
      });
      continue;
    }

    const pendingPayload: CreateEventPendingPayload = {
      ...prepared.data,
      orgSlug,
    };

    try {
      const pendingAction = await createPendingAction(sb, {
        organizationId: ctx.orgId,
        userId: ctx.userId,
        threadId,
        actionType: "create_event",
        payload: pendingPayload,
      });
      const summary = buildPendingActionSummary(pendingAction);
      pendingActions.push({
        id: pendingAction.id,
        action_type: pendingAction.action_type,
        payload: pendingPayload,
        expires_at: pendingAction.expires_at,
        summary,
      });
    } catch (error) {
      aiLog("warn", "ai-tools", "event pending action insert failed", logContext, {
        index: i,
        error: getSafeErrorMessage(error),
      });
      validationErrors.push({
        index: i,
        missing_fields: ["_insert_failed"],
        draft: prepared.data as unknown as Record<string, unknown>,
      });
    }
  }

  return {
    pendingActions,
    validationErrors,
  };
}

export async function buildPendingEventBatchFromDrafts(
  sb: SB,
  ctx: ToolExecutionContext,
  events: PrepareEventArgs[],
  logContext: AiLogContext,
  orgSlug: string | null
): Promise<{
  state: "missing_fields" | "needs_batch_confirmation";
  pending_actions?: Array<{
    id: string;
    action_type: string;
    payload: CreateEventPendingPayload;
    expires_at: string;
    summary: { title: string; description: string };
  }>;
  validation_errors?: Array<{
    index: number;
    missing_fields: string[];
    draft: Record<string, unknown>;
  }>;
}> {
  const { pendingActions, validationErrors } = await createEventPendingActionsFromDrafts(
    sb,
    ctx,
    events,
    logContext,
    orgSlug
  );

  if (pendingActions.length === 0) {
    return {
      state: "missing_fields",
      validation_errors: validationErrors,
    };
  }

  return {
    state: "needs_batch_confirmation",
    pending_actions: pendingActions,
    validation_errors: validationErrors.length > 0 ? validationErrors : undefined,
  };
}

function sanitizeDraftValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeAssistantDraft(
  args: z.infer<typeof prepareJobPostingSchema>
): z.infer<typeof prepareJobPostingSchema> {
  const stringFields = [
    "title", "company", "location", "description",
    "application_url", "contact_email", "industry",
  ] as const;

  const overrides: Record<string, string> = {};
  for (const field of stringFields) {
    const sanitized = sanitizeDraftValue(args[field]);
    if (sanitized) {
      overrides[field] = sanitized;
    }
  }

  return { ...args, ...overrides };
}

function mergeDrafts<T extends Record<string, unknown>>(primary: T, secondary: Partial<T>): T {
  const merged = { ...secondary, ...primary };
  return Object.fromEntries(
    Object.entries(merged).filter(
      ([, value]) => !(typeof value === "string" && value.trim().length === 0)
    )
  ) as T;
}

function hasPreparedJobRequirements(
  draft: Partial<z.infer<typeof prepareJobPostingSchema>>
): boolean {
  const hasRequiredFields = REQUIRED_PREPARED_JOB_FIELDS.every((field) => {
    const value = draft[field];
    return typeof value === "string" && value.trim().length > 0;
  });

  if (!hasRequiredFields) {
    return false;
  }

  const hasApplicationUrl =
    typeof draft.application_url === "string" && draft.application_url.trim().length > 0;
  const hasContactEmail =
    typeof draft.contact_email === "string" && draft.contact_email.trim().length > 0;

  return hasApplicationUrl || hasContactEmail;
}

async function prepareJobPosting(
  sb: SB,
  ctx: ToolExecutionContext,
  args: z.infer<typeof prepareJobPostingSchema>
): Promise<ToolExecutionResult> {
  const logContext = buildLogContext(ctx);
  if (!ctx.threadId) {
    return toolError("Job preparation requires a thread context");
  }

  const parsedDraft = assistantJobDraftSchema.safeParse(normalizeAssistantDraft(args));
  if (!parsedDraft.success) {
    return toolError("Invalid job draft");
  }

  let sourceDraft: Partial<z.infer<typeof prepareJobPostingSchema>> = {};
  let sourceWarning: string | null = null;
  if (parsedDraft.data.application_url && !hasPreparedJobRequirements(parsedDraft.data)) {
    try {
      sourceDraft = await fetchJobSourceDraft(parsedDraft.data.application_url);
    } catch (error) {
      if (error instanceof JobSourceIntakeError) {
        sourceWarning = error.message;
      }
      if (!(error instanceof JobSourceIntakeError)) {
        return toolError("Unable to read the job posting URL");
      }
    }
  }

  const mergedDraft = mergeDrafts(parsedDraft.data, sourceDraft);
  const missingFields = REQUIRED_PREPARED_JOB_FIELDS.filter((field) => {
    const value = mergedDraft[field];
    return typeof value !== "string" || value.trim().length === 0;
  });

  const hasApplicationUrl =
    typeof mergedDraft.application_url === "string" && mergedDraft.application_url.trim().length > 0;
  const hasContactEmail =
    typeof mergedDraft.contact_email === "string" && mergedDraft.contact_email.trim().length > 0;
  if (!hasApplicationUrl && !hasContactEmail) {
    missingFields.push("application_url");
  }

  if (missingFields.length > 0) {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: Array.from(new Set(missingFields)),
        draft: mergedDraft,
        sourced_fields: Object.keys(sourceDraft),
        ...(sourceWarning ? { source_warning: sourceWarning } : {}),
      },
    };
  }

  const prepared = assistantPreparedJobSchema.safeParse(mergedDraft);
  if (!prepared.success) {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: prepared.error.issues.map((issue) => issue.path.join(".") || "body"),
        draft: mergedDraft,
        sourced_fields: Object.keys(sourceDraft),
        ...(sourceWarning ? { source_warning: sourceWarning } : {}),
      },
    };
  }

  const { data: org, error: orgError } = await sb
    .from("organizations")
    .select("slug")
    .eq("id", ctx.orgId)
    .maybeSingle();

  if (orgError) {
    aiLog("warn", "ai-tools", "prepare_job_posting org lookup failed", logContext, {
      error: getSafeErrorMessage(orgError),
    });
    return toolError("Failed to load organization context");
  }

  const pendingPayload: CreateJobPostingPendingPayload = {
    ...prepared.data,
    orgSlug: typeof org?.slug === "string" ? org.slug : null,
  };
  const pendingAction = await createPendingAction(sb, {
    organizationId: ctx.orgId,
    userId: ctx.userId,
    threadId: ctx.threadId,
    actionType: "create_job_posting",
    payload: pendingPayload,
  });
  const summary = buildPendingActionSummary(pendingAction);

  return {
    kind: "ok",
    data: {
      state: "needs_confirmation",
      draft: prepared.data,
      pending_action: {
        id: pendingAction.id,
        action_type: pendingAction.action_type,
        payload: pendingPayload,
        expires_at: pendingAction.expires_at,
        summary,
      },
      sourced_fields: Object.keys(sourceDraft),
    },
  };
}

async function prepareAnnouncement(
  sb: SB,
  ctx: ToolExecutionContext,
  args: z.infer<typeof prepareAnnouncementSchema>
): Promise<ToolExecutionResult> {
  const logContext = buildLogContext(ctx);
  if (!ctx.threadId) {
    return toolError("Announcement preparation requires a thread context");
  }

  const normalizedDraft = {
    ...Object.fromEntries(
      Object.entries({
        ...args,
        title: sanitizeDraftValue(args.title),
        body: sanitizeDraftValue(args.body),
      }).filter(([, value]) => value !== undefined)
    ),
    audience: args.audience ?? "all",
    is_pinned: args.is_pinned ?? false,
    send_notification: args.send_notification ?? false,
  };

  const parsedDraft = assistantAnnouncementDraftSchema.safeParse(normalizedDraft);
  if (!parsedDraft.success) {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: parsedDraft.error.issues.map((issue) => issue.path.join(".") || "body"),
        draft: normalizedDraft,
      },
    };
  }

  const missingFields = REQUIRED_PREPARED_ANNOUNCEMENT_FIELDS.filter((field) => {
    const value = parsedDraft.data[field];
    return typeof value !== "string" || value.trim().length === 0;
  });

  if (missingFields.length > 0) {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: missingFields,
        draft: parsedDraft.data,
      },
    };
  }

  const prepared = assistantPreparedAnnouncementSchema.safeParse(parsedDraft.data);
  if (!prepared.success) {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: prepared.error.issues.map((issue) => issue.path.join(".") || "body"),
        draft: parsedDraft.data,
      },
    };
  }

  const { data: org, error: orgError } = await sb
    .from("organizations")
    .select("slug")
    .eq("id", ctx.orgId)
    .maybeSingle();

  if (orgError) {
    aiLog("warn", "ai-tools", "prepare_announcement org lookup failed", logContext, {
      error: getSafeErrorMessage(orgError),
    });
    return toolError("Failed to load organization context");
  }

  const pendingPayload: CreateAnnouncementPendingPayload = {
    ...prepared.data,
    orgSlug: typeof org?.slug === "string" ? org.slug : null,
  };
  const pendingAction = await createPendingAction(sb, {
    organizationId: ctx.orgId,
    userId: ctx.userId,
    threadId: ctx.threadId,
    actionType: "create_announcement",
    payload: pendingPayload,
  });
  const summary = buildPendingActionSummary(pendingAction);

  return {
    kind: "ok",
    data: {
      state: "needs_confirmation",
      draft: prepared.data,
      pending_action: {
        id: pendingAction.id,
        action_type: pendingAction.action_type,
        payload: pendingPayload,
        expires_at: pendingAction.expires_at,
        summary,
      },
    },
  };
}

async function prepareEnterpriseInvite(
  sb: SB,
  ctx: ToolExecutionContext,
  args: z.infer<typeof prepareEnterpriseInviteSchema>,
): Promise<ToolExecutionResult> {
  const logContext = buildLogContext(ctx);
  if (!ctx.threadId) {
    return toolError("Enterprise invite preparation requires a thread context");
  }
  if (!ctx.enterpriseId) {
    return toolError("This assistant does not have enterprise context for this thread.");
  }

  const missingFields: string[] = [];
  if (!args.role) {
    missingFields.push("role");
  }

  if (args.role === "active_member" && !args.organization_id && !args.organization_query) {
    missingFields.push("organization_id");
  }

  if (missingFields.length > 0) {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: missingFields,
        draft: args,
      },
    };
  }

  let organizationId: string | null = args.organization_id ?? null;
  let organizationName: string | null = null;

  if (organizationId) {
    const { data: org, error: orgError } = await sb
      .from("organizations")
      .select("id, name")
      .eq("id", organizationId)
      .eq("enterprise_id", ctx.enterpriseId)
      .maybeSingle();
    if (orgError) {
      aiLog("warn", "ai-tools", "prepare_enterprise_invite org lookup failed", logContext, {
        error: getSafeErrorMessage(orgError),
      });
      return toolError("Failed to resolve managed organization");
    }
    if (!org) {
      return toolError("Managed organization not found for this enterprise.");
    }
    organizationName = typeof org.name === "string" ? org.name : null;
  } else if (args.organization_query) {
    const sanitized = sanitizeIlikeInput(args.organization_query);
    const { data: orgs, error: orgError } = await sb
      .from("organizations")
      .select("id, name, slug")
      .eq("enterprise_id", ctx.enterpriseId)
      .or(`name.ilike.%${sanitized}%,slug.ilike.%${sanitized}%`)
      .limit(2);
    if (orgError) {
      return toolError("Failed to search managed organizations");
    }
    const rows = Array.isArray(orgs) ? orgs : [];
    if (rows.length === 0) {
      return toolError("No managed organization matched that name or slug.");
    }
    if (rows.length > 1) {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: ["organization_id"],
          draft: args,
          candidates: rows.map((row: { id: string; name: string; slug: string }) => ({
            id: row.id,
            name: row.name,
            slug: row.slug,
          })),
        },
      };
    }
    organizationId = rows[0].id as string;
    organizationName = rows[0].name as string;
  }

  const { data: enterprise, error: entError } = await sb
    .from("enterprises")
    .select("slug")
    .eq("id", ctx.enterpriseId)
    .maybeSingle();
  if (entError || !enterprise?.slug) {
    return toolError("Failed to load enterprise context");
  }

  const pendingPayload: CreateEnterpriseInvitePendingPayload = {
    enterpriseId: ctx.enterpriseId,
    enterpriseSlug: String(enterprise.slug),
    role: args.role as "admin" | "active_member" | "alumni",
    organizationId,
    organizationName,
    usesRemaining: args.uses_remaining ?? null,
    expiresAt: args.expires_at ?? null,
  };

  const pendingAction = await createPendingAction(sb, {
    organizationId: ctx.orgId,
    userId: ctx.userId,
    threadId: ctx.threadId,
    actionType: "create_enterprise_invite",
    payload: pendingPayload,
  });
  const summary = buildPendingActionSummary(pendingAction);

  return {
    kind: "ok",
    data: {
      state: "needs_confirmation",
      draft: pendingPayload,
      pending_action: {
        id: pendingAction.id,
        action_type: pendingAction.action_type,
        payload: pendingPayload,
        expires_at: pendingAction.expires_at,
        summary,
      },
    },
  };
}

async function revokeEnterpriseInvite(
  sb: SB,
  ctx: ToolExecutionContext,
  args: z.infer<typeof revokeEnterpriseInviteSchema>,
): Promise<ToolExecutionResult> {
  if (!ctx.threadId) {
    return toolError("Enterprise invite revocation requires a thread context");
  }
  if (!ctx.enterpriseId) {
    return toolError("This assistant does not have enterprise context for this thread.");
  }

  const inviteIdInput = typeof args.invite_id === "string" ? args.invite_id : null;
  const inviteCodeInput = typeof args.invite_code === "string" ? args.invite_code : null;

  let query = sb
    .from("enterprise_invites")
    .select("id, code, role, organization_id, revoked_at")
    .eq("enterprise_id", ctx.enterpriseId);
  if (inviteIdInput) {
    query = query.eq("id", inviteIdInput);
  } else if (inviteCodeInput) {
    query = query.eq("code", inviteCodeInput);
  } else {
    return toolError("Provide invite_id or invite_code to revoke an invite.");
  }

  const { data: invite, error: inviteError } = await query.maybeSingle();
  if (inviteError) {
    return toolError("Failed to look up enterprise invite");
  }
  if (!invite) {
    return toolError("Enterprise invite not found.");
  }
  if (invite.revoked_at) {
    return toolError("This enterprise invite is already revoked.");
  }

  const { data: enterprise, error: entError } = await sb
    .from("enterprises")
    .select("slug")
    .eq("id", ctx.enterpriseId)
    .maybeSingle();
  if (entError || !enterprise?.slug) {
    return toolError("Failed to load enterprise context");
  }

  const pendingPayload: RevokeEnterpriseInvitePendingPayload = {
    enterpriseId: ctx.enterpriseId,
    enterpriseSlug: String(enterprise.slug),
    inviteId: String(invite.id),
    inviteCode: typeof invite.code === "string" ? invite.code : "",
    role: typeof invite.role === "string" ? invite.role : null,
    organizationId: typeof invite.organization_id === "string" ? invite.organization_id : null,
  };

  const pendingAction = await createPendingAction(sb, {
    organizationId: ctx.orgId,
    userId: ctx.userId,
    threadId: ctx.threadId,
    actionType: "revoke_enterprise_invite",
    payload: pendingPayload,
  });
  const summary = buildPendingActionSummary(pendingAction);

  return {
    kind: "ok",
    data: {
      state: "needs_confirmation",
      draft: pendingPayload,
      pending_action: {
        id: pendingAction.id,
        action_type: pendingAction.action_type,
        payload: pendingPayload,
        expires_at: pendingAction.expires_at,
        summary,
      },
    },
  };
}

async function prepareDiscussionThread(
  sb: SB,
  ctx: ToolExecutionContext,
  args: z.infer<typeof prepareDiscussionThreadSchema>
): Promise<ToolExecutionResult> {
  const logContext = buildLogContext(ctx);
  if (!ctx.threadId) {
    return toolError("Discussion preparation requires a thread context");
  }

  const parsedDraft = assistantDiscussionDraftSchema.safeParse(args);
  if (!parsedDraft.success) {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: parsedDraft.error.issues.map((issue) => issue.path.join(".") || "body"),
        draft: args,
      },
    };
  }

  const missingFields: string[] = [];
  if (!parsedDraft.data.title) missingFields.push("title");
  if (!parsedDraft.data.body) missingFields.push("body");

  if (missingFields.length > 0) {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: missingFields,
        draft: parsedDraft.data,
      },
    };
  }

  const prepared = assistantPreparedDiscussionSchema.safeParse(parsedDraft.data);
  if (!prepared.success) {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: prepared.error.issues.map((issue) => issue.path.join(".") || "body"),
        draft: parsedDraft.data,
      },
    };
  }

  const { data: org, error: orgError } = await sb
    .from("organizations")
    .select("slug")
    .eq("id", ctx.orgId)
    .maybeSingle();

  if (orgError) {
    aiLog("warn", "ai-tools", "prepare_discussion_thread org lookup failed", logContext, {
      error: getSafeErrorMessage(orgError),
    });
    return toolError("Failed to load organization context");
  }

  const pendingPayload: CreateDiscussionThreadPendingPayload = {
    ...prepared.data,
    orgSlug: typeof org?.slug === "string" ? org.slug : null,
  };
  const pendingAction = await createPendingAction(sb, {
    organizationId: ctx.orgId,
    userId: ctx.userId,
    threadId: ctx.threadId,
    actionType: "create_discussion_thread",
    payload: pendingPayload,
  });
  const summary = buildPendingActionSummary(pendingAction);

  return {
    kind: "ok",
    data: {
      state: "needs_confirmation",
      draft: prepared.data,
      pending_action: {
        id: pendingAction.id,
        action_type: pendingAction.action_type,
        payload: pendingPayload,
        expires_at: pendingAction.expires_at,
        summary,
      },
    },
  };
}

async function prepareDiscussionReply(
  sb: SB,
  ctx: ToolExecutionContext,
  args: z.infer<typeof prepareDiscussionReplySchema>
): Promise<ToolExecutionResult> {
  const logContext = buildLogContext(ctx);
  if (!ctx.threadId) {
    return toolError("Discussion reply preparation requires a thread context");
  }

  const normalizedDraft = {
    ...Object.fromEntries(
      Object.entries({
        ...args,
        thread_title: sanitizeDraftValue(args.thread_title),
        body: sanitizeDraftValue(args.body),
      }).filter(([, value]) => value !== undefined)
    ),
  };
  const parsedDraft = assistantDiscussionReplyDraftSchema.safeParse(normalizedDraft);
  if (!parsedDraft.success) {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: parsedDraft.error.issues.map((issue) => issue.path.join(".") || "body"),
        draft: normalizedDraft,
      },
    };
  }

  const missingFields: string[] = [];
  if (!parsedDraft.data.discussion_thread_id) missingFields.push("discussion_thread_id");
  if (!parsedDraft.data.body) missingFields.push("body");

  if (missingFields.length > 0) {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: missingFields,
        draft: parsedDraft.data,
      },
    };
  }

  const prepared = assistantPreparedDiscussionReplySchema.safeParse(parsedDraft.data);
  if (!prepared.success) {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: prepared.error.issues.map((issue) => issue.path.join(".") || "body"),
        draft: parsedDraft.data,
      },
    };
  }

  const { data: org, error: orgError } = await sb
    .from("organizations")
    .select("slug")
    .eq("id", ctx.orgId)
    .maybeSingle();

  if (orgError) {
    aiLog("warn", "ai-tools", "prepare_discussion_reply org lookup failed", logContext, {
      error: getSafeErrorMessage(orgError),
    });
    return toolError("Failed to load organization context");
  }

  const pendingPayload: CreateDiscussionReplyPendingPayload = {
    ...prepared.data,
    orgSlug: typeof org?.slug === "string" ? org.slug : null,
  };
  const pendingAction = await createPendingAction(sb, {
    organizationId: ctx.orgId,
    userId: ctx.userId,
    threadId: ctx.threadId,
    actionType: "create_discussion_reply",
    payload: pendingPayload,
  });
  const summary = buildPendingActionSummary(pendingAction);

  return {
    kind: "ok",
    data: {
      state: "needs_confirmation",
      draft: prepared.data,
      pending_action: {
        id: pendingAction.id,
        action_type: pendingAction.action_type,
        payload: pendingPayload,
        expires_at: pendingAction.expires_at,
        summary,
      },
    },
  };
}

async function prepareChatMessage(
  sb: SB,
  ctx: ToolExecutionContext,
  args: z.infer<typeof prepareChatMessageSchema>
): Promise<ToolExecutionResult> {
  const logContext = buildLogContext(ctx);
  if (!ctx.threadId) {
    return toolError("Chat message preparation requires a thread context");
  }

  const normalizedDraft = {
    ...Object.fromEntries(
      Object.entries({
        recipient_member_id: args.recipient_member_id,
        person_query: sanitizeDraftValue(args.person_query),
        body: sanitizeDraftValue(args.body),
      }).filter(([, value]) => value !== undefined)
    ),
  };

  const parsedDraft = assistantChatMessageDraftSchema.safeParse(normalizedDraft);
  if (!parsedDraft.success) {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: parsedDraft.error.issues.map((issue) => issue.path.join(".") || "body"),
        draft: normalizedDraft,
      },
    };
  }

  const recipientResolution = await resolveChatMessageRecipient(sb as DirectChatSupabase, {
    organizationId: ctx.orgId,
    senderUserId: ctx.userId,
    recipientMemberId: parsedDraft.data.recipient_member_id,
    personQuery: parsedDraft.data.person_query,
  });

  if (recipientResolution.kind === "recipient_required") {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: [
          ...(parsedDraft.data.body ? [] : ["body"]),
          "person_query",
        ],
        clarification_kind: "recipient_required",
        draft: parsedDraft.data,
      },
    };
  }

  if (recipientResolution.kind === "ambiguous") {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: [
          ...(parsedDraft.data.body ? [] : ["body"]),
          "person_query",
        ],
        clarification_kind: "recipient_ambiguous",
        requested_recipient: recipientResolution.requestedRecipient,
        candidate_recipients: recipientResolution.candidateRecipients,
        draft: parsedDraft.data,
      },
    };
  }

  if (recipientResolution.kind === "unavailable") {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: parsedDraft.data.body ? [] : ["body"],
        clarification_kind: "recipient_unavailable",
        requested_recipient: recipientResolution.requestedRecipient ?? null,
        unavailable_reason: recipientResolution.reason,
        draft: parsedDraft.data,
      },
    };
  }

  const draftWithResolvedRecipient = {
    ...parsedDraft.data,
    recipient_member_id: recipientResolution.memberId,
  };

  if (!parsedDraft.data.body) {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: ["body"],
        draft: draftWithResolvedRecipient,
      },
    };
  }

  const prepared = assistantPreparedChatMessageSchema.safeParse({
    recipient_member_id: recipientResolution.memberId,
    recipient_user_id: recipientResolution.userId,
    recipient_display_name: recipientResolution.displayName,
    body: parsedDraft.data.body,
    existing_chat_group_id: recipientResolution.existingChatGroupId ?? undefined,
  });

  if (!prepared.success) {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: prepared.error.issues.map((issue) => issue.path.join(".") || "body"),
        draft: draftWithResolvedRecipient,
      },
    };
  }

  const { data: org, error: orgError } = await sb
    .from("organizations")
    .select("slug")
    .eq("id", ctx.orgId)
    .maybeSingle();

  if (orgError) {
    aiLog("warn", "ai-tools", "prepare_chat_message org lookup failed", logContext, {
      error: getSafeErrorMessage(orgError),
    });
    return toolError("Failed to load organization context");
  }

  const pendingPayload: SendChatMessagePendingPayload = {
    ...prepared.data,
    orgSlug: typeof org?.slug === "string" ? org.slug : null,
  };
  const pendingAction = await createPendingAction(sb, {
    organizationId: ctx.orgId,
    userId: ctx.userId,
    threadId: ctx.threadId,
    actionType: "send_chat_message",
    payload: pendingPayload,
  });
  const summary = buildPendingActionSummary(pendingAction);

  return {
    kind: "ok",
    data: {
      state: "needs_confirmation",
      draft: draftWithResolvedRecipient,
      pending_action: {
        id: pendingAction.id,
        action_type: pendingAction.action_type,
        payload: pendingPayload,
        expires_at: pendingAction.expires_at,
        summary,
      },
    },
  };
}

async function listChatGroups(
  sb: SB,
  ctx: ToolExecutionContext,
  args: z.infer<typeof listChatGroupsSchema>,
  logContext: AiLogContext
): Promise<ToolExecutionResult> {
  const limit = Math.min(args.limit ?? 25, 50);
  const { data, error } = await listUserChatGroups(sb as GroupChatSupabase, {
    organizationId: ctx.orgId,
    userId: ctx.userId,
    limit,
  });

  if (error) {
    aiLog("warn", "ai-tools", "list_chat_groups failed", logContext, {
      error: getSafeErrorMessage(error),
    });
    return toolError("Failed to load chat groups");
  }

  return {
    kind: "ok",
    data: (data ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description,
      role: group.role,
      updated_at: group.updated_at,
    })),
  };
}

async function prepareGroupMessage(
  sb: SB,
  ctx: ToolExecutionContext,
  args: z.infer<typeof prepareGroupMessageSchema>
): Promise<ToolExecutionResult> {
  const logContext = buildLogContext(ctx);
  if (!ctx.threadId) {
    return toolError("Group message preparation requires a thread context");
  }

  const normalizedDraft = {
    ...Object.fromEntries(
      Object.entries({
        chat_group_id: args.chat_group_id,
        group_name_query: sanitizeDraftValue(args.group_name_query),
        body: sanitizeDraftValue(args.body),
      }).filter(([, value]) => value !== undefined)
    ),
  };

  const parsedDraft = assistantGroupMessageDraftSchema.safeParse(normalizedDraft);
  if (!parsedDraft.success) {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: parsedDraft.error.issues.map((issue) => issue.path.join(".") || "body"),
        draft: normalizedDraft,
      },
    };
  }

  const groupResolution = await resolveGroupChatTarget(sb as GroupChatSupabase, {
    organizationId: ctx.orgId,
    userId: ctx.userId,
    chatGroupId: parsedDraft.data.chat_group_id,
    groupNameQuery: parsedDraft.data.group_name_query,
  });

  if (groupResolution.kind === "group_required") {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: [
          ...(parsedDraft.data.body ? [] : ["body"]),
          "group_name_query",
        ],
        clarification_kind: "group_required",
        draft: parsedDraft.data,
      },
    };
  }

  if (groupResolution.kind === "ambiguous") {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: [
          ...(parsedDraft.data.body ? [] : ["body"]),
          "group_name_query",
        ],
        clarification_kind: "group_ambiguous",
        requested_group: groupResolution.requestedGroup,
        candidate_groups: groupResolution.candidateGroups,
        draft: parsedDraft.data,
      },
    };
  }

  if (groupResolution.kind === "unavailable") {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: parsedDraft.data.body ? [] : ["body"],
        clarification_kind: "group_unavailable",
        requested_group: groupResolution.requestedGroup ?? null,
        unavailable_reason: groupResolution.reason,
        draft: parsedDraft.data,
      },
    };
  }

  const draftWithResolvedGroup = {
    ...parsedDraft.data,
    chat_group_id: groupResolution.chatGroupId,
  };

  if (!parsedDraft.data.body) {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: ["body"],
        draft: draftWithResolvedGroup,
      },
    };
  }

  const prepared = assistantPreparedGroupMessageSchema.safeParse({
    chat_group_id: groupResolution.chatGroupId,
    group_name: groupResolution.groupName,
    message_status: groupResolution.messageStatus,
    body: parsedDraft.data.body,
  });

  if (!prepared.success) {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: prepared.error.issues.map((issue) => issue.path.join(".") || "body"),
        draft: draftWithResolvedGroup,
      },
    };
  }

  const { data: org, error: orgError } = await sb
    .from("organizations")
    .select("slug")
    .eq("id", ctx.orgId)
    .maybeSingle();

  if (orgError) {
    aiLog("warn", "ai-tools", "prepare_group_message org lookup failed", logContext, {
      error: getSafeErrorMessage(orgError),
    });
    return toolError("Failed to load organization context");
  }

  const pendingPayload: SendGroupChatMessagePendingPayload = {
    ...prepared.data,
    orgSlug: typeof org?.slug === "string" ? org.slug : null,
  };
  const pendingAction = await createPendingAction(sb, {
    organizationId: ctx.orgId,
    userId: ctx.userId,
    threadId: ctx.threadId,
    actionType: "send_group_chat_message",
    payload: pendingPayload,
  });
  const summary = buildPendingActionSummary(pendingAction);

  return {
    kind: "ok",
    data: {
      state: "needs_confirmation",
      draft: draftWithResolvedGroup,
      pending_action: {
        id: pendingAction.id,
        action_type: pendingAction.action_type,
        payload: pendingPayload,
        expires_at: pendingAction.expires_at,
        summary,
      },
    },
  };
}

async function prepareEvent(
  sb: SB,
  ctx: ToolExecutionContext,
  args: z.infer<typeof prepareEventSchema>
): Promise<ToolExecutionResult> {
  const logContext = buildLogContext(ctx);
  if (!ctx.threadId) {
    return toolError("Event preparation requires a thread context");
  }

  // Normalize empty strings to undefined (LLM often sends "")
  const normalized = Object.fromEntries(
    Object.entries(args).filter(
      ([, v]) => !(typeof v === "string" && v.trim().length === 0)
    )
  ) as typeof args;

  const draftWithDefaults = {
    ...normalized,
    event_type: normalized.event_type ?? "general",
    is_philanthropy: normalized.is_philanthropy ?? normalized.event_type === "philanthropy",
  };

  const parsedDraft = assistantEventDraftSchema.safeParse(draftWithDefaults);
  if (!parsedDraft.success) {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: parsedDraft.error.issues.map((issue) => issue.path.join(".") || "body"),
        draft: draftWithDefaults,
      },
    };
  }

  const missingFields = REQUIRED_PREPARED_EVENT_FIELDS.filter((field) => {
    const value = parsedDraft.data[field];
    return typeof value !== "string" || value.trim().length === 0;
  });

  if (missingFields.length > 0) {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: missingFields,
        draft: parsedDraft.data,
      },
    };
  }

  const prepared = assistantPreparedEventSchema.safeParse(parsedDraft.data);
  if (!prepared.success) {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        missing_fields: prepared.error.issues.map((issue) => issue.path.join(".") || "body"),
        draft: parsedDraft.data,
      },
    };
  }

  const { data: org, error: orgError } = await sb
    .from("organizations")
    .select("slug")
    .eq("id", ctx.orgId)
    .maybeSingle();

  if (orgError) {
    aiLog("warn", "ai-tools", "prepare_event org lookup failed", logContext, {
      error: getSafeErrorMessage(orgError),
    });
    return toolError("Failed to load organization context");
  }

  const pendingPayload: CreateEventPendingPayload = {
    ...prepared.data,
    orgSlug: typeof org?.slug === "string" ? org.slug : null,
  };
  const pendingAction = await createPendingAction(sb, {
    organizationId: ctx.orgId,
    userId: ctx.userId,
    threadId: ctx.threadId,
    actionType: "create_event",
    payload: pendingPayload,
  });
  const summary = buildPendingActionSummary(pendingAction);

  return {
    kind: "ok",
    data: {
      state: "needs_confirmation",
      draft: prepared.data,
      pending_action: {
        id: pendingAction.id,
        action_type: pendingAction.action_type,
        payload: pendingPayload,
        expires_at: pendingAction.expires_at,
        summary,
      },
    },
  };
}

async function prepareEventsBatch(
  sb: SB,
  ctx: ToolExecutionContext,
  args: z.infer<typeof prepareEventsBatchSchema>
): Promise<ToolExecutionResult> {
  const logContext = buildLogContext(ctx);
  if (!ctx.threadId) {
    return toolError("Event preparation requires a thread context");
  }

  // Look up org slug once for all events
  const { data: org, error: orgError } = await sb
    .from("organizations")
    .select("slug")
    .eq("id", ctx.orgId)
    .maybeSingle();

  if (orgError) {
    aiLog("warn", "ai-tools", "prepare_events_batch org lookup failed", logContext, {
      error: getSafeErrorMessage(orgError),
    });
    return toolError("Failed to load organization context");
  }

  const orgSlug = typeof org?.slug === "string" ? org.slug : null;
  return {
    kind: "ok",
    data: await buildPendingEventBatchFromDrafts(
      sb,
      ctx,
      args.events,
      logContext,
      orgSlug
    ),
  };
}

async function scrapeScheduleWebsite(
  sb: SB,
  ctx: ToolExecutionContext,
  args: z.infer<typeof scrapeScheduleWebsiteSchema>
): Promise<ToolExecutionResult> {
  const logContext = buildLogContext(ctx);
  if (!ctx.threadId) {
    return toolError("Event preparation requires a thread context");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(args.url);
  } catch {
    return toolError("Invalid schedule website URL");
  }

  if (parsedUrl.protocol !== "https:") {
    return toolError("Schedule website URL must use HTTPS");
  }

  const { data: org, error: orgError } = await sb
    .from("organizations")
    .select("slug, name")
    .eq("id", ctx.orgId)
    .maybeSingle();

  if (orgError) {
    aiLog("warn", "ai-tools", "scrape_schedule_website org lookup failed", logContext, {
      error: getSafeErrorMessage(orgError),
    });
    return toolError("Failed to load organization context");
  }

  let response: Awaited<ReturnType<typeof fetchUrlSafe>>;
  try {
    response = await fetchUrlSafe(args.url, {
      timeoutMs: SCRAPE_SCHEDULE_FETCH_TIMEOUT_MS,
      maxBytes: SCRAPE_SCHEDULE_MAX_BYTES,
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain",
      },
      orgId: ctx.orgId,
      userId: ctx.userId,
      supabase: sb,
      allowlistMode: "enforce",
    });
  } catch (error) {
    if (error instanceof ScheduleSecurityError) {
      return toolError(error.message);
    }

    aiLog("warn", "ai-tools", "scrape_schedule_website fetch failed", logContext, {
      error: getSafeErrorMessage(error),
    });
    return toolError("Unable to fetch schedule website");
  }

  const load = await getCheerioLoad();
  const $ = load(response.text);
  $("script, style, nav, footer").remove();

  const main = $("main").first();
  const text = normalizeScrapedScheduleText((main.length ? main : $("body")).text());
  const { extractScheduleFromText } = await getScheduleExtractionModule();
  const extracted = await extractScheduleFromText(text, {
    orgName: typeof org?.name === "string" ? org.name : undefined,
    sourceType: "website",
    sourceLabel: response.finalUrl,
    now: new Date().toISOString(),
  });

  if (extracted.events.length === 0) {
    return {
      kind: "ok",
      data: {
        state: "no_events_found",
        source_url: args.url,
      },
    };
  }

  const { pendingActions, validationErrors } = await createEventPendingActionsFromDrafts(
    sb,
    ctx,
    extracted.events,
    logContext,
    typeof org?.slug === "string" ? org.slug : null
  );

  if (pendingActions.length === 0) {
    return {
      kind: "ok",
      data: {
        state: "missing_fields",
        validation_errors: validationErrors,
      },
    };
  }

  return {
    kind: "ok",
    data: {
      state: "needs_batch_confirmation",
      pending_actions: pendingActions,
      validation_errors: validationErrors.length > 0 ? validationErrors : undefined,
    },
  };
}

async function extractSchedulePdf(
  sb: SB,
  ctx: ToolExecutionContext,
  args: z.infer<typeof extractSchedulePdfSchema>
): Promise<ToolExecutionResult> {
  void args;
  const logContext = buildLogContext(ctx);
  if (!ctx.threadId) {
    return toolError("Event preparation requires a thread context");
  }

  if (
    !ctx.attachment ||
    (ctx.attachment.mimeType !== "application/pdf"
      && !SCHEDULE_IMAGE_MIME_TYPES.has(ctx.attachment.mimeType as ScheduleImageMimeType))
  ) {
    return toolError("Schedule attachment required", "attachment_required");
  }
  const attachment = ctx.attachment;

  if (!isOwnedScheduleUploadPath(ctx.orgId, ctx.userId, attachment.storagePath)) {
    aiLog("warn", "ai-tools", "extract_schedule_pdf invalid storage path", logContext, {
      storagePath: attachment.storagePath,
    });
    return toolError("Invalid schedule attachment path", "invalid_attachment_path");
  }

  const { data: org, error: orgError } = await sb
    .from("organizations")
    .select("slug, name")
    .eq("id", ctx.orgId)
    .maybeSingle();

  if (orgError) {
    aiLog("warn", "ai-tools", "extract_schedule_pdf org lookup failed", logContext, {
      error: getSafeErrorMessage(orgError),
    });
    return toolError("Failed to load organization context", "org_context_failed");
  }

  try {
    const { data: attachmentFile, error: downloadError } = await sb.storage
      .from(SCHEDULE_UPLOAD_BUCKET)
      .download(attachment.storagePath);

    if (downloadError || !attachmentFile) {
      aiLog("warn", "ai-tools", "extract_schedule_pdf download failed", logContext, {
        error: getSafeErrorMessage(downloadError),
        storagePath: attachment.storagePath,
      });
      return toolError("Unable to load attached schedule file", "attachment_unavailable");
    }

    const attachmentBuffer = Buffer.from(await attachmentFile.arrayBuffer());
    const extractionContext = {
      orgName: typeof org?.name === "string" ? org.name : undefined,
      sourceLabel: attachment.fileName,
      now: new Date().toISOString(),
    };

    if (attachment.mimeType !== "application/pdf" && attachmentBuffer.byteLength > MAX_SOURCE_IMAGE_BYTES) {
      return toolError(
        `Image too large for extraction (${Math.round(attachmentBuffer.byteLength / 1024 / 1024)}MB). Maximum is 2MB.`,
        "image_too_large"
      );
    }

    let extracted: ScheduleExtractionResult;

    try {
      extracted =
        attachment.mimeType === "application/pdf"
          ? await extractScheduleTextFromPdfBuffer(attachmentBuffer, ctx, logContext, extractionContext)
          : await (async () => {
              const { extractScheduleFromImage } = await getScheduleExtractionModule();
              const imageUrl = await createSignedScheduleUploadUrl(
                sb,
                attachment.storagePath,
                logContext
              );
              return extractScheduleFromImage(
                {
                  url: imageUrl,
                  mimeType: attachment.mimeType as ScheduleImageMimeType,
                },
                {
                  ...extractionContext,
                  sourceType: "image",
                }
              );
            })();
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }

      if (attachment.mimeType === "application/pdf") {
        return toolError("Unable to read attached PDF", "pdf_unreadable");
      }

      if (isScheduleImageConfigurationError(error)) {
        aiLog("warn", "ai-tools", "extract_schedule_pdf image configuration invalid", logContext, {
          error: getSafeErrorMessage(error),
          storagePath: attachment.storagePath,
          mimeType: attachment.mimeType,
        });
        return toolError(
          "Schedule image extraction is misconfigured. Set ZAI_IMAGE_MODEL to a Z.AI vision model such as glm-5v-turbo.",
          "image_model_misconfigured"
        );
      }

      aiLog("warn", "ai-tools", "extract_schedule_pdf image extraction failed", logContext, {
        error: getSafeErrorMessage(error),
        storagePath: attachment.storagePath,
        mimeType: attachment.mimeType,
      });
      return toolError("Unable to read attached schedule image", "image_unreadable");
    }

    if (extracted.diagnostics) {
      aiLog("info", "ai-tools", "extract_schedule_pdf extraction completed", logContext, {
        storagePath: attachment.storagePath,
        mimeType: attachment.mimeType,
        strategy: extracted.diagnostics.strategy,
        cleanedLineCount: extracted.diagnostics.cleaned_line_count,
        parsedRowCount: extracted.diagnostics.parsed_row_count,
        candidateRowCount: extracted.diagnostics.candidate_row_count,
      });
    }

    const extractionValidationErrors = extracted.rejected_rows ?? [];

    if (extracted.events.length === 0 && extractionValidationErrors.length === 0) {
      return {
        kind: "ok",
        data: {
          state: "no_events_found",
          source_file: attachment.fileName,
        },
      };
    }

    const { pendingActions, validationErrors } = await createEventPendingActionsFromDrafts(
      sb,
      ctx,
      extracted.events,
      logContext,
      typeof org?.slug === "string" ? org.slug : null
    );
    const allValidationErrors = [...extractionValidationErrors, ...validationErrors];

    if (pendingActions.length === 0) {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          validation_errors: allValidationErrors,
        },
      };
    }

    return {
      kind: "ok",
      data: {
        state: "needs_batch_confirmation",
        pending_actions: pendingActions,
        validation_errors: allValidationErrors.length > 0 ? allValidationErrors : undefined,
      },
    };
  } finally {
    await deleteScheduleUpload(sb, attachment.storagePath, logContext);
  }
}

async function extractScheduleTextFromPdfBuffer(
  pdfBuffer: Buffer,
  ctx: ToolExecutionContext,
  logContext: AiLogContext,
  extractionContext: {
    orgName?: string;
    sourceLabel: string;
    now: string;
  }
): Promise<ScheduleExtractionResult> {
  let text = "";
  let parser: InstanceType<PdfParseCtor> | null = null;

  try {
    const PDFParse = await getPdfParseCtor();
    parser = new PDFParse({ data: pdfBuffer });
    const result = await parser.getText();
    text = result.text;
  } catch (error) {
    aiLog("warn", "ai-tools", "extract_schedule_pdf parsing failed", logContext, {
      error: getSafeErrorMessage(error),
      storagePath: ctx.attachment?.storagePath,
    });
    throw new Error("Unable to read attached PDF");
  } finally {
    if (parser) {
      await parser.destroy().catch(() => undefined);
    }
  }

  const { extractScheduleFromText } = await getScheduleExtractionModule();
  return extractScheduleFromText(text, {
    ...extractionContext,
    sourceType: "pdf",
  });
}

async function deleteScheduleUpload(
  sb: SB,
  storagePath: string,
  logContext: AiLogContext
): Promise<void> {
  try {
    const { error } = await sb.storage.from(SCHEDULE_UPLOAD_BUCKET).remove([storagePath]);

    if (error) {
      aiLog("warn", "ai-tools", "extract_schedule_pdf cleanup failed", logContext, {
        error: getSafeErrorMessage(error),
        storagePath,
      });
    }
  } catch (error) {
    aiLog("warn", "ai-tools", "extract_schedule_pdf cleanup failed", logContext, {
      error: getSafeErrorMessage(error),
      storagePath,
    });
  }
}

async function createSignedScheduleUploadUrl(
  sb: SB,
  storagePath: string,
  logContext: AiLogContext
): Promise<string> {
  const storageBucket = sb.storage.from(SCHEDULE_UPLOAD_BUCKET);

  if (typeof storageBucket.createSignedUrl !== "function") {
    throw new Error("Signed URLs are unavailable for schedule uploads");
  }

  const { data, error } = await storageBucket.createSignedUrl(storagePath, 60);
  const signedUrl =
    data && typeof data === "object" && "signedUrl" in data && typeof data.signedUrl === "string"
      ? data.signedUrl
      : null;

  if (error || !signedUrl) {
    aiLog("warn", "ai-tools", "extract_schedule_pdf signed url failed", logContext, {
      error: getSafeErrorMessage(error),
      storagePath,
    });
    throw new Error("Unable to create schedule image URL");
  }

  return signedUrl;
}

async function getOrgStats(
  sb: SB,
  orgId: string,
  logContext: AiLogContext
): Promise<ToolExecutionResult> {
  const [members, alumni, parents, upcomingEvents, donations] = await Promise.all([
    safeToolCount(logContext, () =>
      sb
        .from("members")
        .select("*", { count: "estimated", head: true })
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .eq("status", "active")
    ),
    safeToolCount(logContext, () =>
      sb
        .from("alumni")
        .select("*", { count: "estimated", head: true })
        .eq("organization_id", orgId)
        .is("deleted_at", null)
    ),
    safeToolCount(logContext, () =>
      sb
        .from("parents")
        .select("*", { count: "estimated", head: true })
        .eq("organization_id", orgId)
        .is("deleted_at", null)
    ),
    safeToolCount(logContext, () =>
      sb
        .from("events")
        .select("*", { count: "estimated", head: true })
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .gte("start_date", new Date().toISOString())
    ),
    safeToolQuery(logContext, () =>
      sb
        .from("organization_donation_stats")
        .select("total_amount_cents, donation_count, last_donation_at")
        .eq("organization_id", orgId)
        .maybeSingle()
    ),
  ]);

  if (!members.ok || !alumni.ok || !parents.ok || !upcomingEvents.ok || donations.kind !== "ok") {
    return toolError("Query failed");
  }

  return {
    kind: "ok",
    data: {
      active_members: members.count,
      alumni: alumni.count,
      parents: parents.count,
      upcoming_events: upcomingEvents.count,
      donations: donations.data,
    },
  };
}

async function findNavigationTargets(
  sb: SB,
  orgId: string,
  args: z.infer<typeof findNavigationTargetsSchema>,
  logContext: AiLogContext
): Promise<ToolExecutionResult> {
  return safeToolQuery(logContext, async () => {
    const [orgResult, subscriptionResult] = await Promise.all([
      sb
        .from("organizations")
        .select("slug, nav_config")
        .eq("id", orgId)
        .maybeSingle(),
      sb.rpc("get_subscription_status", { p_org_id: orgId }),
    ]);

    const { data: org, error } = orgResult;
    if (error || !org?.slug) {
      return { data: null, error: error ?? new Error("Organization not found") };
    }

    const { data: subscriptionRows, error: subscriptionError } = subscriptionResult;

    const subscription = subscriptionError
      ? null
      : Array.isArray(subscriptionRows)
        ? subscriptionRows[0]
        : null;
    const hasAlumniAccess =
      subscription?.status === "enterprise_managed" ||
      (subscription?.alumni_bucket != null && subscription.alumni_bucket !== "none");
    const hasParentsAccess =
      subscription?.status === "enterprise_managed" ||
      (subscription?.parents_bucket != null && subscription.parents_bucket !== "none");

    return {
      data: searchNavigationTargets({
        query: args.query,
        orgSlug: org.slug,
        navConfig:
          org.nav_config && typeof org.nav_config === "object" && !Array.isArray(org.nav_config)
            ? (org.nav_config as NavConfig)
            : null,
        role: "admin",
        hasAlumniAccess,
        hasParentsAccess,
        limit: args.limit,
      }),
      error: null,
    };
  });
}

async function runSuggestConnections(
  sb: SB,
  orgId: string,
  args: z.infer<typeof suggestConnectionsSchema>,
  logContext: AiLogContext
): Promise<ToolExecutionResult> {
  const {
    suggestConnections,
    SuggestConnectionsLookupError,
  } = await import("@/lib/falkordb/suggestions");

  try {
    const data = await suggestConnections({
      orgId,
      serviceSupabase: sb,
      args,
    });

    return {
      kind: "ok",
      data,
    };
  } catch (error) {
    if (error instanceof SuggestConnectionsLookupError) {
      return toolError(error.message);
    }

    if (isStageTimeoutError(error)) {
      throw error;
    }

    aiLog("warn", "ai-tools", "suggest_connections failed", logContext, {
      error: getSafeErrorMessage(error),
    });
    return toolError("Unexpected error");
  }
}

async function verifyExecutorAccess(
  ctx: ToolExecutionContext
): Promise<{ kind: "allowed" } | Extract<ToolExecutionResult, { kind: "forbidden" | "auth_error" }>> {
  const logContext = buildLogContext(ctx);
  try {
    const { data: membership, error } = await (ctx.serviceSupabase as SB)
      .from("user_organization_roles")
      .select("role, status")
      .eq("user_id", ctx.userId)
      .eq("organization_id", ctx.orgId)
      .maybeSingle();

    if (error) {
      aiLog("warn", "ai-tools", "auth check failed", logContext, {
        error: getSafeErrorMessage(error),
      });
      return { kind: "auth_error", error: "Auth check failed" };
    }

    const membershipRow = membership as MembershipRow | null;
    if (
      !membershipRow ||
      membershipRow.role !== "admin" ||
      membershipRow.status !== "active"
    ) {
      return { kind: "forbidden", error: "Forbidden" };
    }

    return { kind: "allowed" };
  } catch (err) {
    aiLog("warn", "ai-tools", "auth check failed", logContext, {
      error: getSafeErrorMessage(err),
    });
    return { kind: "auth_error", error: "Auth check failed" };
  }
}

export function getToolAuthorizationMode(
  authorization: ToolExecutionAuthorization
): AiToolAuthMode {
  return authorization.kind === "preverified_admin"
    ? "reused_verified_admin"
    : "db_lookup";
}

export async function executeToolCall(
  ctx: ToolExecutionContext,
  call: { name: string; args: unknown }
): Promise<ToolExecutionResult> {
  const logContext = buildLogContext(ctx);
  if (!TOOL_NAMES.has(call.name)) {
    return toolError(`Unknown tool: ${call.name}`);
  }
  const toolName = call.name as ToolName;

  const validation = validateArgs(toolName, call.args);
  if (!validation.valid) return toolError(validation.error);
  const args = validation.args;

  if (ctx.authorization.kind === "verify_membership") {
    const access = await verifyExecutorAccess(ctx);
    if (access.kind !== "allowed") {
      return access;
    }
  }

  if (ENTERPRISE_TOOL_NAMES.has(toolName)) {
    if (!ctx.enterpriseId || !ctx.enterpriseRole) {
      return toolError("This assistant does not have enterprise context for this thread.");
    }
    if (BILLING_ONLY_ENTERPRISE_TOOLS.has(toolName)) {
      const permissions = getEnterprisePermissions(ctx.enterpriseRole);
      if (!permissions.canManageBilling) {
        return toolError(
          "This tool requires an enterprise owner or billing admin role.",
          "enterprise_billing_role_required",
        );
      }
    }
    if (ENTERPRISE_INVITE_TOOLS.has(toolName)) {
      if (ctx.enterpriseRole !== "owner" && ctx.enterpriseRole !== "org_admin") {
        return toolError(
          "This tool requires an enterprise owner or org admin role.",
          "enterprise_invite_role_required",
        );
      }
    }
  }

  const sb = ctx.serviceSupabase;

  try {
    const timeoutMs =
      toolName === "scrape_schedule_website"
        ? EXTRACTION_TOOL_TIMEOUT_MS
        : toolName === "extract_schedule_pdf"
        ? isScheduleImageAttachment(ctx.attachment)
          ? IMAGE_EXTRACTION_TOOL_TIMEOUT_MS
          : PDF_EXTRACTION_TOOL_TIMEOUT_MS
        : toolName === "prepare_events_batch"
        ? TOOL_EXECUTION_TIMEOUT_MS * 3
        : TOOL_EXECUTION_TIMEOUT_MS;
    return await withStageTimeout(`tool_${toolName}`, timeoutMs, async () => {
      switch (toolName) {
        case "list_members":
          return listMembers(sb, ctx.orgId, args as z.infer<typeof listMembersSchema>, logContext);
        case "list_events":
          return listEvents(sb, ctx.orgId, args as z.infer<typeof listEventsSchema>, logContext);
        case "list_announcements":
          return listAnnouncements(
            sb,
            ctx.orgId,
            args as z.infer<typeof listAnnouncementsSchema>,
            logContext
          );
        case "list_discussions":
          return listDiscussions(
            sb,
            ctx.orgId,
            args as z.infer<typeof listDiscussionsSchema>,
            logContext
          );
        case "list_job_postings":
          return listJobPostings(
            sb,
            ctx.orgId,
            args as z.infer<typeof listJobPostingsSchema>,
            logContext
          );
        case "list_chat_groups":
          return listChatGroups(
            sb,
            ctx,
            args as z.infer<typeof listChatGroupsSchema>,
            logContext
          );
        case "list_alumni":
          return listAlumni(
            sb,
            ctx.orgId,
            args as z.infer<typeof listAlumniSchema>,
            logContext
          );
        case "list_enterprise_alumni":
          return safeToolQuery(logContext, () =>
            listEnterpriseAlumni(
              sb,
              ctx.enterpriseId!,
              args as z.infer<typeof listEnterpriseAlumniSchema>,
            )
          );
        case "list_donations":
          return listDonations(
            sb,
            ctx.orgId,
            args as z.infer<typeof listDonationsSchema>,
            logContext
          );
        case "list_parents":
          return listParents(
            sb,
            ctx.orgId,
            args as z.infer<typeof listParentsSchema>,
            logContext
          );
        case "list_philanthropy_events":
          return listPhilanthropyEvents(
            sb,
            ctx.orgId,
            args as z.infer<typeof listPhilanthropyEventsSchema>,
            logContext
          );
        case "list_managed_orgs":
          return safeToolQuery(logContext, () => listManagedOrgs(sb, ctx.enterpriseId!));
        case "list_enterprise_audit_events":
          return safeToolQuery(logContext, () =>
            listEnterpriseAuditEvents(
              sb,
              ctx.enterpriseId!,
              args as z.infer<typeof listEnterpriseAuditEventsSchema>,
            )
          );
        case "prepare_enterprise_invite":
          return prepareEnterpriseInvite(
            sb,
            ctx,
            args as z.infer<typeof prepareEnterpriseInviteSchema>,
          );
        case "revoke_enterprise_invite":
          return revokeEnterpriseInvite(
            sb,
            ctx,
            args as z.infer<typeof revokeEnterpriseInviteSchema>,
          );
        case "prepare_announcement":
          return prepareAnnouncement(
            sb,
            ctx,
            args as z.infer<typeof prepareAnnouncementSchema>
          );
        case "prepare_job_posting":
          return prepareJobPosting(
            sb,
            ctx,
            args as z.infer<typeof prepareJobPostingSchema>
          );
        case "prepare_chat_message":
          return prepareChatMessage(
            sb,
            ctx,
            args as z.infer<typeof prepareChatMessageSchema>
          );
        case "prepare_group_message":
          return prepareGroupMessage(
            sb,
            ctx,
            args as z.infer<typeof prepareGroupMessageSchema>
          );
        case "prepare_discussion_reply":
          return prepareDiscussionReply(
            sb,
            ctx,
            args as z.infer<typeof prepareDiscussionReplySchema>
          );
        case "prepare_discussion_thread":
          return prepareDiscussionThread(
            sb,
            ctx,
            args as z.infer<typeof prepareDiscussionThreadSchema>
          );
        case "prepare_event":
          return prepareEvent(
            sb,
            ctx,
            args as z.infer<typeof prepareEventSchema>
          );
        case "prepare_events_batch":
          return prepareEventsBatch(
            sb,
            ctx,
            args as z.infer<typeof prepareEventsBatchSchema>
          );
        case "scrape_schedule_website":
          return scrapeScheduleWebsite(
            sb,
            ctx,
            args as z.infer<typeof scrapeScheduleWebsiteSchema>
          );
        case "extract_schedule_pdf":
          return extractSchedulePdf(
            sb,
            ctx,
            args as z.infer<typeof extractSchedulePdfSchema>
          );
        case "get_org_stats":
          return getOrgStats(sb, ctx.orgId, logContext);
        case "get_enterprise_stats":
          return safeToolQuery(logContext, () => getEnterpriseStats(sb, ctx.enterpriseId!));
        case "get_enterprise_quota":
          return safeToolQuery(logContext, () => getEnterpriseQuota(sb, ctx.enterpriseId!));
        case "get_enterprise_org_capacity":
          return safeToolQuery(logContext, () => getEnterpriseOrgCapacity(sb, ctx.enterpriseId!));
        case "suggest_connections":
          return runSuggestConnections(
            sb,
            ctx.orgId,
            args as z.infer<typeof suggestConnectionsSchema>,
            logContext
          );
        case "find_navigation_targets":
          return findNavigationTargets(
            sb,
            ctx.orgId,
            args as z.infer<typeof findNavigationTargetsSchema>,
            logContext
          );
      }
    });
  } catch (err) {
    if (isStageTimeoutError(err)) {
      if (toolName === "extract_schedule_pdf" && isScheduleImageAttachment(ctx.attachment)) {
        return toolError("Schedule image extraction timed out", "image_timeout");
      }
      if (toolName === "extract_schedule_pdf" && ctx.attachment?.mimeType === "application/pdf") {
        return toolError("Schedule PDF extraction timed out", "pdf_timeout");
      }
      return { kind: "timeout", error: "Tool timed out" };
    }
    aiLog("warn", "ai-tools", "unexpected error", logContext, {
      error: getSafeErrorMessage(err),
    });
    return toolError("Unexpected error");
  }
}

function normalizeScrapedScheduleText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
