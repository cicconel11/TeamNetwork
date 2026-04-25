import { NextResponse } from "next/server";
import { z } from "zod";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";
import { createServiceClient } from "@/lib/supabase/service";
import { baseSchemas } from "@/lib/security/validation";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { suggestMentors } from "@/lib/mentorship/ai-suggestions";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  mentee_user_id: baseSchemas.uuid,
  limit: z.number().int().min(1).max(100).optional(),
  focus_areas: z.array(z.string().trim().min(1)).optional(),
});

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  const orgParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgParsed.success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const { supabase, user } = await createAuthenticatedApiClient(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = checkRateLimit(req, {
    userId: user.id,
    orgId: organizationId,
    feature: "mentorship suggestions",
    limitPerUser: 30,
  });
  if (!rl.ok) return buildRateLimitResponse(rl);

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const service = createServiceClient();

  // Auth: caller must be admin or the mentee themselves (active_member)
  const membershipUserIds =
    user.id === body.mentee_user_id ? [user.id] : [user.id, body.mentee_user_id];

  const { data: memberships } = await service
    .from("user_organization_roles")
    .select("user_id,role,status")
    .eq("organization_id", organizationId)
    .in("user_id", membershipUserIds);

  const callerMembership =
    (memberships ?? []).find((row) => row.user_id === user.id) ?? null;
  const targetMembership =
    (memberships ?? []).find((row) => row.user_id === body.mentee_user_id) ?? null;

  const isAdmin = callerMembership?.role === "admin" && callerMembership?.status === "active";
  const isEligibleSelf =
    user.id === body.mentee_user_id &&
    targetMembership?.role === "active_member" &&
    targetMembership?.status === "active";

  if (!isAdmin && !isEligibleSelf) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!targetMembership || targetMembership.status !== "active") {
    return NextResponse.json({ error: "Mentee not found in organization" }, { status: 404 });
  }

  if (targetMembership.role !== "active_member") {
    return NextResponse.json({ error: "Suggestions are only available for active members" }, { status: 403 });
  }

  const result = await suggestMentors(
    service as unknown as import("@supabase/supabase-js").SupabaseClient<Database>,
    organizationId,
    {
      menteeUserId: body.mentee_user_id,
      focusAreas: body.focus_areas,
      limit: body.limit ?? 10,
    }
  );

  if (result.state === "not_found") {
    return NextResponse.json({ error: "Mentee not found" }, { status: 404 });
  }

  const matches = result.suggestions.map((suggestion) => ({
    mentorUserId: suggestion.mentor.user_id,
    score: suggestion.score,
    signals: suggestion.reasons.map((reason) => ({
      code: reason.code,
      label: reason.label,
      weight: reason.weight,
      value: reason.value,
    })),
    mentor: suggestion.mentor,
    reasons: suggestion.reasons.map((reason) => ({
      code: reason.code,
      label: reason.label,
    })),
  }));

  return NextResponse.json({ matches });
}
