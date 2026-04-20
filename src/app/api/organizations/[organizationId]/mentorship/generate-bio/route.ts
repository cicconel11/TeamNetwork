import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { baseSchemas } from "@/lib/security/validation";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { generateMentorBio } from "@/lib/mentorship/bio-generator";
import { loadMentorBioContext } from "@/lib/mentorship/bio-backfill";
import { logAiRequest } from "@/lib/ai/audit";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  user_id: baseSchemas.uuid,
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

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = checkRateLimit(req, {
    userId: user.id,
    orgId: organizationId,
    feature: "mentorship bio generation",
    limitPerUser: 5,
  });
  if (!rl.ok) return buildRateLimitResponse(rl);

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const service = createServiceClient();

  // Auth: caller must be the target user or an org admin
  const membershipUserIds =
    user.id === body.user_id ? [user.id] : [user.id, body.user_id];

  const { data: memberships } = await service
    .from("user_organization_roles")
    .select("user_id,role,status")
    .eq("organization_id", organizationId)
    .in("user_id", membershipUserIds);

  const callerMembership =
    (memberships ?? []).find((row) => row.user_id === user.id) ?? null;

  const isAdmin = callerMembership?.role === "admin" && callerMembership?.status === "active";
  const isSelf = user.id === body.user_id && callerMembership?.status === "active";

  if (!isAdmin && !isSelf) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const context = await loadMentorBioContext(service, organizationId, body.user_id);
  if (!context) {
    return NextResponse.json({ bio: "", topics: [], expertiseAreas: [] });
  }

  const result = await generateMentorBio(context.input);

  // Audit log (fire and forget)
  logAiRequest(
    service as unknown as SupabaseClient,
    {
      threadId: null,
      messageId: null,
      userId: body.user_id,
      orgId: organizationId,
      intent: "bio_generation",
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: result.latencyMs,
    }
  ).catch(() => {/* audit log failures are non-critical */});

  return NextResponse.json({
    bio: result.bio,
    topics: result.topics,
    expertiseAreas: result.expertiseAreas,
    inputHash: context.nextInputHash,
  });
}
