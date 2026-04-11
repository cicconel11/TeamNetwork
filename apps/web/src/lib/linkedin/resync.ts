import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isBrightDataConfigured } from "@/lib/linkedin/bright-data";
import { runBrightDataEnrichment } from "@/lib/linkedin/oauth";
import { getLinkedInProfileUrlForUser } from "@/lib/linkedin/settings";

export const MAX_LINKEDIN_RESYNCS_PER_MONTH = 2;

export interface LinkedInResyncStatus {
  enabled: boolean;
  isAdmin: boolean;
  remaining: number;
  maxPerMonth: number;
}

interface LinkedInResyncAccessContext extends LinkedInResyncStatus {
  hasActiveMembership: boolean;
}

export type ClaimLinkedInResyncResult =
  | { ok: true; remaining: number | null }
  | { ok: false; status: number; error: string; remaining_syncs?: number };

type LinkedInManualSyncReservationResult =
  | { ok: true; attemptId: string; remaining: number | null }
  | { ok: false; status: number; error: string; remaining_syncs?: number };

export type PerformBrightDataSyncResult = {
  status: number;
  body: {
    message?: string;
    error?: string;
    remaining_syncs?: number;
  };
};

interface PerformBrightDataSyncDependencies {
  isConfigured?: () => boolean;
  runEnrichment?: (
    supabase: SupabaseClient<Database>,
    userId: string,
    linkedinUrl: string,
  ) => Promise<{
    enriched: boolean;
    error?: string;
    failureKind?:
      | "not_configured"
      | "invalid_url"
      | "unauthorized"
      | "provider_unavailable"
      | "upstream_error"
      | "malformed_payload"
      | "network_error"
      | "rpc_error";
    upstreamStatus?: number;
  }>;
}

async function getManualSyncQuotaStatus(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ remaining: number; maxPerMonth: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(
    "get_linkedin_manual_sync_status",
    { p_user_id: userId },
  );

  if (error) {
    console.error("[linkedin-resync] Failed to fetch manual sync status:", error);
    return {
      remaining: MAX_LINKEDIN_RESYNCS_PER_MONTH,
      maxPerMonth: MAX_LINKEDIN_RESYNCS_PER_MONTH,
    };
  }

  const status = data as { remaining?: number; max_per_month?: number } | null;
  return {
    remaining:
      typeof status?.remaining === "number"
        ? status.remaining
        : MAX_LINKEDIN_RESYNCS_PER_MONTH,
    maxPerMonth:
      typeof status?.max_per_month === "number"
        ? status.max_per_month
        : MAX_LINKEDIN_RESYNCS_PER_MONTH,
  };
}

async function getLinkedInResyncAccessContext(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<LinkedInResyncAccessContext> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: membership } = await (supabase as any)
    .from("user_organization_roles")
    .select("role, organization_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  let enabled = false;
  const isAdmin = membership?.role === "admin";

  if (membership?.organization_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: organization } = await (supabase as any)
      .from("organizations")
      .select("linkedin_resync_enabled")
      .eq("id", membership.organization_id)
      .maybeSingle();

    enabled = organization?.linkedin_resync_enabled === true;
  }

  const quotaStatus = await getManualSyncQuotaStatus(supabase, userId);

  return {
    enabled,
    isAdmin,
    remaining: quotaStatus.remaining,
    maxPerMonth: quotaStatus.maxPerMonth,
    hasActiveMembership: Boolean(membership),
  };
}

