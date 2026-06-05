import { NextResponse } from "next/server";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";
import { createServiceClient } from "@/lib/supabase/service";
import { baseSchemas } from "@/lib/security/validation";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { requireActiveOrgAdmin } from "@/lib/auth/require-active-admin";
import { suggestMentorsForPairing } from "@/lib/mentorship/ai-suggestions";
import { executeAdminPairing } from "@/lib/mentorship/admin-pairing";
import { generateMatchWhyBatch } from "@/lib/mentorship/why-generator";
import type { MentorshipSignal } from "@/lib/mentorship/matching";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

/**
 * Admin pairing surface — "click a student → top-N available alumni with
 * similarity score + reasons + why → confirm pairing".
 *
 * GET  ?mentee_user_id=<uuid>&limit=5 — ranked candidates (never empty for a
 *      data-thin mentee; uses the fallback ranker) with capacity + a "why".
 * POST { mentee_user_id, mentor_user_id } — admin-authoritative pairing:
 *      proposes via admin_propose_pair, then accepts with admin_override.
 */

export async function GET(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  if (!baseSchemas.uuid.safeParse(organizationId).success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const { supabase, user } = await createAuthenticatedApiClient(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await requireActiveOrgAdmin(supabase, user.id, organizationId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rl = checkRateLimit(req, {
    userId: user.id,
    orgId: organizationId,
    feature: "mentorship admin candidates",
    limitPerUser: 60,
  });
  if (!rl.ok) return buildRateLimitResponse(rl);

  const url = new URL(req.url);
  const menteeUserId = url.searchParams.get("mentee_user_id");
  if (!menteeUserId || !baseSchemas.uuid.safeParse(menteeUserId).success) {
    return NextResponse.json({ error: "Invalid mentee_user_id" }, { status: 400 });
  }
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "5", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 10) : 5;

  const service = createServiceClient();
  const result = await suggestMentorsForPairing(service, organizationId, {
    menteeUserId,
    limit,
  });

  if (result.state === "not_found") {
    return NextResponse.json({ error: "Mentee not found" }, { status: 404 });
  }

  // Add a human-readable "why" per candidate (LLM-batched; degrades to a
  // deterministic template). Never blocks the response on AI.
  const whyById = new Map<string, string>();
  try {
    const whys = await generateMatchWhyBatch({
      menteeName: result.mentee?.name ?? "this student",
      candidates: result.candidates.map((c) => ({
        id: c.mentor.user_id,
        mentorName: c.mentor.name,
        signals: c.reasons.map(
          (r): MentorshipSignal => ({ code: r.code, weight: r.weight, value: r.value })
        ),
      })),
      orgId: organizationId,
    });
    for (const w of whys) whyById.set(w.id, w.why);
  } catch {
    // leave whyById empty — UI falls back to reason chips
  }

  return NextResponse.json({
    mentee: result.mentee,
    usedFallback: result.usedFallback,
    candidates: result.candidates.map((c) => ({
      ...c,
      why: whyById.get(c.mentor.user_id) ?? "",
    })),
  });
}

export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  if (!baseSchemas.uuid.safeParse(organizationId).success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const { supabase, user } = await createAuthenticatedApiClient(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await requireActiveOrgAdmin(supabase, user.id, organizationId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rl = checkRateLimit(req, {
    userId: user.id,
    orgId: organizationId,
    feature: "mentorship admin pairing confirm",
    limitPerUser: 30,
  });
  if (!rl.ok) return buildRateLimitResponse(rl);

  let payload: { mentee_user_id?: unknown; mentor_user_id?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const menteeUserId = payload.mentee_user_id;
  const mentorUserId = payload.mentor_user_id;
  if (
    typeof menteeUserId !== "string" ||
    typeof mentorUserId !== "string" ||
    !baseSchemas.uuid.safeParse(menteeUserId).success ||
    !baseSchemas.uuid.safeParse(mentorUserId).success
  ) {
    return NextResponse.json({ error: "Invalid mentee_user_id or mentor_user_id" }, { status: 400 });
  }

  const service = createServiceClient();

  const outcome = await executeAdminPairing(service, supabase, {
    organizationId,
    menteeUserId,
    mentorUserId,
    actorUserId: user.id,
  });

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.httpStatus });
  }

  // Partial success (accept failed; pair left "proposed") still returns 200 so
  // the admin can retry the accept — unchanged from the prior inline behavior.
  const body: { pair_id: string; status: string; warning?: string } = {
    pair_id: outcome.pairId,
    status: outcome.status,
  };
  if (outcome.warning) body.warning = outcome.warning;
  return NextResponse.json(body, { status: 200 });
}
