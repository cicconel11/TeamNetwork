import { NextResponse } from "next/server";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";
import { createServiceClient } from "@/lib/supabase/service";
import { baseSchemas } from "@/lib/security/validation";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { regenerateMentorBio } from "@/lib/mentorship/bio-backfill";
import { logAiRequest } from "@/lib/ai/audit";
import { isDevAdmin } from "@/lib/auth/dev-admin";
import { AiCapReachedError, checkAiSpend } from "@/lib/ai/spend";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

/**
 * Explicit mentor-bio regeneration. Mirrors the mentor-profile PUT auth model:
 * caller must be an active org member; an admin may target an eligible peer via
 * ?user_id=; self is always allowed. Unlike the background backfill, this path
 * overwrites a manually written bio. No request body required.
 */
export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  if (!baseSchemas.uuid.safeParse(organizationId).success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const { user } = await createAuthenticatedApiClient(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = checkRateLimit(req, {
    userId: user.id,
    orgId: organizationId,
    feature: "mentorship bio regeneration",
    limitPerUser: 5,
  });
  if (!rl.ok) return buildRateLimitResponse(rl);

  const service = createServiceClient();

  const { data: callerMembership } = await service
    .from("user_organization_roles")
    .select("role, status")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (
    !callerMembership ||
    callerMembership.status !== "active" ||
    !["admin", "alumni"].includes(callerMembership.role)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const requestedUserId = url.searchParams.get("user_id");

  let targetUserId = user.id;
  if (requestedUserId && requestedUserId !== user.id) {
    if (!baseSchemas.uuid.safeParse(requestedUserId).success) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }
    if (callerMembership.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // Target must be an active org member with an eligible role.
    const { data: targetMembership } = await service
      .from("user_organization_roles")
      .select("role, status")
      .eq("organization_id", organizationId)
      .eq("user_id", requestedUserId)
      .maybeSingle();
    if (
      !targetMembership ||
      targetMembership.status !== "active" ||
      !["admin", "alumni"].includes(targetMembership.role)
    ) {
      return NextResponse.json(
        { error: "Target user not eligible to mentor" },
        { status: 403 }
      );
    }
    targetUserId = requestedUserId;
  }

  const spendBypass = isDevAdmin(user);
  try {
    await checkAiSpend(organizationId, { bypass: spendBypass });
  } catch (err) {
    if (err instanceof AiCapReachedError) return err.toResponse();
    throw err;
  }

  const result = await regenerateMentorBio(service, organizationId, targetUserId, {
    allowManualOverwrite: true,
    spendBypass,
  });

  if (!result) {
    return NextResponse.json(
      { error: "No mentor profile to regenerate" },
      { status: 404 }
    );
  }

  // Audit log (fire and forget) — non-critical.
  logAiRequest(service as unknown as SupabaseClient, {
    threadId: null,
    messageId: null,
    userId: targetUserId,
    orgId: organizationId,
    intent: "bio_generation",
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    latencyMs: result.latencyMs,
  }).catch(() => {
    /* audit log failures are non-critical */
  });

  return NextResponse.json({
    bio: result.bio,
    model: result.model,
    bio_source: result.bioSource,
    topics: result.topics,
    expertiseAreas: result.expertiseAreas,
    inputHash: result.inputHash,
  });
}
