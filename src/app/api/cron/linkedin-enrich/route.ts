import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";
import { runProxycurlEnrichment, getLinkedInUrlForUser } from "@/lib/linkedin/oauth";

export const dynamic = "force-dynamic";

/** Enrichment cutoff: 90 days */
const ENRICHMENT_INTERVAL_DAYS = 90;

/**
 * GET /api/cron/linkedin-enrich
 *
 * Batch-enriches all connected LinkedIn users whose last enrichment is
 * older than 90 days (or never enriched). Runs quarterly via Vercel cron.
 * Sequential processing to respect Proxycurl rate limits.
 */
export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const serviceClient = createServiceClient();
  const cutoff = new Date(Date.now() - ENRICHMENT_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: connections, error } = await (serviceClient as any)
    .from("user_linkedin_connections")
    .select("user_id, linkedin_profile_url, last_enriched_at")
    .in("status", ["connected", "enriched_only"])
    .or(`last_enriched_at.is.null,last_enriched_at.lt.${cutoff}`);

  if (error) {
    console.error("[linkedin-enrich-cron] Failed to load connections:", error);
    return NextResponse.json(
      { error: "Database error", message: "Failed to load connections." },
      { status: 500 }
    );
  }

  const eligible = connections ?? [];
  let enriched = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  // Sequential processing to avoid Proxycurl rate limits
  for (const conn of eligible) {
    const userId: string = conn.user_id;
    try {
      const linkedinUrl = await getLinkedInUrlForUser(serviceClient, userId, conn.linkedin_profile_url || null);

      if (!linkedinUrl) {
        skipped++;
        continue;
      }

      const result = await runProxycurlEnrichment(serviceClient, userId, linkedinUrl, true);

      if (result.enriched) {
        enriched++;
      } else if (result.error) {
        failed++;
        errors.push(`${userId}: ${result.error}`);
      } else {
        skipped++;
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : "Unknown error";
      errors.push(`${userId}: ${msg}`);
      console.error(`[linkedin-enrich-cron] Per-user error for ${userId}:`, err);
    }
  }

  return NextResponse.json({
    processed: eligible.length,
    enriched,
    skipped,
    failed,
    errors: errors.slice(0, 20),
  });
}
