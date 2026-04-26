import { type PendingActionRecord } from "@/lib/ai/pending-actions";
import type { ServiceSupabase } from "@/lib/supabase/types";
import { getNonEmptyString } from "./formatters/index";
import {
  extractStructuredFieldMap,
  normalizeBooleanFlag,
  normalizeEventType,
} from "./draft-session";
import { DIRECT_QUERY_START_PATTERN } from "./pass1-tools";
import type { PendingActionToolPayload } from "./discussion-reply";

export type PendingEventActionRecord = PendingActionRecord<"create_event">;

export type PendingEventRevisionAnalysis =
  | { kind: "none" }
  | { kind: "clarify"; message: string }
  | { kind: "unsupported_event_type"; requestedType: string }
  | {
      kind: "apply";
      targetIndexes: number[];
      overrides: Record<string, unknown>;
    };

export async function listPendingEventActionsForThread(
  supabase: ServiceSupabase,
  input: {
    organizationId: string;
    userId: string;
    threadId: string;
  }
): Promise<PendingEventActionRecord[]> {
  const { data, error } = await supabase
    .from("ai_pending_actions")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("user_id", input.userId)
    .eq("thread_id", input.threadId)
    .eq("action_type", "create_event")
    .eq("status", "pending");

  if (error) {
    throw new Error("Failed to load pending event actions");
  }

  if (!Array.isArray(data)) {
    return [];
  }

  return (data as unknown[]).filter(
    (row): row is PendingEventActionRecord =>
      row != null &&
      typeof row === "object" &&
      typeof (row as { id?: unknown }).id === "string" &&
      typeof (row as { thread_id?: unknown }).thread_id === "string" &&
      (row as { action_type?: unknown }).action_type === "create_event" &&
      (row as { payload?: unknown }).payload != null &&
      typeof (row as { payload?: unknown }).payload === "object"
  );
}

export function getPendingActionFromToolData(data: unknown) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as PendingActionToolPayload;
  if (payload.state !== "needs_confirmation" || !payload.pending_action) {
    return null;
  }

  const pending = payload.pending_action;
  if (
    typeof pending.id !== "string" ||
    typeof pending.action_type !== "string" ||
    typeof pending.expires_at !== "string" ||
    !pending.summary ||
    typeof pending.summary.title !== "string" ||
    typeof pending.summary.description !== "string" ||
    !pending.payload ||
    typeof pending.payload !== "object"
  ) {
    return null;
  }

  const reviseCount =
    typeof pending.revise_count === "number" ? pending.revise_count : null;
  const previousPayload =
    pending.previous_payload && typeof pending.previous_payload === "object"
      ? (pending.previous_payload as Record<string, unknown>)
      : null;

  return {
    actionId: pending.id,
    actionType: pending.action_type,
    expiresAt: pending.expires_at,
    summary: {
      title: pending.summary.title,
      description: pending.summary.description,
    },
    payload: pending.payload as Record<string, unknown>,
    reviseCount,
    previousPayload,
  };
}

export function getBatchPendingActionsFromToolData(data: unknown) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as { state?: string; pending_actions?: unknown[] };
  if (payload.state !== "needs_batch_confirmation" || !Array.isArray(payload.pending_actions)) {
    return null;
  }

  const actions: Array<{
    actionId: string;
    actionType: string;
    summary: { title: string; description: string };
    payload: Record<string, unknown>;
    expiresAt: string;
  }> = [];

  for (const pa of payload.pending_actions) {
    if (!pa || typeof pa !== "object") continue;
    const pending = pa as {
      id?: string;
      action_type?: string;
      expires_at?: string;
      summary?: { title?: string; description?: string };
      payload?: unknown;
    };
    if (
      typeof pending.id !== "string" ||
      typeof pending.action_type !== "string" ||
      typeof pending.expires_at !== "string" ||
      !pending.summary ||
      typeof pending.summary.title !== "string" ||
      typeof pending.summary.description !== "string" ||
      !pending.payload ||
      typeof pending.payload !== "object"
    ) {
      continue;
    }
    actions.push({
      actionId: pending.id,
      actionType: pending.action_type,
      expiresAt: pending.expires_at,
      summary: {
        title: pending.summary.title,
        description: pending.summary.description,
      },
      payload: pending.payload as Record<string, unknown>,
    });
  }

  return actions.length > 0 ? actions : null;
}

const PENDING_EVENT_BATCH_SCOPE_PATTERN =
  /\b(all|these|them|everything|every event|all events|all of them|all of these)\b/i;
const PENDING_EVENT_REVISION_CUE_PATTERN =
  /\b(actually|change|update|set|make|switch|move|rename|edit|correct|fix|should be|should actually be|title|description|location|category|type|event type|start date|start time|end date|end time)\b/i;
const PENDING_EVENT_SINGLE_SCOPE_PATTERNS = [
  { pattern: /\b(first|1st)\b/i, index: 0 },
  { pattern: /\b(second|2nd)\b/i, index: 1 },
  { pattern: /\b(third|3rd)\b/i, index: 2 },
] as const;
export const SUPPORTED_EVENT_TYPE_LABELS = [
  "general",
  "philanthropy",
  "game",
  "practice",
  "meeting",
  "social",
  "workout",
  "fundraiser",
  "class",
] as const;

