import { z } from "zod";
import type { PrepareEventArgs } from "@/lib/ai/tools/definitions";
import type { ToolExecutionContext } from "@/lib/ai/tools/executor";
import { type AssistantPreparedAnnouncement } from "@/lib/schemas/content";
import { type AssistantPreparedJob } from "@/lib/schemas/jobs";
import {
  assistantEventDraftSchema,
  assistantPreparedEventSchema,
} from "@/lib/schemas/events-ai";
import { aiLog, type AiLogContext } from "@/lib/ai/logger";
import {
  buildPendingActionSummary,
  createPendingAction,
  type CreateEventPendingPayload,
  type CreateOrReviseResult,
  type CreateOrReviseFailureReason,
  type PendingActionPayload,
  type PendingActionRecord,
} from "@/lib/ai/pending-actions";
import { toolError, type ToolExecutionResult } from "@/lib/ai/tools/result";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import { prepareJobPostingSchema } from "@/lib/ai/tools/prepare-schemas";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

export const REQUIRED_PREPARED_JOB_FIELDS: Array<keyof AssistantPreparedJob> = [
  "title",
  "company",
  "location",
  "industry",
  "experience_level",
  "description",
];
export const REQUIRED_PREPARED_ANNOUNCEMENT_FIELDS: Array<
  keyof AssistantPreparedAnnouncement
> = ["title"];
export const REQUIRED_PREPARED_EVENT_FIELDS = [
  "title",
  "start_date",
  "start_time",
] as const satisfies ReadonlyArray<keyof z.infer<typeof assistantPreparedEventSchema>>;

export interface EventPendingActionRecord {
  id: string;
  action_type: string;
  payload: CreateEventPendingPayload;
  expires_at: string;
  summary: { title: string; description: string };
}

export interface EventValidationErrorRecord {
  index: number;
  missing_fields: string[];
  draft: Record<string, unknown>;
}

export function buildPendingActionField(
  created: Extract<CreateOrReviseResult, { record: PendingActionRecord }>,
  payload: PendingActionPayload
) {
  return {
    id: created.record.id,
    action_type: created.record.action_type,
    payload,
    expires_at: created.record.expires_at,
    summary: buildPendingActionSummary(created.record),
    ...(created.revised
      ? {
          revise_count: created.reviseCount,
          previous_payload: created.previousPayload,
        }
      : {}),
  };
}

export function pendingActionFailureToToolError(
  reason: CreateOrReviseFailureReason
): ToolExecutionResult {
  switch (reason) {
    case "revise_limit":
      return toolError(
        "Maximum revisions reached for this draft. Please confirm or cancel it before making more changes.",
        "pending_action_revise_limit"
      );
    case "not_pending":
      return toolError(
        "That draft is no longer open for edits. Start a new request to create another draft.",
        "pending_action_not_pending"
      );
    case "not_found":
      return toolError(
        "That draft is no longer available. Start a new request to create another draft.",
        "pending_action_not_pending"
      );
    case "action_type_mismatch":
      return toolError(
        "That draft is for a different action type. Please confirm or cancel it before starting a new one.",
        "pending_action_not_pending"
      );
    case "conflict":
      return toolError(
        "Another revision landed first — please retry your edit.",
        "pending_action_conflict"
      );
  }
}

export async function createEventPendingActionsFromDrafts(
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

export function sanitizeDraftValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeAssistantDraft(
  args: z.infer<typeof prepareJobPostingSchema>
): z.infer<typeof prepareJobPostingSchema> {
  const stringFields = [
    "title",
    "company",
    "location",
    "description",
    "application_url",
    "contact_email",
    "industry",
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

export function mergeDrafts<T extends Record<string, unknown>>(
  primary: T,
  secondary: Partial<T>
): T {
  const merged = { ...secondary, ...primary };
  return Object.fromEntries(
    Object.entries(merged).filter(
      ([, value]) => !(typeof value === "string" && value.trim().length === 0)
    )
  ) as T;
}

export function hasPreparedJobRequirements(
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
