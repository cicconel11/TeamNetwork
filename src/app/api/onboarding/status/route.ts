import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getProgress } from "@/lib/onboarding/progress";
import { detectCompletedItems } from "@/lib/onboarding/detect";
import type { OnboardingItemId } from "@/lib/schemas/onboarding";

const querySchema = z.object({
  orgId: z.string().uuid(),
  memberId: z.string().uuid().optional(),
});

/**
 * GET /api/onboarding/status?orgId=<uuid>&memberId=<uuid>
 *
 * Returns the current onboarding progress merged with auto-detected completions.
 * Auto-detected items are persisted on each call so the checklist stays in sync.
 *
 * Security:
 * - Caller must be authenticated.
 * - Caller must be an active member of `orgId` — prevents cross-org writes /
 *   existence probing against orgs the user doesn't belong to.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  let params: z.infer<typeof querySchema>;
  try {
    params = querySchema.parse({
      orgId: url.searchParams.get("orgId") ?? undefined,
      memberId: url.searchParams.get("memberId") ?? undefined,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid parameters", details: e.flatten() },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const { orgId, memberId } = params;

  // Verify the caller is a member of this org before doing any work.
  // Mirrors the pattern in src/app/api/calendar/preferences/route.ts.
  const { data: membership, error: membershipError } = await supabase
    .from("user_organization_roles")
    .select("id")
    .eq("user_id", user.id)
    .eq("organization_id", orgId)
    .eq("status", "active")
    .maybeSingle();

  if (membershipError || !membership) {
    return NextResponse.json(
      { error: "Forbidden", message: "You are not a member of this organization." },
      { status: 403 }
    );
  }

  // Fetch stored progress and auto-detect in parallel
  const [stored, autoCompleted] = await Promise.all([
    getProgress(user.id, orgId),
    detectCompletedItems({ userId: user.id, orgId, memberId }),
  ]);

  // Persist any newly auto-detected items that weren't already in completed_items
  const newAutoCompleted = autoCompleted.filter(
    (id) => !stored.completedItems.includes(id)
  );

  if (newAutoCompleted.length > 0) {
    const allCompleted: OnboardingItemId[] = [
      ...stored.completedItems,
      ...newAutoCompleted,
    ];

    // Upsert the merged set. Errors don't block the response — client can retry.
    const { error: upsertError } = await supabase
      .from("user_onboarding_progress")
      .upsert(
        {
          user_id: user.id,
          organization_id: orgId,
          completed_items: allCompleted,
        },
        { onConflict: "user_id,organization_id" }
      );

    if (upsertError) {
      console.error("[onboarding/status] upsert failed:", upsertError);
    }
  }

  return NextResponse.json({
    completedItems: [
      ...new Set([...stored.completedItems, ...autoCompleted]),
    ],
    visitedItems: stored.visitedItems,
    welcomeSeenAt: stored.welcomeSeenAt,
    tourCompletedAt: stored.tourCompletedAt,
    dismissedAt: stored.dismissedAt,
    autoCompleted,
  });
}
