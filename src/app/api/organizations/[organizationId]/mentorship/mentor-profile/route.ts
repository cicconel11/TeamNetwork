import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { baseSchemas } from "@/lib/security/validation";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { mentorProfileNativeSchema } from "@/lib/schemas/mentorship";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

/**
 * Native mentor_profiles edit endpoint (Phase 3 cutover).
 * GET — caller's own row; admin may pass ?user_id= to read an org peer.
 * PUT — upsert by (user_id, organization_id). Alumni/admin can edit own row;
 *       admin can edit any row by passing ?user_id=.
 *
 * Generated DB types lag the Phase 1 migration (native arrays not yet in types);
 * typed via assertion until gen:types is re-run post-deploy.
 */

type ProfileRow = {
  id: string;
  organization_id: string;
  user_id: string;
  bio: string | null;
  expertise_areas: string[] | null;
  topics: string[] | null;
  sports: string[] | null;
  positions: string[] | null;
  industries: string[] | null;
  role_families: string[] | null;
  max_mentees: number | null;
  accepting_new: boolean | null;
  meeting_preferences: string[] | null;
  time_commitment: string | null;
  years_of_experience: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type SupabaseEscape = {
  from: (t: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: unknown; error: { message?: string } | null }>;
        };
      };
    };
    upsert: (
      row: Record<string, unknown>,
      opts: { onConflict: string }
    ) => {
      select: (cols: string) => {
        single: () => Promise<{ data: unknown; error: { message?: string } | null }>;
      };
    };
  };
};

const PROFILE_COLS =
  "id, organization_id, user_id, bio, expertise_areas, topics, sports, positions, industries, role_families, max_mentees, accepting_new, meeting_preferences, time_commitment, years_of_experience, is_active, created_at, updated_at";

export async function GET(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  if (!baseSchemas.uuid.safeParse(organizationId).success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = checkRateLimit(req, {
    userId: user.id,
    orgId: organizationId,
    feature: "mentor profile read",
    limitPerUser: 60,
  });
  if (!rl.ok) return buildRateLimitResponse(rl);

  const service = createServiceClient();

  const { data: callerMembership } = await service
    .from("user_organization_roles")
    .select("role, status")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!callerMembership || callerMembership.status !== "active") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const requestedUserId = url.searchParams.get("user_id");

  let targetUserId = user.id;
  if (requestedUserId) {
    if (!baseSchemas.uuid.safeParse(requestedUserId).success) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }
    if (requestedUserId !== user.id) {
      if (callerMembership.role !== "admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      targetUserId = requestedUserId;
    }
  }

  const { data, error } = await supabase
    .from("mentor_profiles")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to load mentor profile" },
      { status: 500 }
    );
  }

  const profile = (data as ProfileRow | null) ?? null;

  // When no mentor profile exists yet, surface alumni-sourced defaults so the
  // onboarding form isn't empty. Client treats these as editable suggestions.
  let suggested: {
    bio: string | null;
    industries: string[];
    role_families: string[];
    positions: string[];
  } | null = null;

  if (!profile) {
    const { data: alumniRow } = await service
      .from("alumni")
      .select("summary, headline, industry, job_title, position_title")
      .eq("organization_id", organizationId)
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (alumniRow) {
      const bio = alumniRow.summary?.trim() || alumniRow.headline?.trim() || null;
      suggested = {
        bio,
        industries: alumniRow.industry ? [alumniRow.industry] : [],
        role_families: alumniRow.job_title ? [alumniRow.job_title] : [],
        positions: alumniRow.position_title ? [alumniRow.position_title] : [],
      };
    }
  }

  return NextResponse.json({ profile, suggested });
}

export async function PUT(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  if (!baseSchemas.uuid.safeParse(organizationId).success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = checkRateLimit(req, {
    userId: user.id,
    orgId: organizationId,
    feature: "mentor profile write",
    limitPerUser: 30,
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
    // Target must be an active org member with an eligible role
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

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = mentorProfileNativeSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const p = parsed.data;
  const row = {
    organization_id: organizationId,
    user_id: targetUserId,
    bio: p.bio?.trim() ? p.bio.trim() : null,
    expertise_areas: p.expertise_areas,
    topics: p.topics,
    sports: p.sports,
    positions: p.positions,
    industries: p.industries,
    role_families: p.role_families,
    max_mentees: p.max_mentees,
    accepting_new: p.accepting_new,
    meeting_preferences: p.meeting_preferences,
    time_commitment: p.time_commitment?.trim() ? p.time_commitment.trim() : null,
    years_of_experience: p.years_of_experience ?? null,
    is_active: true,
  };

  const sb = service as unknown as SupabaseEscape;
  const { data, error } = await sb
    .from("mentor_profiles")
    .upsert(row, { onConflict: "user_id,organization_id" })
    .select(PROFILE_COLS)
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to save mentor profile" },
      { status: 500 }
    );
  }

  return NextResponse.json({ profile: data as ProfileRow });
}
