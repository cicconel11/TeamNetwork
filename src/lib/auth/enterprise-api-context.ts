import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { EnterpriseRole } from "@/types/enterprise";
import type { RateLimitResult } from "@/lib/security/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import {
  resolveEnterpriseParam,
  type ResolveEnterpriseError,
  type ResolvedEnterpriseParam,
} from "@/lib/enterprise/resolve-enterprise";

// ── Role preset constants (4 patterns used across routes) ──

export const ENTERPRISE_ANY_ROLE: EnterpriseRole[] = ["owner", "billing_admin", "org_admin"];
export const ENTERPRISE_BILLING_ROLE: EnterpriseRole[] = ["owner", "billing_admin"];
export const ENTERPRISE_CREATE_ORG_ROLE: EnterpriseRole[] = ["owner", "org_admin"];
export const ENTERPRISE_OWNER_ROLE: EnterpriseRole[] = ["owner"];

// ── Discriminated union return type ──

export type EnterpriseApiContext =
  | {
      ok: true;
      enterpriseId: string;
      userId: string;
      userEmail: string;
      role: EnterpriseRole;
      serviceSupabase: ReturnType<typeof createServiceClient>;
    }
  | { ok: false; response: NextResponse };

// ── Dependency injection for testability ──

export interface EnterpriseApiContextDeps {
  serviceSupabase?: ReturnType<typeof createServiceClient>;
  resolveEnterprise?: (
    idOrSlug: string,
    serviceSupabase: unknown
  ) => Promise<{
    data: ResolvedEnterpriseParam | null;
    error?: ResolveEnterpriseError;
  }>;
}

// ── Helper ──

/**
 * Consolidated auth helper for enterprise API routes.
 *
 * Replaces the ~15-line boilerplate pattern (user check, resolve enterprise
 * param, require role, error mapping) with a single function call that
 * returns a discriminated union.
 *
 * Accepts a pre-fetched `user` (routes already call getUser() for rate limiting)
 * to avoid a double getUser() per request.
 */
export async function getEnterpriseApiContext(
  idOrSlug: string,
  user: User | null,
  rateLimit: RateLimitResult,
  requiredRoles: EnterpriseRole[],
  deps: EnterpriseApiContextDeps = {}
): Promise<EnterpriseApiContext> {
  const respond = (payload: unknown, status: number) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  // 1. Auth check
  if (!user) {
    return { ok: false, response: respond({ error: "Unauthorized" }, 401) };
  }

  // 2. Resolve enterprise param (UUID passthrough or slug lookup)
  const serviceSupabase = deps.serviceSupabase ?? createServiceClient();
  const resolveEnterprise = deps.resolveEnterprise ?? resolveEnterpriseParam;
  const { data: resolved, error: resolveError } = await resolveEnterprise(
    idOrSlug,
    serviceSupabase as any
  );

  if (resolveError) {
    return {
      ok: false,
      response: respond({ error: resolveError.message }, resolveError.status),
    };
  }

  const enterpriseId = resolved?.enterpriseId ?? idOrSlug;

  // 3. Check enterprise role (single query via service client, fail-closed)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: roleRow, error: roleError } = await (serviceSupabase as any)
    .from("user_enterprise_roles")
    .select("role")
    .eq("enterprise_id", enterpriseId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleError) {
    console.error("[enterprise-api-context] role query failed:", roleError);
    return { ok: false, response: respond({ error: "Forbidden" }, 403) };
  }

  const role = roleRow?.role as EnterpriseRole | undefined;

  if (!role || !requiredRoles.includes(role)) {
    return { ok: false, response: respond({ error: "Forbidden" }, 403) };
  }

  // 4. Success — return full context
  return {
    ok: true,
    enterpriseId,
    userId: user.id,
    userEmail: user.email ?? "",
    role,
    serviceSupabase: serviceSupabase as ReturnType<typeof createServiceClient>,
  };
}
