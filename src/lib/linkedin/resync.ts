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
    failureKind?: "not_configured" | "invalid_url" | "upstream_error" | "malformed_payload" | "network_error" | "rpc_error";
    upstreamStatus?: number;
  }>;
}

async function getLinkedInResyncAccessContext(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<LinkedInResyncAccessContext> {
  const currentMonth = new Date().toISOString().slice(0, 7);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: connectionRow } = await (supabase as any)
    .from("user_linkedin_connections")
    .select("resync_count, resync_month")
    .eq("user_id", userId)
    .maybeSingle();

  let remaining = MAX_LINKEDIN_RESYNCS_PER_MONTH;
  if (connectionRow && connectionRow.resync_month === currentMonth) {
    remaining = Math.max(
      0,
      MAX_LINKEDIN_RESYNCS_PER_MONTH - (connectionRow.resync_count ?? 0),
    );
  }

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

  return {
    enabled,
    isAdmin,
    remaining,
    maxPerMonth: MAX_LINKEDIN_RESYNCS_PER_MONTH,
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
  const { data: claimResult, error: claimError } = await (supabase as any).rpc(
    "claim_linkedin_resync",
    { p_user_id: userId },
  );

  if (claimError) {
    console.error("[linkedin-resync] Rate limit check error:", claimError);
    return {
      ok: false,
      status: 503,
      error: "Unable to verify sync eligibility. Please try again later.",
    };
  }

  const claim = claimResult as { allowed: boolean; remaining?: number; reason?: string } | null;
  if (!claim || !claim.allowed) {
    const reason = claim?.reason;
    return {
      ok: false,
      status: 429,
      error:
        reason === "rate_limited"
          ? "You've reached your sync limit for this month (2 per month). Resets next month."
          : "LinkedIn connection not found. Please connect LinkedIn first.",
      remaining_syncs: 0,
    };
  }

  return {
    ok: true,
    remaining: claim.remaining ?? null,
  };
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

  const claim = await claimLinkedInResync(supabase, userId);
  if (!claim.ok) {
    return {
      status: claim.status,
      body: {
        error: claim.error,
        remaining_syncs: claim.remaining_syncs,
      },
    };
  }

  const enrichment = await runEnrichment(supabase, userId, linkedinUrl);
  if (!enrichment.enriched) {
    const status =
      enrichment.failureKind === "invalid_url"
        ? 400
        : enrichment.failureKind === "not_configured"
          ? 503
          : 502;

    return {
      status,
      body: {
        error: enrichment.error || "Unable to sync LinkedIn data right now.",
        remaining_syncs: claim.remaining ?? undefined,
      },
    };
  }

  return {
    status: 200,
    body: {
      message: "LinkedIn data synced",
      remaining_syncs: claim.remaining ?? undefined,
    },
  };
}
