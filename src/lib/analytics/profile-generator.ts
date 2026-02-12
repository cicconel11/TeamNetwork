import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LLMAdapter } from "./llm-adapter";
import type { UIProfile, UsageSummary, ProfileInput } from "./types";

/**
 * Compute a SHA-256 hash of the aggregated summaries.
 * Used for delta detection — if the hash hasn't changed, we skip the LLM call.
 */
export function hashSummaries(summaries: UsageSummary[]): string {
  const normalized = summaries
    .map((s) => `${s.feature}:${s.visit_count}:${s.total_duration_ms}:${s.peak_hour}:${s.device_preference}`)
    .sort()
    .join("|");
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Fetch usage summaries for a user+org (last 30 days of weekly aggregates).
 */
async function fetchSummaries(
  supabase: SupabaseClient,
  userId: string,
  organizationId: string,
): Promise<UsageSummary[]> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("usage_summaries")
    .select("*")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .gte("period_end", thirtyDaysAgo.toISOString().split("T")[0])
    .order("period_start", { ascending: false });

  if (error || !data) return [];
  return data as UsageSummary[];
}

/**
 * Fetch existing cached UI profile for a user+org.
 */
async function fetchCachedProfile(
  supabase: SupabaseClient,
  userId: string,
  organizationId: string,
): Promise<{ profile: UIProfile; summary_hash: string; expires_at: string } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("ui_profiles")
    .select("profile, summary_hash, expires_at")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

/**
 * Store (upsert) a UI profile.
 */
async function upsertProfile(
  supabase: SupabaseClient,
  userId: string,
  organizationId: string,
  profile: UIProfile,
  summaryHash: string,
  providerName: string,
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from("ui_profiles")
    .upsert(
      {
        user_id: userId,
        organization_id: organizationId,
        profile,
        summary_hash: summaryHash,
        llm_provider: providerName,
        generated_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: "user_id,organization_id" },
    );
}

// ---------------------------------------------------------------------------
// Default profile (no data / no consent)
// ---------------------------------------------------------------------------

export const DEFAULT_PROFILE: UIProfile = {
  nav_order: [],
  feature_highlights: [],
  dashboard_hints: {
    show_recent_features: false,
    suggested_features: [],
    preferred_time_label: "",
  },
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Get or regenerate a UI profile for a user+org.
 *
 * Delta detection:
 *  - Hash all usage_summaries for user+org → SHA-256
 *  - Compare against ui_profiles.summary_hash
 *  - If match and not expired → return cached (no LLM call)
 *  - If mismatch or expired → call LLM, store, return
 */
export async function getOrGenerateProfile(
  supabase: SupabaseClient,
  adapter: LLMAdapter,
  userId: string,
  organizationId: string,
  userRole: string,
  orgType: string,
  availableFeatures: string[],
): Promise<UIProfile> {
  // 1. Fetch summaries + cached profile in parallel (independent queries)
  const [summaries, cached] = await Promise.all([
    fetchSummaries(supabase, userId, organizationId),
    fetchCachedProfile(supabase, userId, organizationId),
  ]);

  if (summaries.length === 0) {
    console.log(JSON.stringify({ event: "analytics_profile", cache_hit: false, reason: "no_data", user_id: userId, org_id: organizationId }));
    return DEFAULT_PROFILE;
  }

  // 2. Compute hash of current data
  const currentHash = hashSummaries(summaries);

  // 3. Check for cached profile
  const cacheHit = cached && new Date(cached.expires_at) > new Date() && cached.summary_hash === currentHash;
  console.log(JSON.stringify({ event: "analytics_profile", cache_hit: !!cacheHit, user_id: userId, org_id: organizationId }));

  if (cacheHit) {
    return cached.profile;
  }

  // 4. Generate via LLM
  const input: ProfileInput = {
    summaries,
    availableFeatures,
    userRole,
    orgType,
  };

  const llmStart = Date.now();
  const profile = await adapter.generateUIProfile(input);
  const llmLatencyMs = Date.now() - llmStart;
  console.log(JSON.stringify({ event: "analytics_llm_call", provider: adapter.providerName, latency_ms: llmLatencyMs, summary_count: summaries.length }));

  // 5. Cache the result
  await upsertProfile(supabase, userId, organizationId, profile, currentHash, adapter.providerName);

  return profile;
}