export async function getLinkedInResyncStatus(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<LinkedInResyncStatus> {
  const context = await getLinkedInResyncAccessContext(supabase, userId);

  return {
    enabled: context.enabled,
    isAdmin: context.isAdmin,
    remaining: context.remaining,
    maxPerMonth: context.maxPerMonth,
  };
}

export async function claimLinkedInResync(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<ClaimLinkedInResyncResult> {
  const reservation = await reserveLinkedInManualSync(supabase, userId);

  if (!reservation.ok) {
    return reservation;
  }

  return {
    ok: true,
    remaining: reservation.remaining,
  };
}

async function reserveLinkedInManualSync(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<LinkedInManualSyncReservationResult> {
  const context = await getLinkedInResyncAccessContext(supabase, userId);

  if (!context.hasActiveMembership) {
    return {
      ok: false,
      status: 403,
      error: "You are not a member of any organization.",
    };
  }

  if (!context.isAdmin && !context.enabled) {
    return {
      ok: false,
      status: 403,
      error: "LinkedIn re-sync is not enabled for your organization.",
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: reservationResult, error: reservationError } = await (supabase as any).rpc(
    "reserve_linkedin_manual_sync",
    { p_user_id: userId },
  );

  if (reservationError) {
    console.error("[linkedin-resync] Rate limit check error:", reservationError);
    return {
      ok: false,
      status: 503,
      error: "Unable to verify sync eligibility. Please try again later.",
    };
  }

  const reservation = reservationResult as {
    allowed: boolean;
    attempt_id?: string;
    remaining?: number;
    reason?: string;
  } | null;

  if (!reservation || !reservation.allowed) {
    const reason = reservation?.reason;
    return {
      ok: false,
      status: 429,
      error:
        reason === "rate_limited"
          ? "You've reached your sync limit for this month (2 per month). Resets next month."
          : "Unable to verify sync eligibility. Please try again later.",
      remaining_syncs: 0,
    };
  }

  if (!reservation.attempt_id) {
    console.error("[linkedin-resync] reserve_linkedin_manual_sync returned no attempt_id");
    return {
      ok: false,
      status: 503,
      error: "Unable to verify sync eligibility. Please try again later.",
    };
  }

  return {
    ok: true,
    attemptId: reservation.attempt_id,
    remaining: reservation.remaining ?? null,
  };
}

async function completeLinkedInManualSync(
  supabase: SupabaseClient<Database>,
  attemptId: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc(
    "complete_linkedin_manual_sync",
    { p_attempt_id: attemptId },
  );

  if (error) {
    console.error("[linkedin-resync] Failed to complete manual sync reservation:", error);
  }
}

async function releaseLinkedInManualSync(
  supabase: SupabaseClient<Database>,
  attemptId: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc(
    "release_linkedin_manual_sync",
    { p_attempt_id: attemptId },
  );

  if (error) {
    console.error("[linkedin-resync] Failed to release manual sync reservation:", error);
  }
}

export async function performBrightDataSync(
  supabase: SupabaseClient<Database>,
  userId: string,
  dependencies: PerformBrightDataSyncDependencies = {},
): Promise<PerformBrightDataSyncResult> {
  const isConfigured = dependencies.isConfigured ?? isBrightDataConfigured;
  const runEnrichment = dependencies.runEnrichment ?? runBrightDataEnrichment;

  if (!isConfigured()) {
    return {
      status: 503,
      body: {
        error: "Bright Data sync is not configured in this environment.",
      },
    };
  }

  const linkedinUrl = await getLinkedInProfileUrlForUser(supabase, userId);
  if (!linkedinUrl) {
    return {
      status: 400,
      body: {
        error: "Save a valid LinkedIn profile URL before syncing LinkedIn data.",
      },
    };
  }

  const reservation = await reserveLinkedInManualSync(supabase, userId);
  if (!reservation.ok) {
    return {
      status: reservation.status,
      body: {
        error: reservation.error,
        remaining_syncs: reservation.remaining_syncs,
      },
    };
  }

  try {
    const enrichment = await runEnrichment(supabase, userId, linkedinUrl);
    if (!enrichment.enriched) {
      await releaseLinkedInManualSync(supabase, reservation.attemptId);
      const status =
        enrichment.failureKind === "invalid_url"
          ? 400
          : enrichment.failureKind === "not_configured" ||
              enrichment.failureKind === "unauthorized" ||
              enrichment.failureKind === "provider_unavailable"
            ? 503
            : 502;

      return {
        status,
        body: {
          error: enrichment.error || "Unable to sync LinkedIn data right now.",
          remaining_syncs: reservation.remaining ?? undefined,
        },
      };
    }

    await completeLinkedInManualSync(supabase, reservation.attemptId);
    return {
      status: 200,
      body: {
        message: "LinkedIn data synced",
        remaining_syncs: reservation.remaining ?? undefined,
      },
    };
  } catch (error) {
    await releaseLinkedInManualSync(supabase, reservation.attemptId);
    console.error("[linkedin-resync] Unexpected manual sync error:", error);
    return {
      status: 500,
      body: {
        error: "An error occurred while syncing LinkedIn data.",
        remaining_syncs: reservation.remaining ?? undefined,
      },
    };
  }
}