export function extractPendingEventRevisionOverrides(
  message: string
): { overrides: Record<string, unknown>; unsupportedEventType?: string } {
  const overrides: Record<string, unknown> = {};
  const fields = extractStructuredFieldMap(message);

  const title = getNonEmptyString(fields.title);
  const description = getNonEmptyString(fields.description);
  const startDate = getNonEmptyString(fields["start date"]);
  const startTime = getNonEmptyString(fields["start time"]);
  const endDate = getNonEmptyString(fields["end date"]);
  const endTime = getNonEmptyString(fields["end time"]);
  const location = getNonEmptyString(fields.location);
  const isPhilanthropy = normalizeBooleanFlag(
    getNonEmptyString(fields["is philanthropy"] ?? fields.philanthropy) ?? undefined
  );

  if (title) overrides.title = title;
  if (description) overrides.description = description;
  if (startDate) overrides.start_date = startDate;
  if (startTime) overrides.start_time = startTime;
  if (endDate) overrides.end_date = endDate;
  if (endTime) overrides.end_time = endTime;
  if (location) overrides.location = location;
  if (typeof isPhilanthropy === "boolean") overrides.is_philanthropy = isPhilanthropy;

  const structuredEventType = getNonEmptyString(fields["event type"]) ?? undefined;
  const normalizedStructuredEventType = normalizeEventType(structuredEventType);
  if (normalizedStructuredEventType) {
    overrides.event_type = normalizedStructuredEventType;
  } else if (structuredEventType) {
    return { overrides, unsupportedEventType: structuredEventType.trim() };
  }

  const shorthandEventTypeMatch = message.match(
    /\b(?:these|they|this|it)\s+(?:are|is)\s+actually\s+([a-z]+)\b/i
  ) ?? message.match(
    /\b(?:change|update|set|make)\s+(?:the\s+)?(?:category|type|event type)\s+(?:to|as)\s+([a-z]+)\b/i
  ) ?? message.match(
    /\bmake\s+(?:these|them|this|it)\s+([a-z]+)\b/i
  );
  const shorthandEventType = shorthandEventTypeMatch?.[1]?.trim();

  if (!("event_type" in overrides) && shorthandEventType) {
    const normalizedShorthandEventType = normalizeEventType(shorthandEventType);
    if (normalizedShorthandEventType) {
      overrides.event_type = normalizedShorthandEventType;
    } else {
      return { overrides, unsupportedEventType: shorthandEventType };
    }
  }

  return { overrides };
}

export function resolvePendingEventRevisionAnalysis(
  message: string,
  actions: PendingEventActionRecord[]
): PendingEventRevisionAnalysis {
  if (actions.length === 0) {
    return { kind: "none" };
  }

  const { overrides, unsupportedEventType } = extractPendingEventRevisionOverrides(message);
  if (unsupportedEventType) {
    return { kind: "unsupported_event_type", requestedType: unsupportedEventType };
  }

  const trimmedMessage = message.trim();
  if (Object.keys(overrides).length === 0 && (trimmedMessage.endsWith("?") || DIRECT_QUERY_START_PATTERN.test(trimmedMessage))) {
    return { kind: "none" };
  }

  if (Object.keys(overrides).length === 0 && !PENDING_EVENT_REVISION_CUE_PATTERN.test(message)) {
    return { kind: "none" };
  }

  if (actions.length === 1) {
    return { kind: "apply", targetIndexes: [0], overrides };
  }

  if (PENDING_EVENT_BATCH_SCOPE_PATTERN.test(message)) {
    return {
      kind: "apply",
      targetIndexes: actions.map((_, index) => index),
      overrides,
    };
  }

  for (const candidate of PENDING_EVENT_SINGLE_SCOPE_PATTERNS) {
    if (candidate.pattern.test(message) && candidate.index < actions.length) {
      return {
        kind: "apply",
        targetIndexes: [candidate.index],
        overrides,
      };
    }
  }

  if (/\blast\b/i.test(message)) {
    return {
      kind: "apply",
      targetIndexes: [actions.length - 1],
      overrides,
    };
  }

  const normalizedMessage = message.toLowerCase();
  const titleMatches = actions
    .map((action, index) => ({
      index,
      title:
        typeof action.payload?.title === "string"
          ? action.payload.title.trim().toLowerCase()
          : null,
    }))
    .filter((entry): entry is { index: number; title: string } => Boolean(entry.title))
    .filter((entry) => normalizedMessage.includes(entry.title));

  if (titleMatches.length === 1) {
    return {
      kind: "apply",
      targetIndexes: [titleMatches[0].index],
      overrides,
    };
  }

  return {
    kind: "clarify",
    message: `I can revise these drafted events before confirmation. Should I apply that change to all ${actions.length} events, or which specific event should I update?`,
  };
}

export function buildPrepareEventArgsFromPendingAction(
  action: PendingEventActionRecord
): Record<string, unknown> {
  const eventDraft = { ...(action.payload as unknown as Record<string, unknown>) };
  delete eventDraft.orgSlug;
  return eventDraft;
}
