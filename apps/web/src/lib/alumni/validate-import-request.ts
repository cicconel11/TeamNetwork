import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { getAlumniCapacitySnapshot } from "@/lib/alumni/capacity";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { LinkedInImportCapacitySnapshot } from "@/lib/alumni/linkedin-import";

// ─── Types ───────────────────────────────────────────────────────────────────

interface RateLimitConfig {
  featurePreview: string;
  featureImport: string;
  previewLimitPerIp?: number;
  previewLimitPerUser?: number;
  importLimitPerIp?: number;
  importLimitPerUser?: number;
}

interface ValidateImportSuccess {
  ok: true;
  organizationId: string;
  userId: string;
  userSupabase: SupabaseClient<Database>;
  serviceSupabase: SupabaseClient<Database>;
  capacitySnapshot: LinkedInImportCapacitySnapshot;
  respond: (payload: unknown, status?: number) => NextResponse;
}

interface ValidateImportFailure {
  ok: false;
  response: NextResponse;
}

export type ValidateImportResult = ValidateImportSuccess | ValidateImportFailure;

// ─── Helper ──────────────────────────────────────────────────────────────────

export async function validateAlumniImportRequest(
  req: Request,
  rawOrganizationId: string,
  rateLimitConfig: RateLimitConfig,
): Promise<ValidateImportResult> {
  // 1. UUID validation
  const orgIdParsed = baseSchemas.uuid.safeParse(rawOrganizationId);
  if (!orgIdParsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid organization id" },
        { status: 400 },
      ),
    };
  }
  const organizationId = orgIdParsed.data;

  // 2. Session
  const userSupabase = await createClient();
  const {
    data: { user },
  } = await userSupabase.auth.getUser();

  // 3. Rate limiting
  const isPreview = new URL(req.url).searchParams.get("preview") === "1";
  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: isPreview
      ? rateLimitConfig.featurePreview
      : rateLimitConfig.featureImport,
    limitPerIp: isPreview
      ? (rateLimitConfig.previewLimitPerIp ?? 15)
      : (rateLimitConfig.importLimitPerIp ?? 15),
    limitPerUser: isPreview
      ? (rateLimitConfig.previewLimitPerUser ?? 10)
      : (rateLimitConfig.importLimitPerUser ?? 10),
  });

  if (!rateLimit.ok) {
    return { ok: false, response: buildRateLimitResponse(rateLimit) };
  }

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  // 4. Auth guard
  if (!user) {
    return { ok: false, response: respond({ error: "Unauthorized" }, 401) };
  }

  // 5+6. Admin role check + capacity snapshot (parallel — independent queries)
  const serviceSupabase = createServiceClient();

  const [membershipResult, capacityResult] = await Promise.allSettled([
    getOrgMembership(serviceSupabase, user.id, organizationId),
    getAlumniCapacitySnapshot(organizationId, serviceSupabase),
  ]);

  if (membershipResult.status === "rejected") {
    return {
      ok: false,
      response: respond({ error: "Unable to verify permissions" }, 500),
    };
  }

  if (membershipResult.value?.role !== "admin") {
    return { ok: false, response: respond({ error: "Forbidden" }, 403) };
  }

  if (capacityResult.status === "rejected") {
    return {
      ok: false,
      response: respond({ error: "Failed to verify alumni capacity" }, 500),
    };
  }

  const capacitySnapshot = capacityResult.value;

  return {
    ok: true,
    organizationId,
    userId: user.id,
    userSupabase,
    serviceSupabase,
    capacitySnapshot,
    respond,
  };
}
