import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getOrgMembership } from "@/lib/auth/api-helpers";

const BodySchema = z.object({
  orgId: z.string().uuid(),
});

/**
 * Acknowledge the org feed — advances the member's `feed_last_seen_at` to now,
 * which clears the "Jump back in" digest on the next load. Called when the
 * member clicks "Catch up" or dismisses the strip. Idempotent.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(request, {
      userId: user.id,
      feature: "mark feed seen",
      limitPerIp: 120,
      limitPerUser: 60,
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const { orgId } = parsed.data;

    const membership = await getOrgMembership(supabase, user.id, orgId);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    const { error } = await supabase
      .from("user_organization_roles")
      .update({ feed_last_seen_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("organization_id", orgId);

    if (error) {
      console.error("[api/feed/seen] update failed:", error.message);
      return NextResponse.json({ error: "Failed to update" }, { status: 500 });
    }

    return NextResponse.json({ data: { ok: true } }, { headers: rateLimit.headers });
  } catch (error) {
    console.error("[api/feed/seen] unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
