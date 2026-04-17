import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { baseSchemas } from "@/lib/security/validation";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  rankMentorsForMentee,
  type MentorInput,
} from "@/lib/mentorship/matching";
import { loadMenteeIntakeInput } from "@/lib/mentorship/matching-signals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  mentee_user_id: baseSchemas.uuid,
  limit: z.number().int().min(1).max(50).optional(),
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

  const menteeInput = await loadMenteeIntakeInput(
    service as unknown as Parameters<typeof loadMenteeIntakeInput>[0],
    body.mentee_user_id,
    organizationId
  );
  const merged = body.focus_areas && body.focus_areas.length > 0
    ? { ...menteeInput, focusAreas: [...(menteeInput.focusAreas ?? []), ...body.focus_areas] }
    : menteeInput;

  // Load active mentors in org + alumni enrichment. Phase 2 columns not in generated DB types.
  const mentorProfilesRes = await (service as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: boolean) => Promise<{ data: Array<Record<string, unknown>> | null }>;
        };
      };
    };
  })
    .from("mentor_profiles")
    .select(
      "user_id, topics, expertise_areas, max_mentees, current_mentee_count, accepting_new, is_active, meeting_preferences, years_of_experience"
    )
    .eq("organization_id", organizationId)
    .eq("is_active", true);
  const mentorProfiles = mentorProfilesRes.data ?? [];

  const mentorUserIds = mentorProfiles.map((p) => p.user_id as string);

  const { data: alumniRows } = mentorUserIds.length > 0
    ? await service
        .from("alumni")
        .select("user_id, industry, job_title, current_company, current_city, graduation_year")
        .eq("organization_id", organizationId)
        .in("user_id", mentorUserIds)
    : { data: [] as Array<Record<string, unknown>> };

  const alumniByUser = new Map<string, Record<string, unknown>>();
  for (const row of (alumniRows ?? []) as Array<{ user_id: string } & Record<string, unknown>>) {
    alumniByUser.set(row.user_id, row);
  }

  const mentorInputs: MentorInput[] = mentorProfiles.map((p) => {
    const alumni = alumniByUser.get(p.user_id as string) ?? {};
    return {
      userId: p.user_id as string,
      orgId: organizationId,
      topics: (p.topics as string[] | null) ?? [],
      expertiseAreas: (p.expertise_areas as string[] | null) ?? [],
      industry: (alumni.industry as string | null) ?? null,
      jobTitle: (alumni.job_title as string | null) ?? null,
      currentCompany: (alumni.current_company as string | null) ?? null,
      currentCity: (alumni.current_city as string | null) ?? null,
      graduationYear: (alumni.graduation_year as number | null) ?? null,
      maxMentees: (p.max_mentees as number | null) ?? 3,
      currentMenteeCount: (p.current_mentee_count as number | null) ?? 0,
      acceptingNew: (p.accepting_new as boolean | null) ?? true,
      isActive: true,
    };
  });

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
