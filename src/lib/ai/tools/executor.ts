import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolName } from "./definitions";
import { TOOL_NAMES } from "./definitions";

export interface ToolExecutionContext {
  orgId: string;
  serviceSupabase: SupabaseClient;
}

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

type CountResult =
  | { ok: true; count: number }
  | { ok: false; error: string };

// --- Zod schemas for tool argument validation ---

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

const ARG_SCHEMAS: Record<ToolName, z.ZodSchema> = {
  list_members: listMembersSchema,
  list_events: listEventsSchema,
  get_org_stats: getOrgStatsSchema,
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

async function safeToolQuery(
  fn: () => Promise<{ data: unknown; error: unknown }>
): Promise<ToolResult> {
  try {
    const { data, error } = await fn();
    if (error) {
      console.warn("[ai-tools] query failed:", getSafeErrorMessage(error));
      return { ok: false, error: "Query failed" };
    }
    return { ok: true, data: data ?? [] };
  } catch (err) {
    console.warn("[ai-tools] unexpected error:", getSafeErrorMessage(err));
    return { ok: false, error: "Unexpected error" };
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
): Promise<ToolResult> {
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
): Promise<ToolResult> {
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

async function getOrgStats(sb: SB, orgId: string): Promise<ToolResult> {
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

  if (!members.ok || !alumni.ok || !parents.ok || !upcomingEvents.ok || !donations.ok) {
    return { ok: false, error: "Query failed" };
  }

  return {
    ok: true,
    data: {
      active_members: members.count,
      alumni: alumni.count,
      parents: parents.count,
      upcoming_events: upcomingEvents.count,
      donations: donations.data,
    },
  };
}

export async function executeToolCall(
  ctx: ToolExecutionContext,
  call: { name: string; args: unknown }
): Promise<ToolResult> {
  if (!TOOL_NAMES.has(call.name)) {
    return { ok: false, error: `Unknown tool: ${call.name}` };
  }
  const toolName = call.name as ToolName;

  const validation = validateArgs(toolName, call.args);
  if (!validation.valid) return { ok: false, error: validation.error };
  const args = validation.args;

  const sb = ctx.serviceSupabase;

  switch (toolName) {
    case "list_members":
      return listMembers(sb, ctx.orgId, args as z.infer<typeof listMembersSchema>);
    case "list_events":
      return listEvents(sb, ctx.orgId, args as z.infer<typeof listEventsSchema>);
    case "get_org_stats":
      return getOrgStats(sb, ctx.orgId);
  }
}
