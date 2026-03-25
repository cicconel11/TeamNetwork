import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";
import {
  fetchBrightDataProfile,
  mapBrightDataToFields,
  isBrightDataConfigured,
} from "@/lib/linkedin/bright-data";

export const dynamic = "force-dynamic";

const MAX_CONCURRENCY = 5;

/**
 * GET /api/cron/linkedin-bulk-sync
 *
 * Quarterly cron job that re-syncs LinkedIn employment data for all members
 * in orgs that have linkedin_resync_enabled = true.
 *
 * Only processes members who have a linkedin_url on file.
 * Does NOT count against the user's 2/month manual rate limit.
 */
export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  if (!isBrightDataConfigured()) {
    return NextResponse.json({
      error: "BRIGHT_DATA_API_KEY not configured",
      processed: 0,
    }, { status: 503 });
  }

  const supabase = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orgs, error: orgError } = await (supabase as any)
    .from("organizations")
    .select("id, name")
    .eq("linkedin_resync_enabled", true)
    .is("deleted_at", null);

  if (orgError) {
    console.error("[linkedin-bulk-sync] Error fetching orgs:", orgError);
    return NextResponse.json({ error: orgError.message, processed: 0 }, { status: 500 });
  }

  if (!orgs || orgs.length === 0) {
    return NextResponse.json({ processed: 0, message: "No orgs with linkedin_resync_enabled" });
  }

  let ok = 0;
  let notFound = 0;
  let errors = 0;
  let skipped = 0;
  let processed = 0;

  // Track processed user IDs across orgs to avoid enriching the same user twice
  const processedUserIds = new Set<string>();

  for (const org of orgs) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: members, error: memberError } = await (supabase as any)
      .from("user_organization_roles")
      .select(`
        user_id,
        members!inner(linkedin_url)
      `)
      .eq("organization_id", org.id)
      .eq("status", "active");

    if (memberError) {
      console.error(`[linkedin-bulk-sync] Error fetching members for org ${org.id}:`, memberError);
      continue;
    }

    if (!members || members.length === 0) continue;

    // Filter to only members with a LinkedIn URL who haven't been processed yet
    const eligible = members.filter((m: Record<string, unknown>) => {
      const memberData = m.members as Record<string, string | null> | null;
      const userId = m.user_id as string;
      return memberData?.linkedin_url && !processedUserIds.has(userId);
    });

    for (let i = 0; i < eligible.length; i += MAX_CONCURRENCY) {
      const batch = eligible.slice(i, i + MAX_CONCURRENCY);

      const results = await Promise.all(
        batch.map(async (member: Record<string, unknown>) => {
          const userId = member.user_id as string;
          const memberData = member.members as Record<string, string | null>;
          const linkedinUrl = memberData.linkedin_url!;

          try {
            processedUserIds.add(userId);
            const fetchResult = await fetchBrightDataProfile(linkedinUrl);
            if (!fetchResult.ok) {
              console.error(`[linkedin-bulk-sync] Bright Data fetch failed for ${userId}:`, fetchResult.kind, fetchResult.upstreamStatus ?? "");
              return "not_found" as const;
            }

            const profile = fetchResult.profile;
            const fields = mapBrightDataToFields(profile);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error: rpcError } = await (supabase as any).rpc(
              "sync_user_linkedin_enrichment",
              {
                p_user_id: userId,
                p_job_title: fields.job_title,
                p_current_company: fields.current_company,
                p_current_city: fields.current_city,
                p_school: fields.school,
                p_major: fields.major,
                p_position_title: fields.position_title,
                p_enrichment_json: profile as unknown,
              },
            );

            if (rpcError) {
              console.error(`[linkedin-bulk-sync] RPC error for ${userId}:`, rpcError.message);
              return "error" as const;
            }

            return "ok" as const;
          } catch (err) {
            console.error(`[linkedin-bulk-sync] Error for ${userId}:`, err);
            return "error" as const;
          }
        }),
      );

      for (const r of results) {
        if (r === "ok") ok++;
        else if (r === "not_found") notFound++;
        else errors++;
      }
      processed += results.length;
    }

    skipped += members.length - eligible.length;
  }

  const summary = { processed, orgs: orgs.length, ok, not_found: notFound, errors, skipped };
  console.log("[linkedin-bulk-sync] Complete:", JSON.stringify(summary));

  return NextResponse.json(summary);
}
