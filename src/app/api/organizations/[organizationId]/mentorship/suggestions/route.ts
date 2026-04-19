import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { baseSchemas } from "@/lib/security/validation";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  rankMentorsForMentee,
} from "@/lib/mentorship/matching";
import { loadMentorInputs, loadMenteePreferences } from "@/lib/mentorship/queries";

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

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
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

  const menteeInput = await loadMenteePreferences(
    service,
    organizationId,
    body.mentee_user_id
  );
  const merged = body.focus_areas && body.focus_areas.length > 0
    ? { ...menteeInput, focusAreas: [...(menteeInput.focusAreas ?? []), ...body.focus_areas] }
    : menteeInput;

  const mentorInputs = await loadMentorInputs(service, organizationId);

  // Exclude mentors already paired with this mentee
  const { data: existingPairs } = await service
    .from("mentorship_pairs")
    .select("mentor_user_id")
    .eq("organization_id", organizationId)
    .eq("mentee_user_id", body.mentee_user_id)
    .in("status", ["proposed", "accepted", "active", "paused"])
    .is("deleted_at", null);

  const exclude = new Set((existingPairs ?? []).map((r) => r.mentor_user_id as string));

  const { data: orgRowRaw } = await (service as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (c: string, v: string) => {
          maybeSingle: () => Promise<{ data: { settings?: unknown } | null }>;
        };
      };
    };
  })
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .maybeSingle();

  const matches = rankMentorsForMentee(merged, mentorInputs, {
    orgSettings: orgRowRaw?.settings ?? null,
    excludeMentorUserIds: exclude,
  });

  const limit = body.limit ?? 10;
  return NextResponse.json({ matches: matches.slice(0, limit) });
}
