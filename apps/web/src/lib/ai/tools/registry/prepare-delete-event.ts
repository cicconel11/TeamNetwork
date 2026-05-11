import type { z } from "zod";
import {
  createOrRevisePendingAction,
  type DeleteEventPendingPayload,
  type EventMutationScope,
} from "@/lib/ai/pending-actions";
import { aiLog } from "@/lib/ai/logger";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import { toolError } from "@/lib/ai/tools/result";
import { prepareDeleteEventSchema } from "@/lib/ai/tools/prepare-schemas";
import {
  buildPendingActionField,
  pendingActionFailureToToolError,
} from "@/lib/ai/tools/prepare-tool-helpers";
import type { ToolModule } from "./types";

type Args = z.infer<typeof prepareDeleteEventSchema>;

interface EventRow {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  location: string | null;
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveEvent(sb: unknown, orgId: string, args: Args) {
  const client = sb as EventLookupClient;
  if (args.event_id && UUID_PATTERN.test(args.event_id)) {
    const { data, error } = await client
      .from("events")
      .select("id, title, start_date, end_date, location, recurrence_group_id")
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
    .select("id, title, start_date, end_date, location, recurrence_group_id")
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

export const prepareDeleteEventModule: ToolModule<Args> = {
  name: "prepare_delete_event",
  argsSchema: prepareDeleteEventSchema,
  async execute(args, { ctx, sb, logContext }) {
    if (!ctx.threadId) return toolError("Event deletion requires a thread context");

    const resolution = await resolveEvent(sb, ctx.orgId, args);
    if (resolution.kind === "error") {
      aiLog("warn", "ai-tools", "prepare_delete_event lookup failed", logContext, {
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
    if (existing.recurrence_group_id && !args.delete_scope) {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: ["delete_scope"],
          draft: { event_id: existing.id, title: existing.title, recurring: true },
        },
      };
    }

    const { data: org, error: orgError } = await sb
      .from("organizations")
      .select("slug")
      .eq("id", ctx.orgId)
      .maybeSingle();
    if (orgError) return toolError("Failed to load organization context");

    const pendingPayload: DeleteEventPendingPayload = {
      event_id: existing.id,
      title: existing.title,
      start_date: existing.start_date,
      end_date: existing.end_date,
      location: existing.location,
      recurrence_group_id: existing.recurrence_group_id,
      delete_scope: (args.delete_scope ?? "this_only") as EventMutationScope,
      orgSlug: typeof org?.slug === "string" ? org.slug : null,
    };

    const created = await createOrRevisePendingAction(sb, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      threadId: ctx.threadId,
      actionType: "delete_event",
      payload: pendingPayload,
      activeActionId: ctx.activePendingActionId,
    });
    if ("failed" in created) return pendingActionFailureToToolError(created.reason);

    return {
      kind: "ok",
      data: {
        state: "needs_confirmation",
        draft: { event_id: existing.id, title: existing.title, delete_scope: pendingPayload.delete_scope },
        pending_action: buildPendingActionField(created, pendingPayload),
      },
    };
  },
};
