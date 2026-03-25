import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolName } from "./definitions";
import { TOOL_NAMES } from "./definitions";
import {
  isStageTimeoutError,
  TOOL_EXECUTION_TIMEOUT_MS,
  withStageTimeout,
} from "@/lib/ai/timeout";
import {
  suggestConnections,
  SuggestConnectionsLookupError,
} from "@/lib/falkordb/suggestions";

export interface ToolExecutionContext {
  orgId: string;
  userId: string;
  serviceSupabase: SupabaseClient;
}

export type ToolExecutionResult =
  | { kind: "ok"; data: unknown }
  | { kind: "forbidden"; error: "Forbidden" }
  | { kind: "auth_error"; error: "Auth check failed" }
  | { kind: "tool_error"; error: string }
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

const getOrgStatsSchema = z.object({}).strict();
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

const ARG_SCHEMAS: Record<ToolName, z.ZodSchema> = {
  list_members: listMembersSchema,
  list_events: listEventsSchema,
  get_org_stats: getOrgStatsSchema,
  suggest_connections: suggestConnectionsSchema,
};

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

function toolError(error: string): ToolExecutionResult {
  return { kind: "tool_error", error };
}

async function safeToolQuery(
  fn: () => Promise<{ data: unknown; error: unknown }>
): Promise<ToolExecutionResult> {
  try {
    const { data, error } = await fn();
    if (error) {
      console.warn("[ai-tools] query failed:", getSafeErrorMessage(error));
      return toolError("Query failed");
    }
    return { kind: "ok", data: data ?? [] };
  } catch (err) {
    if (isStageTimeoutError(err)) {
      throw err;
    }
    console.warn("[ai-tools] unexpected error:", getSafeErrorMessage(err));
    return toolError("Unexpected error");
  }
}

async function safeToolCount(
  fn: () => Promise<{ count: number | null; error: unknown }>
): Promise<CountResult> {
  try {
    const { count, error } = await fn();
    if (error || count === null) {
      if (error) {
        console.warn("[ai-tools] count query failed:", getSafeErrorMessage(error));
      } else {
        console.warn("[ai-tools] count query failed:", "count_unavailable");
      }
      return { ok: false, error: "Query failed" };
    }
    return { ok: true, count };
  } catch (err) {
    if (isStageTimeoutError(err)) {
      throw err;
    }
    console.warn("[ai-tools] unexpected count error:", getSafeErrorMessage(err));
    return { ok: false, error: "Unexpected error" };
  }
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
  args: z.infer<typeof listMembersSchema>
): Promise<ToolExecutionResult> {
  const limit = Math.min(args.limit ?? 20, 50);
  return safeToolQuery(async () => {
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
  args: z.infer<typeof listEventsSchema>
): Promise<ToolExecutionResult> {
  const limit = Math.min(args.limit ?? 10, 25);
  const upcoming = args.upcoming ?? true;
  const now = new Date().toISOString();
  return safeToolQuery(() => {
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

async function getOrgStats(sb: SB, orgId: string): Promise<ToolExecutionResult> {
  const [members, alumni, parents, upcomingEvents, donations] = await Promise.all([
    safeToolCount(() =>
      sb
        .from("members")
        .select("*", { count: "estimated", head: true })
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .eq("status", "active")
    ),
    safeToolCount(() =>
      sb
        .from("alumni")
        .select("*", { count: "estimated", head: true })
        .eq("organization_id", orgId)
        .is("deleted_at", null)
    ),
    safeToolCount(() =>
      sb
        .from("parents")
        .select("*", { count: "estimated", head: true })
        .eq("organization_id", orgId)
        .is("deleted_at", null)
    ),
    safeToolCount(() =>
      sb
        .from("events")
        .select("*", { count: "estimated", head: true })
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .gte("start_date", new Date().toISOString())
    ),
    safeToolQuery(() =>
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

async function runSuggestConnections(
  sb: SB,
  orgId: string,
  args: z.infer<typeof suggestConnectionsSchema>
): Promise<ToolExecutionResult> {
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

    console.warn("[ai-tools] suggest_connections failed:", getSafeErrorMessage(error));
    return toolError("Unexpected error");
  }
}

async function verifyExecutorAccess(
  ctx: ToolExecutionContext
): Promise<{ kind: "allowed" } | Extract<ToolExecutionResult, { kind: "forbidden" | "auth_error" }>> {
  try {
    const { data: membership, error } = await (ctx.serviceSupabase as SB)
      .from("user_organization_roles")
      .select("role, status")
      .eq("user_id", ctx.userId)
      .eq("organization_id", ctx.orgId)
      .maybeSingle();

    if (error) {
      console.warn("[ai-tools] auth check failed:", getSafeErrorMessage(error));
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
    console.warn("[ai-tools] auth check failed:", getSafeErrorMessage(err));
    return { kind: "auth_error", error: "Auth check failed" };
  }
}

export async function executeToolCall(
  ctx: ToolExecutionContext,
  call: { name: string; args: unknown }
): Promise<ToolExecutionResult> {
  if (!TOOL_NAMES.has(call.name)) {
    return toolError(`Unknown tool: ${call.name}`);
  }
  const toolName = call.name as ToolName;

  const validation = validateArgs(toolName, call.args);
  if (!validation.valid) return toolError(validation.error);
  const args = validation.args;

  const access = await verifyExecutorAccess(ctx);
  if (access.kind !== "allowed") {
    return access;
  }

  const sb = ctx.serviceSupabase;

  try {
    return await withStageTimeout(`tool_${toolName}`, TOOL_EXECUTION_TIMEOUT_MS, async () => {
      switch (toolName) {
        case "list_members":
          return listMembers(sb, ctx.orgId, args as z.infer<typeof listMembersSchema>);
        case "list_events":
          return listEvents(sb, ctx.orgId, args as z.infer<typeof listEventsSchema>);
        case "get_org_stats":
          return getOrgStats(sb, ctx.orgId);
        case "suggest_connections":
          return runSuggestConnections(
            sb,
            ctx.orgId,
            args as z.infer<typeof suggestConnectionsSchema>
          );
      }
    });
  } catch (err) {
    if (isStageTimeoutError(err)) {
      return { kind: "timeout", error: "Tool timed out" };
    }
    console.warn("[ai-tools] unexpected error:", getSafeErrorMessage(err));
    return toolError("Unexpected error");
  }
}
