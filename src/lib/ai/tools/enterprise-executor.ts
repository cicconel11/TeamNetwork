/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EnterpriseToolName } from "./enterprise-definitions";
import { ENTERPRISE_TOOL_NAMES } from "./enterprise-definitions";
import { ENTERPRISE_ANY_ROLE } from "@/lib/auth/enterprise-api-context";
import type { EnterpriseRole } from "@/types/enterprise";
import {
  isStageTimeoutError,
  TOOL_EXECUTION_TIMEOUT_MS,
  withStageTimeout,
} from "@/lib/ai/timeout";

export interface EnterpriseToolExecutionContext {
  enterpriseId: string;
  userId: string;
  serviceSupabase: SupabaseClient;
}

export type EnterpriseToolExecutionResult =
  | { kind: "ok"; data: unknown }
  | { kind: "forbidden"; error: "Forbidden" }
  | { kind: "auth_error"; error: "Auth check failed" }
  | { kind: "tool_error"; error: string }
  | { kind: "timeout"; error: "Tool timed out" };

// ── Schemas (strict to strip LLM-supplied enterprise_id / actor_user_id) ──

const emptySchema = z.object({}).strict();

const listOrgsSchema = z
  .object({ limit: z.number().int().min(1).max(100).optional() })
  .strict();

const searchAlumniSchema = z
  .object({
    graduation_year: z.number().int().optional(),
    major: z.string().trim().min(1).max(100).optional(),
    current_company: z.string().trim().min(1).max(200).optional(),
    current_city: z.string().trim().min(1).max(100).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

const ARG_SCHEMAS: Record<EnterpriseToolName, z.ZodSchema> = {
  get_enterprise_stats: emptySchema,
  list_enterprise_orgs: listOrgsSchema,
  search_enterprise_alumni: searchAlumniSchema,
  get_subscription_status: emptySchema,
  get_enterprise_details: emptySchema,
  get_enterprise_admins: emptySchema,
};

// ── Helpers ──

function getSafeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as any).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  return "unknown_error";
}

function toolError(error: string): EnterpriseToolExecutionResult {
  return { kind: "tool_error", error };
}

