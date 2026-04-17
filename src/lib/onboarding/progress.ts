import type { OnboardingItemId } from "@/lib/schemas/onboarding";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OnboardingProgress {
  id: string | null;
  completedItems: OnboardingItemId[];
  visitedItems: OnboardingItemId[];
  welcomeSeenAt: string | null;
  tourCompletedAt: string | null;
  dismissedAt: string | null;
}

const EMPTY_PROGRESS: OnboardingProgress = {
  id: null,
  completedItems: [],
  visitedItems: [],
  welcomeSeenAt: null,
  tourCompletedAt: null,
  dismissedAt: null,
};

// ─── Server reads (Server Components / Route Handlers) ────────────────────────

/**
 * Fetch the onboarding progress row for (userId, orgId).
 * Returns a zero-state object when no row exists yet.
 * Uses the server-side Supabase client (cookie-based auth).
 */
export async function getProgress(
  userId: string,
  orgId: string
): Promise<OnboardingProgress> {
  // Dynamic import so this module is safe to import from both server and client
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("user_onboarding_progress")
    .select(
      "id, completed_items, visited_items, welcome_seen_at, tour_completed_at, dismissed_at"
    )
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (error) {
    console.error("getProgress error:", error);
    return EMPTY_PROGRESS;
  }

  if (!data) return EMPTY_PROGRESS;

  return {
    id: data.id,
    completedItems: (data.completed_items as OnboardingItemId[]) ?? [],
    visitedItems: (data.visited_items as OnboardingItemId[]) ?? [],
    welcomeSeenAt: data.welcome_seen_at ?? null,
    tourCompletedAt: data.tour_completed_at ?? null,
    dismissedAt: data.dismissed_at ?? null,
  };
}

// ─── Client mutations (Client Components) ────────────────────────────────────
// All mutations use createClient from @/lib/supabase/client (browser client)
// and follow the upsert pattern from NotificationPrefsCard.tsx.

async function upsertProgress(
  userId: string,
  orgId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();

  const { error } = await supabase
    .from("user_onboarding_progress")
    .upsert(
      {
        user_id: userId,
        organization_id: orgId,
        ...patch,
      },
      { onConflict: "user_id,organization_id" }
    );

  if (error) {
    console.error("upsertProgress error:", error);
    throw new Error(`Onboarding progress update failed: ${error.message}`);
  }
}

/** Add an item to completed_items (idempotent via jsonb array union). */
export async function markItemComplete(
  userId: string,
  orgId: string,
  itemId: OnboardingItemId,
  currentCompleted: OnboardingItemId[]
): Promise<void> {
  if (currentCompleted.includes(itemId)) return;

  await upsertProgress(userId, orgId, {
    completed_items: [...currentCompleted, itemId],
  });
}

/** Add an item to visited_items (idempotent). */
export async function markVisited(
  userId: string,
  orgId: string,
  itemId: OnboardingItemId,
  currentVisited: OnboardingItemId[]
): Promise<void> {
  if (currentVisited.includes(itemId)) return;

  await upsertProgress(userId, orgId, {
    visited_items: [...currentVisited, itemId],
  });
}

/** Set welcome_seen_at to now (first-login modal shown). */
export async function markWelcomeSeen(
  userId: string,
  orgId: string
): Promise<void> {
  await upsertProgress(userId, orgId, {
    welcome_seen_at: new Date().toISOString(),
  });
}

/** Set tour_completed_at to now. */
export async function markTourCompleted(
  userId: string,
  orgId: string
): Promise<void> {
  await upsertProgress(userId, orgId, {
    tour_completed_at: new Date().toISOString(),
  });
}

/** Set dismissed_at to now — hides the sidebar trigger. */
export async function dismissChecklist(
  userId: string,
  orgId: string
): Promise<void> {
  await upsertProgress(userId, orgId, {
    dismissed_at: new Date().toISOString(),
  });
}

/** Clear dismissed_at — re-opens the checklist. */
export async function reopenChecklist(
  userId: string,
  orgId: string
): Promise<void> {
  await upsertProgress(userId, orgId, {
    dismissed_at: null,
  });
}
