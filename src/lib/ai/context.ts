/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { RateLimitResult } from "@/lib/security/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";

// ── Discriminated union return type ──

export type AiOrgContext =
  | {
      ok: true;
      orgId: string;
      userId: string;
      userEmail: string;
      role: "admin";
      supabase: any; // auth-bound client (for threads/messages via RLS)
      serviceSupabase: any; // service-role client (for tools/audit)
    }
  | { ok: false; response: NextResponse };

// ── Dependency injection for testability ──

export interface AiOrgContextDeps {
  serviceSupabase?: any;
  supabase?: any;
}

// ── Helper ──

/**
 * Consolidated auth helper for AI assistant API routes.
 *
 * Validates that the requesting user is an org admin, following the same
 * discriminated union pattern as `getEnterpriseApiContext()`.
 *
 * Accepts a pre-fetched `user` (routes already call getUser() for rate limiting)
 * to avoid a double getUser() per request.
 *
 * Fail-closed: if the DB role query errors, returns 503 (never silently grants access).
 */
export async function getAiOrgContext(
  orgId: string,
  user: User | null,
  rateLimit: Pick<RateLimitResult, "headers">,
  deps: AiOrgContextDeps = {}
): Promise<AiOrgContext> {
  const respond = (payload: unknown, status: number) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  // 1. Auth check
  if (!user) {
    return { ok: false, response: respond({ error: "Unauthorized" }, 401) };
  }

  // 2. Get service client (injectable for tests)
  const serviceSupabase = deps.serviceSupabase ?? createServiceClient();

  // 3. Check admin role — fail closed on DB error
  const { data: membership, error } = await (serviceSupabase as any)
    .from("user_organization_roles")
    .select("role, status")
    .eq("user_id", user.id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (error) {
    console.error("[ai-context] role query failed:", error);
    return { ok: false, response: respond({ error: "Service unavailable" }, 503) };
  }

  if (!membership || membership.role !== "admin" || membership.status !== "active") {
    return {
      ok: false,
      response: respond({ error: "AI assistant requires admin role" }, 403),
    };
  }

  // 4. Success — return full context
  return {
    ok: true,
    orgId,
    userId: user.id,
    userEmail: user.email ?? "",
    role: "admin",
    supabase: deps.supabase ?? null, // routes pass their auth-bound client
    serviceSupabase,
  };
}