function validateArgs(
  name: EnterpriseToolName,
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

async function safeToolQuery(
  fn: () => Promise<{ data: unknown; error: unknown }>
): Promise<EnterpriseToolExecutionResult> {
  try {
    const { data, error } = await fn();
    if (error) {
      console.warn("[ai-ent-tools] query failed:", getSafeErrorMessage(error));
      return toolError("Query failed");
    }
    return { kind: "ok", data: data ?? [] };
  } catch (err) {
    if (isStageTimeoutError(err)) throw err;
    console.warn("[ai-ent-tools] unexpected error:", getSafeErrorMessage(err));
    return toolError("Unexpected error");
  }
}

// ── Access check ──

async function verifyEnterpriseExecutorAccess(
  ctx: EnterpriseToolExecutionContext
): Promise<
  | { kind: "allowed" }
  | Extract<EnterpriseToolExecutionResult, { kind: "forbidden" | "auth_error" }>
> {
  try {
    const { data, error } = await (ctx.serviceSupabase as any)
      .from("user_enterprise_roles")
      .select("role")
      .eq("user_id", ctx.userId)
      .eq("enterprise_id", ctx.enterpriseId)
      .maybeSingle();

    if (error) {
      console.warn("[ai-ent-tools] auth check failed:", getSafeErrorMessage(error));
      return { kind: "auth_error", error: "Auth check failed" };
    }

    const role = (data as { role: EnterpriseRole } | null)?.role;
    if (!role || !ENTERPRISE_ANY_ROLE.includes(role)) {
      return { kind: "forbidden", error: "Forbidden" };
    }
    return { kind: "allowed" };
  } catch (err) {
    console.warn("[ai-ent-tools] auth check failed:", getSafeErrorMessage(err));
    return { kind: "auth_error", error: "Auth check failed" };
  }
}

// ── Tool implementations ──

async function getEnterpriseStats(
  sb: any,
  enterpriseId: string
): Promise<EnterpriseToolExecutionResult> {
  return safeToolQuery(() =>
    sb
      .from("enterprise_alumni_counts")
      .select("enterprise_id, total_alumni_count, sub_org_count, enterprise_managed_org_count")
      .eq("enterprise_id", enterpriseId)
      .maybeSingle()
  );
}

async function listEnterpriseOrgs(
  sb: any,
  enterpriseId: string,
  args: z.infer<typeof listOrgsSchema>
): Promise<EnterpriseToolExecutionResult> {
  const limit = Math.min(args.limit ?? 50, 100);
  return safeToolQuery(() =>
    sb
      .from("organizations")
      .select(
        "id, slug, name, enterprise_relationship_type, enterprise_adopted_at, enterprise_nav_synced_at"
      )
      .eq("enterprise_id", enterpriseId)
      .is("deleted_at", null)
      .order("name", { ascending: true })
      .limit(limit)
  );
}

async function searchEnterpriseAlumni(
  sb: any,
  enterpriseId: string,
  args: z.infer<typeof searchAlumniSchema>
): Promise<EnterpriseToolExecutionResult> {
  const limit = Math.min(args.limit ?? 20, 50);
  return safeToolQuery(async () => {
    let q = sb
      .from("enterprise_alumni_directory")
      .select(
        "id, organization_id, organization_name, organization_slug, first_name, last_name, graduation_year, major, job_title, current_company, current_city, industry"
      )
      .eq("enterprise_id", enterpriseId);

    if (typeof args.graduation_year === "number") {
      q = q.eq("graduation_year", args.graduation_year);
    }
    if (args.major) q = q.eq("major", args.major);
    if (args.current_company) q = q.eq("current_company", args.current_company);
    if (args.current_city) q = q.eq("current_city", args.current_city);

    const { data, error } = await q.order("last_name", { ascending: true }).limit(limit);
    if (!Array.isArray(data) || error) {
      return { data, error };
    }

    return {
      data: data.map((row: any) => {
        const firstInitial =
          typeof row.first_name === "string" && row.first_name.trim().length > 0
            ? `${row.first_name.trim()[0]}.`
            : null;
        const lastInitial =
          typeof row.last_name === "string" && row.last_name.trim().length > 0
            ? `${row.last_name.trim()[0]}.`
            : null;

        return {
          id: row.id,
          organization_id: row.organization_id,
          organization_name: row.organization_name,
          organization_slug: row.organization_slug,
          name: [firstInitial, lastInitial].filter(Boolean).join(" ") || null,
          graduation_year: row.graduation_year,
          major: row.major,
          job_title: row.job_title,
          current_company: row.current_company,
          current_city: row.current_city,
          industry: row.industry,
        };
      }),
      error: null,
    };
  });
}

async function getSubscriptionStatus(
  sb: any,
  enterpriseId: string
): Promise<EnterpriseToolExecutionResult> {
  return safeToolQuery(() =>
    sb
      .from("enterprise_subscriptions")
      .select(
        "status, billing_interval, current_period_end, grace_period_ends_at, sub_org_quantity, alumni_bucket_quantity, pricing_model"
      )
      .eq("enterprise_id", enterpriseId)
      .maybeSingle()
  );
}

async function getEnterpriseDetails(
  sb: any,
  enterpriseId: string
): Promise<EnterpriseToolExecutionResult> {
  return safeToolQuery(() =>
    sb
      .from("enterprises")
      .select("id, name, slug, description, billing_contact_email, created_at")
      .eq("id", enterpriseId)
      .maybeSingle()
  );
}

async function getEnterpriseAdmins(
  sb: any,
  ctx: EnterpriseToolExecutionContext
): Promise<EnterpriseToolExecutionResult> {
  // p_actor_user_id MUST come from server-validated ctx.userId — never from LLM args.
  try {
    const { data, error } = await sb.rpc("get_enterprise_admins", {
      p_actor_user_id: ctx.userId,
      p_enterprise_id: ctx.enterpriseId,
    });
    if (error) {
      console.warn("[ai-ent-tools] rpc failed:", getSafeErrorMessage(error));
      return toolError("Query failed");
    }
    return { kind: "ok", data: data ?? [] };
  } catch (err) {
    if (isStageTimeoutError(err)) throw err;
    console.warn("[ai-ent-tools] unexpected rpc error:", getSafeErrorMessage(err));
    return toolError("Unexpected error");
  }
}

// ── Entry point ──

export async function executeEnterpriseToolCall(
  ctx: EnterpriseToolExecutionContext,
  call: { name: string; args: unknown }
): Promise<EnterpriseToolExecutionResult> {
  if (!ENTERPRISE_TOOL_NAMES.has(call.name)) {
    return toolError(`Unknown tool: ${call.name}`);
  }
  const toolName = call.name as EnterpriseToolName;

  const validation = validateArgs(toolName, call.args);
  if (!validation.valid) return toolError(validation.error);
  const args = validation.args;

  const access = await verifyEnterpriseExecutorAccess(ctx);
  if (access.kind !== "allowed") return access;

  const sb = ctx.serviceSupabase;

  try {
    return await withStageTimeout(`ent_tool_${toolName}`, TOOL_EXECUTION_TIMEOUT_MS, async () => {
      switch (toolName) {
        case "get_enterprise_stats":
          return getEnterpriseStats(sb, ctx.enterpriseId);
        case "list_enterprise_orgs":
          return listEnterpriseOrgs(
            sb,
            ctx.enterpriseId,
            args as z.infer<typeof listOrgsSchema>
          );
        case "search_enterprise_alumni":
          return searchEnterpriseAlumni(
            sb,
            ctx.enterpriseId,
            args as z.infer<typeof searchAlumniSchema>
          );
        case "get_subscription_status":
          return getSubscriptionStatus(sb, ctx.enterpriseId);
        case "get_enterprise_details":
          return getEnterpriseDetails(sb, ctx.enterpriseId);
        case "get_enterprise_admins":
          return getEnterpriseAdmins(sb, ctx);
      }
    });
  } catch (err) {
    if (isStageTimeoutError(err)) {
      return { kind: "timeout", error: "Tool timed out" };
    }
    console.warn("[ai-ent-tools] unexpected error:", getSafeErrorMessage(err));
    return toolError("Unexpected error");
  }
}
