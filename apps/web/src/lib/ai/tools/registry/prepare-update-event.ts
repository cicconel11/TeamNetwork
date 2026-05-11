import type { z } from "zod";
import { assistantPreparedEventSchema } from "@/lib/schemas/events-ai";
import {
  createOrRevisePendingAction,
  type UpdateEventPendingPayload,
} from "@/lib/ai/pending-actions";
import { aiLog } from "@/lib/ai/logger";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import { toolError } from "@/lib/ai/tools/result";
import { prepareUpdateEventSchema } from "@/lib/ai/tools/prepare-schemas";
import {
  buildPendingActionField,
  pendingActionFailureToToolError,
  sanitizeDraftValue,
} from "@/lib/ai/tools/prepare-tool-helpers";
import type { ToolModule } from "./types";

type Args = z.infer<typeof prepareUpdateEventSchema>;

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  location: string | null;
  event_type: string | null;
  is_philanthropy: boolean | null;
  recurrence_group_id: string | null;
}

interface EventQuery {
  select(columns: string): EventFilter;
}

interface EventFilter {
  eq(column: string, value: string): EventFilter;
  is(column: string, value: null): EventFilter;
  ilike(column: string, pattern: string): EventFilter;
  limit(count: number): Promise<{ data: EventRow[] | null; error: unknown }>;
  maybeSingle(): Promise<{ data: EventRow | null; error: unknown }>;
}

interface EventLookupClient {
  from(table: "events"): EventQuery;
}

function splitIso(value: string | null): { date?: string; time?: string } {
  if (!value) return {};
  const [date, rawTime] = value.split("T");
  return { date, time: rawTime?.slice(0, 5) };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveEvent(sb: unknown, orgId: string, args: Args) {
  const client = sb as EventLookupClient;
  if (args.event_id && UUID_PATTERN.test(args.event_id)) {
    const { data, error } = await client
      .from("events")
      .select("id, title, description, start_date, end_date, location, event_type, is_philanthropy, recurrence_group_id")
      .eq("id", args.event_id)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return { kind: "error" as const, error };
    return data ? { kind: "resolved" as const, row: data } : { kind: "missing" as const };
  }

  const fallbackId =
    args.event_id && !UUID_PATTERN.test(args.event_id) ? args.event_id.trim() : undefined;
  const query = args.event_query?.trim() || fallbackId;
  if (!query) return { kind: "missing" as const };
  const { data, error } = await client
    .from("events")
    .select("id, title, description, start_date, end_date, location, event_type, is_philanthropy, recurrence_group_id")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .ilike("title", `%${query}%`)
    .limit(5);
  if (error) return { kind: "error" as const, error };
  const rows = data ?? [];
  if (rows.length === 1) return { kind: "resolved" as const, row: rows[0] };
  if (rows.length > 1) return { kind: "ambiguous" as const, candidates: rows };
  return { kind: "missing" as const };
}

export const prepareUpdateEventModule: ToolModule<Args> = {
  name: "prepare_update_event",
  argsSchema: prepareUpdateEventSchema,
  async execute(args, { ctx, sb, logContext }) {
    if (!ctx.threadId) return toolError("Event edits require a thread context");

    const resolution = await resolveEvent(sb, ctx.orgId, args);
    if (resolution.kind === "error") {
      aiLog("warn", "ai-tools", "prepare_update_event lookup failed", logContext, {
        error: getSafeErrorMessage(resolution.error),
      });
      return toolError("Failed to load event");
    }
    if (resolution.kind === "missing" || resolution.kind === "ambiguous") {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: ["event_id"],
          draft: { event_id: args.event_id, event_query: args.event_query },
          ...(resolution.kind === "ambiguous"
            ? { candidates: resolution.candidates.map((event) => ({ id: event.id, title: event.title, start_date: event.start_date })) }
            : {}),
        },
      };
    }

    const existing = resolution.row;
    if (args.update_scope === "all_in_series") {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: ["update_scope"],
          draft: { ...args, event_id: existing.id, title: existing.title },
        },
      };
    }

    const previousStart = splitIso(existing.start_date);
    const previousEnd = splitIso(existing.end_date);
    const draft = {
      title: sanitizeDraftValue(args.title) ?? existing.title,
      description:
        args.description !== undefined ? args.description.trim() : existing.description ?? undefined,
      start_date: sanitizeDraftValue(args.start_date) ?? previousStart.date,
      start_time: sanitizeDraftValue(args.start_time) ?? previousStart.time,
      end_date: args.end_date !== undefined ? args.end_date.trim() : previousEnd.date ?? "",
      end_time: args.end_time !== undefined ? args.end_time.trim() : previousEnd.time ?? "",
      location: args.location !== undefined ? args.location.trim() : existing.location ?? undefined,
      event_type: args.event_type ?? existing.event_type ?? "general",
      is_philanthropy:
        args.is_philanthropy ?? existing.is_philanthropy ?? existing.event_type === "philanthropy",
    };

    const prepared = assistantPreparedEventSchema.safeParse(draft);
    if (!prepared.success) {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: prepared.error.issues.map((issue) => issue.path.join(".") || "body"),
          draft,
        },
      };
    }

    const { data: org, error: orgError } = await sb
      .from("organizations")
      .select("slug")
      .eq("id", ctx.orgId)
      .maybeSingle();
    if (orgError) return toolError("Failed to load organization context");

    const pendingPayload: UpdateEventPendingPayload = {
      ...prepared.data,
      event_id: existing.id,
      update_scope: args.update_scope === "this_and_future" ? "this_and_future" : "this_only",
      orgSlug: typeof org?.slug === "string" ? org.slug : null,
      previous_title: existing.title,
      previous_description: existing.description,
      previous_start_date: previousStart.date ?? null,
      previous_start_time: previousStart.time ?? null,
      previous_end_date: previousEnd.date ?? null,
      previous_end_time: previousEnd.time ?? null,
      previous_location: existing.location,
      previous_event_type: existing.event_type,
      previous_is_philanthropy: existing.is_philanthropy,
    };

    const created = await createOrRevisePendingAction(sb, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      threadId: ctx.threadId,
      actionType: "update_event",
      payload: pendingPayload,
      activeActionId: ctx.activePendingActionId,
    });
    if ("failed" in created) return pendingActionFailureToToolError(created.reason);

    return {
      kind: "ok",
      data: {
        state: "needs_confirmation",
        draft: prepared.data,
        pending_action: buildPendingActionField(created, pendingPayload),
      },
    };
  },
};
