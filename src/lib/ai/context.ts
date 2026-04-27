import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { RateLimitResult } from "@/lib/security/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import type { ServerSupabase, ServiceSupabase } from "@/lib/supabase/types";
import { aiLog, type AiLogContext } from "@/lib/ai/logger";
import type { EnterpriseRole } from "@/types/enterprise";
import type { OrgRole } from "@/lib/auth/role-utils";
import { isMemberAccessKilled } from "@/lib/ai/access-policy";

// ── Discriminated union return type ──

export type AiOrgContextRole = OrgRole;

export type AiOrgContext =
  | {
      ok: true;
      orgId: string;
      userId: string;
      role: AiOrgContextRole;
      orgName?: string;
      orgSlug?: string;
      hideDonorNames?: boolean;
      enterpriseId?: string;
      enterpriseRole?: EnterpriseRole;
      supabase: ServerSupabase; // auth-bound client (for threads/messages via RLS)
      serviceSupabase: ServiceSupabase; // service-role client (for tools/audit)
    }
  | { ok: false; response: NextResponse };

// ── Dependency injection for testability ──

export interface AiOrgContextDeps {
  serviceSupabase?: ServiceSupabase;
  supabase: ServerSupabase;
  logContext?: AiLogContext;
}

export interface AiOrgContextOptions {
  /**
   * Minimum roles allowed through this entry point. Defaults to admin-only,
   * which preserves prior behavior for every existing AI API route.
   */
  allowedRoles?: readonly AiOrgContextRole[];
}

const DEFAULT_ALLOWED_ROLES: readonly AiOrgContextRole[] = ["admin"];

function isAiOrgContextRole(value: unknown): value is AiOrgContextRole {
  return (
    value === "admin" ||
    value === "active_member" ||
    value === "alumni" ||
    value === "parent"
  );
}

// ── Helper ──

/**
 * Consolidated auth helper for AI assistant API routes.
 *
 * Validates that the requesting user has an allowed org role. Defaults to
 * admin-only to match legacy behavior; routes that want to admit members must
 * opt in with `options.allowedRoles`.
 *
 * Non-admin callers additionally gated by `AI_MEMBER_ACCESS_KILL` env var
 * (defaults to killed until member rollout is ready).
 *
 * Fail-closed: if the DB role query errors, returns 503 (never silently grants access).
 */
export async function getAiOrgContext(
  orgId: string,
  user: User | null,
  rateLimit: Pick<RateLimitResult, "headers">,
  deps: AiOrgContextDeps,
  options: AiOrgContextOptions = {},
): Promise<AiOrgContext> {
  const respond = (payload: unknown, status: number) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  // 1. Auth check
  if (!user) {
    return { ok: false, response: respond({ error: "Unauthorized" }, 401) };
  }

  // 2. Get service client (injectable for tests)
  const serviceSupabase = deps.serviceSupabase ?? createServiceClient();
  const allowedRoles = options.allowedRoles ?? DEFAULT_ALLOWED_ROLES;

  // 3. Run role + org-row lookups in parallel — both keyed off (user.id, orgId).
  // Tradeoff: rejected requests (wrong org / inactive / disallowed role) now
  // also pay for the organizations lookup. Rate limiting bounds the abuse
  // surface and both queries reuse the same connection.
  const [membershipResult, orgRowResult] = await Promise.all([
    serviceSupabase
      .from("user_organization_roles")
      .select("role, status")
      .eq("user_id", user.id)
      .eq("organization_id", orgId)
      .maybeSingle(),
    serviceSupabase
      .from("organizations")
      .select("enterprise_id, name, slug, hide_donor_names")
      .eq("id", orgId)
      .maybeSingle(),
  ]);

  const fallbackLogCtx = deps.logContext ?? {
    requestId: "unknown_request",
    orgId,
    userId: user.id,
  };

  // Supabase queries resolve with {data, error} rather than throwing, so
  // Promise.all does not short-circuit. Log each error independently.
  if (membershipResult.error) {
    aiLog("error", "ai-context", "role query failed", fallbackLogCtx, {
      error: membershipResult.error,
    });
  }
  if (orgRowResult.error) {
    aiLog("error", "ai-context", "enterprise org lookup failed", fallbackLogCtx, {
      error: orgRowResult.error,
    });
  }
  if (membershipResult.error || orgRowResult.error) {
    return { ok: false, response: respond({ error: "Service unavailable" }, 503) };
  }

  const membership = membershipResult.data;
  const orgRow = orgRowResult.data;

  if (!membership || membership.status !== "active") {
    return {
      ok: false,
      response: respond({ error: "AI assistant requires an active org membership" }, 403),
    };
  }

  const rawRole = membership.role;
  if (!isAiOrgContextRole(rawRole)) {
    return {
      ok: false,
      response: respond({ error: "AI assistant requires an active org membership" }, 403),
    };
  }

  if (!allowedRoles.includes(rawRole)) {
    return {
      ok: false,
      response: respond({ error: "AI assistant is not available for your role" }, 403),
    };
  }

  // Enforce global kill switch for non-admin callers
  if (rawRole !== "admin") {
    if (isMemberAccessKilled()) {
      return {
        ok: false,
        response: respond({ error: "AI assistant is not available for your role" }, 403),
      };
    }
    if (rawRole === "parent") {
      return {
        ok: false,
        response: respond({ error: "AI assistant is not available for your role" }, 403),
      };
    }
  }

  let enterpriseId: string | undefined;
  let enterpriseRole: EnterpriseRole | undefined;

  if (orgRow?.enterprise_id) {
    const { data: enterpriseRoleRow, error: enterpriseRoleError } = await serviceSupabase
      .from("user_enterprise_roles")
      .select("role")
      .eq("enterprise_id", orgRow.enterprise_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (enterpriseRoleError) {
      aiLog("error", "ai-context", "enterprise role lookup failed", deps.logContext ?? {
        requestId: "unknown_request",
        orgId,
        userId: user.id,
      }, { error: enterpriseRoleError, enterpriseId: orgRow.enterprise_id });
      return { ok: false, response: respond({ error: "Service unavailable" }, 503) };
    }

    if (enterpriseRoleRow?.role) {
      enterpriseId = orgRow.enterprise_id;
      enterpriseRole = enterpriseRoleRow.role as EnterpriseRole;
    }
  }

  // 4. Success — return full context
  return {
    ok: true,
    orgId,
    userId: user.id,
    role: rawRole,
    orgName: typeof orgRow?.name === "string" ? orgRow.name : undefined,
    orgSlug: typeof orgRow?.slug === "string" ? orgRow.slug : undefined,
    hideDonorNames: orgRow?.hide_donor_names === true,
    enterpriseId,
    enterpriseRole,
    supabase: deps.supabase, // routes pass their auth-bound client
    serviceSupabase,
  };
}
