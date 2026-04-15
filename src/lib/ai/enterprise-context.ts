/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { EnterpriseRole } from "@/types/enterprise";
import type { RateLimitResult } from "@/lib/security/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import { ENTERPRISE_ANY_ROLE } from "@/lib/auth/enterprise-api-context";
import {
  resolveEnterpriseParam,
  type ResolveEnterpriseError,
  type ResolvedEnterpriseParam,
} from "@/lib/enterprise/resolve-enterprise";

// ── Discriminated union return type ──

export type EnterpriseAiContext =
  | {
      ok: true;
      enterpriseId: string;
      userId: string;
      userEmail: string;
      role: EnterpriseRole;
      /** Auth-bound client (for thread/message reads/writes that go through RLS). */
      supabase: any;
      /** Service-role client (for tool execution, audit, RPCs). */
      serviceSupabase: any;
    }
  | { ok: false; response: NextResponse };

// ── Dependency injection ──

export interface EnterpriseAiContextDeps {
  serviceSupabase?: any;
  /** Auth-bound supabase client, mirrored from the calling route. */
  supabase?: any;
  resolveEnterprise?: (
    idOrSlug: string,
    serviceSupabase: SupabaseClient<Database>
  ) => Promise<{
    data: ResolvedEnterpriseParam | null;
    error?: ResolveEnterpriseError;
  }>;
}

/**
 * Enterprise-scoped AI auth helper.
 *
 * Mirrors getAiOrgContext for the enterprise surface. Requires the caller to
 * hold a user_enterprise_roles row with role in ENTERPRISE_ANY_ROLE
 * (owner | billing_admin | org_admin).
 *
 * Cross-enterprise attack mitigation: a user with a role in Enterprise 1
 * hitting an Enterprise 2 endpoint gets 403 — the role query returns no row
 * for (user_id, enterprise_id = E2).
 *
 * Fail-closed: DB error returns 503, never silently grants access.
 */
export async function getEnterpriseAiContext(
  idOrSlug: string,
  user: User | null,
  rateLimit: Pick<RateLimitResult, "headers">,
  deps: EnterpriseAiContextDeps = {}
): Promise<EnterpriseAiContext> {
  const respond = (payload: unknown, status: number) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) {
    return { ok: false, response: respond({ error: "Unauthorized" }, 401) };
  }

  const serviceSupabase = deps.serviceSupabase ?? createServiceClient();
  const resolveEnterprise = deps.resolveEnterprise ?? resolveEnterpriseParam;

  const { data: resolved, error: resolveError } = await resolveEnterprise(
    idOrSlug,
    serviceSupabase
  );

  if (resolveError) {
    return {
      ok: false,
      response: respond({ error: resolveError.message }, resolveError.status),
    };
  }

  if (!resolved) {
    return { ok: false, response: respond({ error: "Enterprise not found" }, 404) };
  }

  const enterpriseId = resolved.enterpriseId;

  const { data: roleRow, error: roleError } = await serviceSupabase
    .from("user_enterprise_roles")
    .select("role")
    .eq("enterprise_id", enterpriseId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleError) {
    console.error("[ai-enterprise-context] role query failed:", roleError);
    return { ok: false, response: respond({ error: "Service unavailable" }, 503) };
  }

  const role = roleRow?.role as EnterpriseRole | undefined;

  if (!role || !ENTERPRISE_ANY_ROLE.includes(role)) {
    return { ok: false, response: respond({ error: "Forbidden" }, 403) };
  }

  return {
    ok: true,
    enterpriseId,
    userId: user.id,
    userEmail: user.email ?? "",
    role,
    supabase: deps.supabase ?? null,
    serviceSupabase,
  };
}
