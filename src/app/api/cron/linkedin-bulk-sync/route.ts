import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";
import {
  fetchBrightDataProfile,
  searchBrightDataProfile,
  mapBrightDataToFields,
  isBrightDataConfigured,
} from "@/lib/linkedin/bright-data";

export const dynamic = "force-dynamic";

const MAX_CONCURRENCY = 5;

interface SyncResult {
  userId: string;
  orgId: string;
  status: "ok" | "not_found" | "skipped" | "error";
  source: "url" | "search" | "none";
  error?: string;
}

/**
 * GET /api/cron/linkedin-bulk-sync
 *
 * Quarterly cron job that re-syncs LinkedIn employment data for all members
 * in orgs that have linkedin_resync_enabled = true.
 *
 * For each member:
 * - If they have a linkedin_url → fetch profile by URL via Bright Data
 * - If not → search by first_name + last_name via Bright Data discover
 * - Map fields → call sync_user_linkedin_enrichment RPC
 *
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

  // Find orgs with the feature enabled
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

  const allResults: SyncResult[] = [];

  for (const org of orgs) {
    // Get all members/alumni with their user IDs and LinkedIn info
    // Join through user_organization_roles to get user_id, then join members/alumni for names
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: members, error: memberError } = await (supabase as any)
      .from("user_organization_roles")
      .select(`
        user_id,
        members!inner(first_name, last_name, email, linkedin_url)
      `)
      .eq("organization_id", org.id)
      .is("revoked_at", null);

    if (memberError) {
      console.error(`[linkedin-bulk-sync] Error fetching members for org ${org.id}:`, memberError);
      continue;
    }

    if (!members || members.length === 0) continue;

    // Process in batches
    for (let i = 0; i < members.length; i += MAX_CONCURRENCY) {
      const batch = members.slice(i, i + MAX_CONCURRENCY);

      const batchResults = await Promise.all(
        batch.map(async (member: Record<string, unknown>): Promise<SyncResult> => {
          const userId = member.user_id as string;
          const memberData = member.members as Record<string, string | null> | null;

          if (!memberData) {
            return { userId, orgId: org.id, status: "skipped", source: "none" };
          }

          const linkedinUrl = memberData.linkedin_url;
          const firstName = memberData.first_name;
          const lastName = memberData.last_name;
          const email = memberData.email;

          try {
            let profile;
            let source: "url" | "search" = "url";

            if (linkedinUrl) {
              profile = await fetchBrightDataProfile(linkedinUrl);
            }

            if (!profile && firstName && lastName) {
              source = "search";
              profile = await searchBrightDataProfile(firstName, lastName, email ?? undefined);
            }

            if (!profile) {
              return { userId, orgId: org.id, status: "not_found", source };
            }

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
              return { userId, orgId: org.id, status: "error", source, error: rpcError.message };
            }

            return { userId, orgId: org.id, status: "ok", source };
          } catch (err) {
            return {
              userId,
              orgId: org.id,
              status: "error",
              source: "none",
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );

      allResults.push(...batchResults);
    }
  }

  const summary = {
    processed: allResults.length,
    orgs: orgs.length,
    ok: allResults.filter((r) => r.status === "ok").length,
    not_found: allResults.filter((r) => r.status === "not_found").length,
    errors: allResults.filter((r) => r.status === "error").length,
    skipped: allResults.filter((r) => r.status === "skipped").length,
  };

  console.log("[linkedin-bulk-sync] Complete:", JSON.stringify(summary));

  return NextResponse.json({ ...summary, results: allResults });
}
