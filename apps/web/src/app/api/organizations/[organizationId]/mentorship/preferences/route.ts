import { NextResponse } from "next/server";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";
import { createServiceClient } from "@/lib/supabase/service";
import { baseSchemas } from "@/lib/security/validation";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { menteePreferencesSchema } from "@/lib/schemas/mentorship";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

/**
 * Native mentee_preferences endpoint (Phase 2 cutover).
 * GET — current user's row (admin may pass ?user_id= to read an org peer).
 * PUT — single-row upsert by (organization_id, user_id). user_id server-enforced.
 *
 * Generated DB types lag the Phase 1 migration; typed via assertion until
 * `npm run gen:types` runs post-deploy.
 */

type PrefsRow = {
  id: string;
  organization_id: string;
  user_id: string;
  goals: string | null;
  seeking_mentorship: boolean;
  preferred_topics: string[] | null;
  preferred_industries: string[] | null;
  preferred_role_families: string[] | null;
  preferred_sports: string[] | null;
  preferred_positions: string[] | null;
  required_attributes: string[] | null;
  nice_to_have_attributes: string[] | null;
  time_availability: string | null;
  communication_prefs: string[] | null;
  geographic_pref: string | null;
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

export async function GET(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  if (!baseSchemas.uuid.safeParse(organizationId).success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const { supabase, user } = await createAuthenticatedApiClient(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = checkRateLimit(req, {
    userId: user.id,
    orgId: organizationId,
    feature: "mentorship preferences read",
    limitPerUser: 60,
  });
  if (!rl.ok) return buildRateLimitResponse(rl);

  const url = new URL(req.url);
  const requestedUserId = url.searchParams.get("user_id");

  const service = createServiceClient();

  // Caller membership + role
  const { data: callerMembership } = await service
    .from("user_organization_roles")
    .select("role, status")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!callerMembership || callerMembership.status !== "active") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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

  const sb = service as unknown as SupabaseEscape;
  const { data, error } = await sb
    .from("mentee_preferences")
    .select(
      "id, organization_id, user_id, goals, seeking_mentorship, preferred_topics, preferred_industries, preferred_role_families, preferred_sports, preferred_positions, required_attributes, nice_to_have_attributes, time_availability, communication_prefs, geographic_pref, created_at, updated_at"
    )
    .eq("organization_id", organizationId)
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to load preferences" },
      { status: 500 }
    );
  }

  return NextResponse.json({ preferences: (data as PrefsRow | null) ?? null });
}

export async function PUT(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  if (!baseSchemas.uuid.safeParse(organizationId).success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const { supabase, user } = await createAuthenticatedApiClient(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = checkRateLimit(req, {
    userId: user.id,
    orgId: organizationId,
    feature: "mentorship preferences write",
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
    !["admin", "active_member", "alumni", "parent"].includes(callerMembership.role)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = menteePreferencesSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const p = parsed.data;
  const row = {
    organization_id: organizationId,
    user_id: user.id, // server-enforced; client cannot override
    goals: p.goals?.trim() ? p.goals.trim() : null,
    seeking_mentorship: p.seeking_mentorship,
    preferred_topics: p.preferred_topics,
    preferred_industries: p.preferred_industries,
    preferred_role_families: p.preferred_role_families,
    preferred_sports: p.preferred_sports,
    preferred_positions: p.preferred_positions,
    required_attributes: p.required_attributes,
    nice_to_have_attributes: p.nice_to_have_attributes,
    time_availability: p.time_availability && p.time_availability.length > 0
      ? p.time_availability
      : null,
    communication_prefs: p.communication_prefs,
    geographic_pref: p.geographic_pref?.trim() ? p.geographic_pref.trim() : null,
  };

  const sb = service as unknown as SupabaseEscape;
  const { data, error } = await sb
    .from("mentee_preferences")
    .upsert(row, { onConflict: "organization_id,user_id" })
    .select(
      "id, organization_id, user_id, goals, seeking_mentorship, preferred_topics, preferred_industries, preferred_role_families, preferred_sports, preferred_positions, required_attributes, nice_to_have_attributes, time_availability, communication_prefs, geographic_pref, created_at, updated_at"
    )
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to save preferences" },
      { status: 500 }
    );
  }

  return NextResponse.json({ preferences: data as PrefsRow });
}
