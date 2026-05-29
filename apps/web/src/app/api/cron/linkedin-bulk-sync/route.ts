import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";
import { isApifyConfigured, startApifyProfileRun } from "@/lib/linkedin/apify";
import { recordRunTargets } from "@/lib/linkedin/enrichment-writeback";
import { normalizeLinkedInProfileUrl } from "@/lib/alumni/linkedin-url";

export const dynamic = "force-dynamic";

// Apify accepts many URLs per run; chunk so a single run isn't unbounded.
const URLS_PER_RUN = 100;

function safeNormalize(url: string): string | null {
  try {
    return normalizeLinkedInProfileUrl(url);
  } catch {
    return null;
  }
}

/**
 * GET /api/cron/linkedin-bulk-sync
 *
 * Quarterly cron that re-syncs LinkedIn employment data for all members in orgs
 * with linkedin_resync_enabled = true. Starts Apify runs (async); results land
 * via the apify-webhook. Does NOT count against the user's manual rate limit.
 */
export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  if (!isApifyConfigured()) {
    return NextResponse.json({ error: "Apify not configured", processed: 0 }, { status: 503 });
  }

  const supabase = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orgs, error: orgError } = await (supabase as any)
    .from("organizations")
    .select("id")
    .eq("linkedin_resync_enabled", true);

  if (orgError) {
    console.error("[linkedin-bulk-sync] Error fetching orgs:", orgError);
    return NextResponse.json({ error: orgError.message, processed: 0 }, { status: 500 });
  }

  if (!orgs || orgs.length === 0) {
    return NextResponse.json({ processed: 0, message: "No orgs with linkedin_resync_enabled" });
  }

  // Collect one entry per user (dedupe across orgs).
  const byUser = new Map<string, string>(); // userId -> normalized url

  for (const org of orgs) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: members, error: memberError } = await (supabase as any)
      .from("user_organization_roles")
      .select("user_id, members!inner(linkedin_url)")
      .eq("organization_id", org.id)
      .eq("status", "active");

    if (memberError) {
      console.error(`[linkedin-bulk-sync] Error fetching members for org ${org.id}:`, memberError);
      continue;
    }

    for (const m of (members ?? []) as Array<Record<string, unknown>>) {
      const userId = m.user_id as string | null;
      const memberData = m.members as { linkedin_url: string | null } | null;
      if (!userId || byUser.has(userId)) continue;
      const url = memberData?.linkedin_url;
      if (!url) continue;
      const normalized = safeNormalize(url);
      if (normalized) byUser.set(userId, normalized);
    }
  }

  const entries = Array.from(byUser.entries());
  let runsStarted = 0;
  let queued = 0;
  let failed = 0;

  for (let i = 0; i < entries.length; i += URLS_PER_RUN) {
    const chunk = entries.slice(i, i + URLS_PER_RUN);
    const start = await startApifyProfileRun(chunk.map(([, url]) => url));
    if (!start.ok) {
      console.error("[linkedin-bulk-sync] run start failed:", start.kind, start.error);
      failed += chunk.length;
      continue;
    }
    await recordRunTargets(
      supabase,
      start.runId,
      chunk.map(([userId, url]) => ({ kind: "user" as const, userId, linkedinUrl: url })),
    );
    runsStarted += 1;
    queued += chunk.length;
  }

  const summary = { orgs: orgs.length, runs_started: runsStarted, queued, failed };
  console.info("[linkedin-bulk-sync] Complete:", JSON.stringify(summary));
  return NextResponse.json(summary);
}
