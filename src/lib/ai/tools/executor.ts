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
import { aiLog, type AiLogContext } from "@/lib/ai/logger";
import { dispatchToolModule, getToolModule } from "@/lib/ai/tools/registry";
import {
  toolError,
  type ToolExecutionResult,
} from "@/lib/ai/tools/result";
import { getSafeErrorMessage, isScheduleImageAttachment } from "@/lib/ai/tools/shared";

const IMAGE_EXTRACTION_TOOL_TIMEOUT_MS = 60_000;
const PDF_EXTRACTION_TOOL_TIMEOUT_MS = 60_000;

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
  const mod = getToolModule(name);
  if (!mod?.argsSchema) {
    return {
      valid: false,
      error: `No argument schema registered for ${name}`,
    };
  }
  const parsed = mod.argsSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: false,
      error: `Invalid tool arguments: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
    };
  }
  return { valid: true, args: parsed.data };
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

interface MembershipRow {
  role: string | null;
  status: string | null;
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
  authorization: ToolExecutionAuthorization
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
  actorRole: AiActorRole
): SupabaseClient | null {
  if (actorRole !== "admin" && NON_ADMIN_RLS_READ_TOOL_NAMES.has(toolName)) {
    return ctx.supabase ?? null;
  }

  return ctx.serviceSupabase;
}

function resolveToolTimeoutMs(toolName: ToolName, ctx: ToolExecutionContext): number {
  if (toolName === "scrape_schedule_website") {
    return EXTRACTION_TOOL_TIMEOUT_MS;
  }
  if (toolName === "extract_schedule_pdf") {
    return isScheduleImageAttachment(ctx.attachment)
      ? IMAGE_EXTRACTION_TOOL_TIMEOUT_MS
      : PDF_EXTRACTION_TOOL_TIMEOUT_MS;
  }
  if (toolName === "prepare_events_batch") {
    return TOOL_EXECUTION_TIMEOUT_MS * 3;
  }
  return TOOL_EXECUTION_TIMEOUT_MS;
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

  const timeoutMs = resolveToolTimeoutMs(toolName, ctx);

  try {
    return await withStageTimeout(`tool_${toolName}`, timeoutMs, async () =>
      dispatchToolModule(toolName, args, { ctx, sb, logContext })
    );
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

export interface ExecuteToolCallsOptions {
  /** Cap on simultaneously running tool calls. Must be >= 1. */
  maxInflight: number;
  /** Optional override for per-call execution (tests). Defaults to executeToolCall. */
  executeFn?: (
    ctx: ToolExecutionContext,
    call: { name: string; args: unknown },
  ) => Promise<ToolExecutionResult>;
}

function normalizeMaxInflight(maxInflight: number): number {
  if (!Number.isFinite(maxInflight)) return 1;
  return Math.max(1, Math.floor(maxInflight));
}

/**
 * Run N tool calls concurrently, capped at `maxInflight`. Results are returned
 * in input order regardless of completion order. Failures (and unexpected
 * throws) become `tool_error` rows; the batch never throws.
 *
 * Each call goes through the same `executeToolCall` path so per-tool timeout,
 * auth, validation, and policy checks behave identically to the serial path.
 */
export async function executeToolCalls(
  ctx: ToolExecutionContext,
  calls: ReadonlyArray<{ name: string; args: unknown }>,
  opts: ExecuteToolCallsOptions,
): Promise<ToolExecutionResult[]> {
  if (calls.length === 0) return [];
  const maxInflight = normalizeMaxInflight(opts.maxInflight);
  const runOne = opts.executeFn ?? executeToolCall;

  const results: ToolExecutionResult[] = new Array(calls.length);
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++;
      if (index >= calls.length) return;
      try {
        results[index] = await runOne(ctx, calls[index]);
      } catch (err) {
        // runOne already maps known failure modes to result rows. Defense-
        // in-depth: any throw from within still yields a result row so
        // siblings continue.
        results[index] = toolError(getSafeErrorMessage(err));
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(maxInflight, calls.length) },
    () => runWorker(),
  );
  await Promise.all(workers);

  return results;
}
