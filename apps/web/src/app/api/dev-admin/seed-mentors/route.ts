import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  isDevAdmin,
  logDevAdminAction,
  extractRequestContext,
} from "@/lib/auth/dev-admin";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  orgId: baseSchemas.uuid,
});

const SEED_TEMPLATES = [
  {
    industry: "Finance",
    expertise_areas: ["Investment Banking", "Capital Markets"],
    topics: ["finance", "recruiting"],
    meeting_preferences: ["video", "phone"],
    years_of_experience: 14,
    graduation_year: 2010,
  },
  {
    industry: "Tech",
    expertise_areas: ["Software Engineering"],
    topics: ["engineering", "career"],
    meeting_preferences: ["video"],
    years_of_experience: 10,
    graduation_year: 2014,
  },
  {
    industry: "Education",
    expertise_areas: ["Teaching", "Curriculum Design"],
    topics: ["education"],
    meeting_preferences: ["video", "in_person"],
    years_of_experience: 8,
    graduation_year: 2016,
  },
  {
    industry: "Healthcare",
    expertise_areas: ["Medicine", "Public Health"],
    topics: ["healthcare", "wellness"],
    meeting_preferences: ["video"],
    years_of_experience: 6,
    graduation_year: 2018,
  },
  {
    industry: "Marketing",
    expertise_areas: ["Brand Strategy", "Content"],
    topics: ["marketing", "career"],
    meeting_preferences: ["video", "phone"],
    years_of_experience: 4,
    graduation_year: 2020,
  },
];

export async function POST(req: Request) {
  try {
    const ipRateLimit = checkRateLimit(req, {
      feature: "dev-admin",
      limitPerIp: 30,
      limitPerUser: 0,
    });
    if (!ipRateLimit.ok) return buildRateLimitResponse(ipRateLimit);

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const userRateLimit = checkRateLimit(req, {
      userId: user?.id ?? null,
      feature: "dev-admin",
      limitPerIp: 0,
      limitPerUser: 20,
    });
    if (!userRateLimit.ok) return buildRateLimitResponse(userRateLimit);

    if (!isDevAdmin(user)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const json = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { orgId } = parsed.data;

    const serviceClient = createServiceClient();

    const { data: roleRows, error: roleError } = await serviceClient
      .from("user_organization_roles")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("status", "active")
      .in("role", ["alumni", "active_member"])
      .limit(5);

    if (roleError) {
      console.error("seed-mentors: role query failed", roleError);
      return NextResponse.json({ error: roleError.message }, { status: 500 });
    }

    const candidates = roleRows ?? [];
    if (candidates.length === 0) {
      return NextResponse.json({ inserted: 0, skipped: 0 });
    }

    const { data: existingRows } = await serviceClient
      .from("mentor_profiles")
      .select("user_id")
      .eq("organization_id", orgId)
      .in("user_id", candidates.map((c) => c.user_id));

    const existingIds = new Set((existingRows ?? []).map((r) => r.user_id));

    const toInsert = candidates
      .filter((c) => !existingIds.has(c.user_id))
      .map((c, idx) => {
        const tpl = SEED_TEMPLATES[idx % SEED_TEMPLATES.length];
        return {
          user_id: c.user_id,
          organization_id: orgId,
          bio: `Seeded mentor in ${tpl.industry}.`,
          expertise_areas: tpl.expertise_areas,
          topics: tpl.topics,
          meeting_preferences: tpl.meeting_preferences,
          years_of_experience: tpl.years_of_experience,
          accepting_new: true,
          is_active: true,
          max_mentees: 3,
        };
      });

    let inserted = 0;
    if (toInsert.length > 0) {
      const { error: insertError, data: insertedRows } = await (
        serviceClient.from("mentor_profiles") as unknown as {
          insert: (rows: unknown) => {
            select: (cols: string) => Promise<{
              error: { message: string } | null;
              data: Array<{ id: string }> | null;
            }>;
          };
        }
      )
        .insert(toInsert)
        .select("id");
      if (insertError) {
        console.error("seed-mentors: insert failed", insertError);
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
      inserted = insertedRows?.length ?? 0;
    }

    // Best-effort: fill missing industry/graduation_year on existing alumni rows
    // so the directory shows varied filter values. Skip users without alumni rows.
    await Promise.all(
      candidates.map((c, idx) => {
        const tpl = SEED_TEMPLATES[idx % SEED_TEMPLATES.length];
        return serviceClient
          .from("alumni")
          .update({ industry: tpl.industry, graduation_year: tpl.graduation_year })
          .eq("organization_id", orgId)
          .eq("user_id", c.user_id)
          .is("deleted_at", null);
      })
    );

    if (user) {
      logDevAdminAction({
        adminUserId: user.id,
        adminEmail: user.email ?? "",
        action: "view_org",
        ...extractRequestContext(req),
        metadata: { seedMentors: true, orgId, inserted, skipped: existingIds.size },
      });
    }

    return NextResponse.json({ inserted, skipped: existingIds.size });
  } catch (error) {
    console.error("seed-mentors: unexpected error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
