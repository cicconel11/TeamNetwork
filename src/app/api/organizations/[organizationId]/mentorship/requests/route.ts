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
import { loadMenteePreferences } from "@/lib/mentorship/queries";
import {
  extractMenteeSignals,
  extractMentorSignals,
  intersectNormalized,
} from "@/lib/mentorship/matching-signals";
import { sendNotificationBlast } from "@/lib/notifications";
import { proposalReceivedTemplate } from "@/lib/notifications/templates/mentorship/proposal_received";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  mentor_user_id: baseSchemas.uuid,
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
    feature: "mentorship requests",
    limitPerUser: 20,
  });
  if (!rl.ok) return buildRateLimitResponse(rl);

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const service = createServiceClient();
  // Phase 2 columns/settings field not yet in generated DB types.
  const svc = service as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: string) => {
            maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
          };
          maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
        };
      };
    };
    rpc: (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
  };

  // Self-request block (prompting bug fix #1)
  if (body.mentor_user_id === user.id) {
    return NextResponse.json(
      { error: "You cannot request yourself", error_code: "self_request_blocked" },
      { status: 422 }
    );
  }

  // Caller must be an active_member in this org
  const { data: callerRole } = await service
    .from("user_organization_roles")
    .select("role,status")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!callerRole || callerRole.status !== "active" || callerRole.role !== "active_member") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Idempotent check: existing non-terminal pair — return typed rejection code
  const { data: existing } = await service
    .from("mentorship_pairs")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("mentor_user_id", body.mentor_user_id)
    .eq("mentee_user_id", user.id)
    .in("status", ["proposed", "accepted", "active", "paused"])
    .is("deleted_at", null)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      {
        pair: existing,
        reused: true,
        error_code: "already_requested",
        pair_id: existing.id,
      },
      { status: 200 }
    );
  }

  // Compute score/signals for this specific mentor — native preferences path
  const menteeInput = await loadMenteePreferences(service, organizationId, user.id);

  const { data: mentorProfileRaw } = await svc
    .from("mentor_profiles")
    .select(
      "user_id, topics, expertise_areas, sports, positions, industries, role_families, max_mentees, current_mentee_count, accepting_new, is_active"
    )
    .eq("organization_id", organizationId)
    .eq("user_id", body.mentor_user_id)
    .maybeSingle();

  const mentorProfile = mentorProfileRaw as {
    user_id: string;
    topics: string[] | null;
    expertise_areas: string[] | null;
    sports: string[] | null;
    positions: string[] | null;
    industries: string[] | null;
    role_families: string[] | null;
    max_mentees: number | null;
    current_mentee_count: number | null;
    accepting_new: boolean | null;
    is_active: boolean;
  } | null;

  if (!mentorProfile || !mentorProfile.is_active) {
    return NextResponse.json({ error: "Mentor not found" }, { status: 404 });
  }

  const { data: alumni } = await service
    .from("alumni")
    .select("industry, job_title, position_title, current_company, current_city, graduation_year")
    .eq("organization_id", organizationId)
    .eq("user_id", body.mentor_user_id)
    .maybeSingle();

  const mentorInput: MentorInput = {
    userId: body.mentor_user_id,
    orgId: organizationId,
    topics: mentorProfile.topics ?? [],
    expertiseAreas: mentorProfile.expertise_areas ?? [],
    nativeSports: mentorProfile.sports ?? [],
    nativePositions: mentorProfile.positions ?? [],
    nativeIndustries: mentorProfile.industries ?? [],
    nativeRoleFamilies: mentorProfile.role_families ?? [],
    industry: (alumni?.industry as string | null) ?? null,
    jobTitle: (alumni as { job_title?: string | null } | null)?.job_title ?? null,
    positionTitle: (alumni as { position_title?: string | null } | null)?.position_title ?? null,
    currentCompany: (alumni?.current_company as string | null) ?? null,
    currentCity: (alumni?.current_city as string | null) ?? null,
    graduationYear: (alumni?.graduation_year as number | null) ?? null,
    maxMentees: mentorProfile.max_mentees ?? 3,
    currentMenteeCount: mentorProfile.current_mentee_count ?? 0,
    acceptingNew: mentorProfile.accepting_new ?? true,
    isActive: true,
  };
  const menteeSignals = extractMenteeSignals(menteeInput);
  const mentorSignals = extractMentorSignals(mentorInput);

  // Server-enforced hard-filter rejection codes. These mirror
  // scoreMentorForMentee's filters but surface machine-readable error_codes so
  // the UI can explain WHY a request was blocked (prompting bug fix #2).
  const required = new Set(menteeSignals.requiredMentorAttributes);

  if (
    required.has("same_sport") &&
    menteeSignals.preferredSports.length > 0 &&
    intersectNormalized(mentorSignals.sports, menteeSignals.preferredSports).length === 0
  ) {
    return NextResponse.json(
      { error: "Mentor does not share a required sport", error_code: "same_sport_required" },
      { status: 422 }
    );
  }
  if (
    required.has("same_position") &&
    menteeSignals.preferredPositions.length > 0 &&
    intersectNormalized(mentorSignals.positions, menteeSignals.preferredPositions).length === 0
  ) {
    return NextResponse.json(
      { error: "Mentor does not share a required position", error_code: "same_position_required" },
      { status: 422 }
    );
  }
  if (
    required.has("same_industry") &&
    menteeSignals.preferredIndustries.length > 0 &&
    intersectNormalized(mentorSignals.industries, menteeSignals.preferredIndustries).length === 0
  ) {
    return NextResponse.json(
      { error: "Mentor does not share a required industry", error_code: "same_industry_required" },
      { status: 422 }
    );
  }
  if (
    required.has("same_role_family") &&
    menteeSignals.preferredRoleFamilies.length > 0 &&
    intersectNormalized(mentorSignals.roleFamilies, menteeSignals.preferredRoleFamilies).length === 0
  ) {
    return NextResponse.json(
      {
        error: "Mentor does not share a required job field",
        error_code: "same_role_family_required",
      },
      { status: 422 }
    );
  }

  const { data: orgRowRaw } = await service
    .from("organizations")
    .select("slug,settings")
    .eq("id", organizationId)
    .maybeSingle();
  const orgRow = orgRowRaw as { slug?: string; settings?: unknown } | null;

  const matches = rankMentorsForMentee(menteeInput, [mentorInput], {
    orgSettings: (orgRow?.settings as Record<string, unknown> | null) ?? null,
  });
  const match = matches[0] ?? null;

  if (!match) {
    return NextResponse.json(
      {
        error:
          "This mentor is not currently eligible for a structured mentorship request. Suggestions are based on shared sport, position, location, industry, job field, and other meaningful similarities.",
      },
      { status: 409 }
    );
  }

  // Insert proposal atomically via admin_propose_pair RPC (validates actor,
  // persists score+signals in a single statement, idempotent on concurrent retries).
  const { data: rpcData, error: rpcError } = await svc.rpc("admin_propose_pair", {
    p_organization_id: organizationId,
    p_mentor_user_id: body.mentor_user_id,
    p_mentee_user_id: user.id,
    p_match_score: match.score,
    p_match_signals: match.signals,
    p_actor_user_id: user.id,
  });

  if (rpcError) {
    console.error("[mentorship/requests] RPC failed", rpcError);
    return NextResponse.json({ error: "Failed to create proposal" }, { status: 500 });
  }

  const rpcRow = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
    | { pair_id?: string; status?: string; match_score?: number; match_signals?: unknown; reused?: boolean }
    | null;

  if (!rpcRow?.pair_id) {
    return NextResponse.json({ error: "Failed to create proposal" }, { status: 500 });
  }

  // Hydrate full row for response
  const { data: inserted } = await service
    .from("mentorship_pairs")
    .select("*")
    .eq("id", rpcRow.pair_id)
    .maybeSingle();

  if (!inserted) {
    return NextResponse.json({ error: "Failed to load proposal" }, { status: 500 });
  }

  if (inserted.match_score == null && match.score != null) {
    console.error("[mentorship/requests] match_score not persisted for pair", rpcRow.pair_id,
      "expected:", match.score);
  }

  if (rpcRow.reused) {
    return NextResponse.json({ pair: inserted, reused: true }, { status: 200 });
  }

  // Notification — best effort
  try {
    const { data: menteeUser } = await service
      .from("users")
      .select("name,email")
      .eq("id", user.id)
      .maybeSingle();

    const menteeName = menteeUser?.name?.trim() || menteeUser?.email?.trim() || "A mentee";
    const reviewLink = orgRow?.slug ? `/${orgRow.slug}/mentorship?tab=proposals` : "/mentorship";

    const { title, body: msgBody } = proposalReceivedTemplate({
      menteeName,
      reviewLink,
    });

    await sendNotificationBlast({
      supabase: service,
      organizationId,
      audience: "both",
      channel: "email",
      title,
      body: msgBody,
      targetUserIds: [body.mentor_user_id],
      category: "mentorship",
    });
  } catch (notifyError) {
    console.error("[mentorship/requests] notify failed", notifyError);
  }

  return NextResponse.json({ pair: inserted, reused: false }, { status: 201 });
}
