import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolName } from "./definitions";
import { TOOL_NAMES } from "./definitions";
import { getEnterprisePermissions, type EnterpriseRole } from "@/types/enterprise";
import { isToolAllowed, type AiActorRole } from "@/lib/ai/access-policy";
import {
  EXTRACTION_TOOL_TIMEOUT_MS,
  isStageTimeoutError,
  TOOL_EXECUTION_TIMEOUT_MS,
  withStageTimeout,
} from "@/lib/ai/timeout";
import type { AiToolAuthMode } from "@/lib/ai/chat-telemetry";
import { ScheduleSecurityError } from "@/lib/schedule-security/errors";
import { fetchUrlSafe } from "@/lib/schedule-security/fetchUrlSafe";
import { isOwnedScheduleUploadPath } from "@/lib/ai/schedule-upload-path";
import {
  createOrRevisePendingAction,
  type CreateEnterpriseInvitePendingPayload,
  type RevokeEnterpriseInvitePendingPayload,
} from "@/lib/ai/pending-actions";
import { aiLog, type AiLogContext } from "@/lib/ai/logger";
import { sanitizeIlikeInput } from "@/lib/security/validation";
import {
  buildPendingActionField,
  createEventPendingActionsFromDrafts,
  pendingActionFailureToToolError,
} from "@/lib/ai/tools/prepare-tool-helpers";
import type {
  ScheduleImageMimeType,
  ScheduleExtractionResult,
} from "@/lib/ai/schedule-extraction";
import { dispatchToolModule, getToolModule, isRegisteredTool } from "@/lib/ai/tools/registry";
import {
  toolError,
  type ToolExecutionResult,
} from "@/lib/ai/tools/result";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";

export type {
  ScheduleFileToolErrorCode,
  ToolExecutionErrorCode,
  ToolExecutionResult,
} from "@/lib/ai/tools/result";

export { buildPendingEventBatchFromDrafts } from "@/lib/ai/tools/prepare-tool-helpers";

export type ToolExecutionAuthorization =
  | {
      kind: "preverified_admin";
      source: "ai_org_context";
    }
  | {
      kind: "preverified_role";
      source: "ai_org_context";
      role: AiActorRole;
    }
  | { kind: "verify_membership" };

export interface ToolExecutionContext {
  orgId: string;
  userId: string;
  enterpriseId?: string;
  enterpriseRole?: EnterpriseRole;
  supabase?: SupabaseClient | null;
  serviceSupabase: SupabaseClient;
  authorization: ToolExecutionAuthorization;
  threadId?: string;
  requestId?: string;
  activePendingActionId?: string | null;
  attachment?: {
    storagePath: string;
    fileName: string;
    mimeType: string;
  };
}

const NON_ADMIN_RLS_READ_TOOL_NAMES: ReadonlySet<ToolName> = new Set<ToolName>([
  "list_announcements",
  "list_events",
  "list_discussions",
  "list_job_postings",
  "list_chat_groups",
  "list_philanthropy_events",
  "find_navigation_targets",
]);

const scrapeScheduleWebsiteSchema = z
  .object({
    url: z.string().url(),
  })
  .strict();
const extractSchedulePdfSchema = z.object({}).strict();

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
const ARG_SCHEMAS: Partial<Record<ToolName, z.ZodSchema>> = {
  prepare_enterprise_invite: prepareEnterpriseInviteSchema,
  revoke_enterprise_invite: revokeEnterpriseInviteSchema,
  scrape_schedule_website: scrapeScheduleWebsiteSchema,
  extract_schedule_pdf: extractSchedulePdfSchema,
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
  const schema = getToolModule(name)?.argsSchema ?? ARG_SCHEMAS[name];
  if (!schema) {
    return {
      valid: false,
      error: `No argument schema registered for ${name}`,
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: false,
      error: `Invalid tool arguments: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
    };
  }
  return { valid: true, args: parsed.data };
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

interface MembershipRow {
  role: string | null;
  status: string | null;
}

async function prepareEnterpriseInvite(
  sb: SB,
  ctx: ToolExecutionContext,
  args: z.infer<typeof prepareEnterpriseInviteSchema>
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

  const created = await createOrRevisePendingAction(sb, {
    organizationId: ctx.orgId,
    userId: ctx.userId,
    threadId: ctx.threadId,
    actionType: "create_enterprise_invite",
    payload: pendingPayload,
    activeActionId: ctx.activePendingActionId,
  });
  if ("failed" in created) return pendingActionFailureToToolError(created.reason);
  return {
    kind: "ok",
    data: {
      state: "needs_confirmation",
      draft: pendingPayload,
      pending_action: buildPendingActionField(created, pendingPayload),
    },
  };
}

async function revokeEnterpriseInvite(
  sb: SB,
  ctx: ToolExecutionContext,
  args: z.infer<typeof revokeEnterpriseInviteSchema>
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

  const created = await createOrRevisePendingAction(sb, {
    organizationId: ctx.orgId,
    userId: ctx.userId,
    threadId: ctx.threadId,
    actionType: "revoke_enterprise_invite",
    payload: pendingPayload,
    activeActionId: ctx.activePendingActionId,
  });
  if ("failed" in created) return pendingActionFailureToToolError(created.reason);
  return {
    kind: "ok",
    data: {
      state: "needs_confirmation",
      draft: pendingPayload,
      pending_action: buildPendingActionField(created, pendingPayload),
    },
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
  if (authorization.kind === "preverified_admin") return "reused_verified_admin";
  if (authorization.kind === "preverified_role") return "reused_verified_admin";
  return "db_lookup";
}

function resolvePolicyRoleForAuthorization(
  authorization: ToolExecutionAuthorization,
): { role: AiActorRole } {
  if (authorization.kind === "preverified_role") {
    return { role: authorization.role };
  }
  // verify_membership and preverified_admin both land here as "admin" because
  // verify_membership only allows admin rows through verifyExecutorAccess.
  return { role: "admin" };
}

function resolveToolClient(
  ctx: ToolExecutionContext,
  toolName: ToolName,
  actorRole: AiActorRole,
): SupabaseClient | null {
  if (actorRole !== "admin" && NON_ADMIN_RLS_READ_TOOL_NAMES.has(toolName)) {
    return ctx.supabase ?? null;
  }

  return ctx.serviceSupabase;
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

  // Centralized tool access policy — the single source of truth for what
  // each role can invoke, applied even if the model (or a caller) requests
  // a tool that wasn't attached to the turn.
  const policyActor = resolvePolicyRoleForAuthorization(ctx.authorization);
  const policyDecision = isToolAllowed({
    role: policyActor.role,
    enterpriseRole: ctx.enterpriseRole,
    toolName,
  });
  if (!policyDecision.allowed) {
    aiLog("info", "ai-tools", "tool blocked by access policy", logContext, {
      toolName,
      role: policyActor.role,
      reason: policyDecision.reason,
    });
    return { kind: "forbidden", error: "Forbidden" };
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

  const sb = resolveToolClient(ctx, toolName, policyActor.role);
  if (!sb) {
    aiLog("warn", "ai-tools", "auth-bound client unavailable for non-admin tool", logContext, {
      toolName,
      role: policyActor.role,
    });
    return { kind: "auth_error", error: "Auth check failed" };
  }

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
      if (isRegisteredTool(toolName)) {
        return dispatchToolModule(toolName, args, { ctx, sb, logContext });
      }
      switch (toolName) {
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
        default:
          // Registered tools dispatched above; remaining cases are exhaustive.
          // Throw rather than return so the catch surfaces unknown tool names.
          throw new Error(`Unhandled tool: ${toolName as string}`);
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
