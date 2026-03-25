import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";
import {
  isBrightDataConfigured,
  triggerBulkEnrichment,
  getSnapshotProgress,
  getSnapshotResults,
  mapBrightDataToFields,
} from "@/lib/linkedin/bright-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BATCH_SIZE = 30;
const MAX_RUNTIME_MS = 25_000;
const MAX_RETRIES = 3;
const POLL_INTERVAL_MS = 3_000;

/**
 * Cron job to process the LinkedIn enrichment queue.
 * Runs every 5 minutes, picks up alumni with enrichment_status = 'pending',
 * enriches them via Bright Data, and writes results back.
 */
export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  if (!isBrightDataConfigured()) {
    return NextResponse.json({ ok: true, skipped: true, reason: "BRIGHT_DATA_API_KEY not configured" });
  }

  const startTime = Date.now();
  let enriched = 0;
  let failed = 0;
  let skipped = 0;

  try {
    const supabase = createServiceClient();

    // Fetch pending alumni with linkedin_url
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pendingAlumni, error: fetchError } = await (supabase as any)
      .from("alumni")
      .select("id, organization_id, linkedin_url, enrichment_error")
      .eq("enrichment_status", "pending")
      .is("deleted_at", null)
      .not("linkedin_url", "is", null)
      .limit(BATCH_SIZE);

    if (fetchError) {
      console.error("[enrichment-process] Failed to fetch pending alumni:", fetchError);
      return NextResponse.json({ error: "Failed to fetch pending alumni" }, { status: 500 });
    }

    if (!pendingAlumni || pendingAlumni.length === 0) {
      return NextResponse.json({ ok: true, enriched: 0, failed: 0, skipped: 0 });
    }

    // Filter out records that have exceeded max retries
    const eligible = pendingAlumni.filter((a: { enrichment_error: string | null }) => {
      if (!a.enrichment_error) return true;
      const retryMatch = a.enrichment_error.match(/\[retry (\d+)\]/);
      return !retryMatch || parseInt(retryMatch[1], 10) < MAX_RETRIES;
    });

    const exhausted = pendingAlumni.length - eligible.length;
    if (exhausted > 0) {
      // Mark exhausted records as failed permanently
      const exhaustedIds = pendingAlumni
        .filter((a: { enrichment_error: string | null }) => {
          if (!a.enrichment_error) return false;
          const retryMatch = a.enrichment_error.match(/\[retry (\d+)\]/);
          return retryMatch && parseInt(retryMatch[1], 10) >= MAX_RETRIES;
        })
        .map((a: { id: string }) => a.id);

      if (exhaustedIds.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from("alumni")
          .update({ enrichment_status: "failed" })
          .in("id", exhaustedIds);
        failed += exhaustedIds.length;
      }
    }

    if (eligible.length === 0) {
      return NextResponse.json({ ok: true, enriched: 0, failed, skipped: 0 });
    }

    // Collect unique LinkedIn URLs
    const urlToAlumni = new Map<string, Array<{ id: string; organization_id: string; enrichment_error: string | null }>>();
    for (const alumnus of eligible) {
      const url = alumnus.linkedin_url as string;
      if (!urlToAlumni.has(url)) {
        urlToAlumni.set(url, []);
      }
      urlToAlumni.get(url)!.push(alumnus);
    }

    const urls = Array.from(urlToAlumni.keys());

    // Trigger bulk enrichment
    const triggerResult = await triggerBulkEnrichment(urls);
    if (!triggerResult) {
      // Mark all as failed with retry count
      for (const alumnus of eligible) {
        const retryCount = getRetryCount(alumnus.enrichment_error) + 1;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from("alumni")
          .update({
            enrichment_error: `[retry ${retryCount}] Bright Data trigger failed`,
            enrichment_status: retryCount >= MAX_RETRIES ? "failed" : "pending",
          })
          .eq("id", alumnus.id);
        failed++;
      }
      return NextResponse.json({ ok: true, enriched, failed, skipped });
    }

    // Poll for results until ready or timeout
    let results = null;
    while (Date.now() - startTime < MAX_RUNTIME_MS) {
      const progress = await getSnapshotProgress(triggerResult.snapshot_id);
      if (!progress) break;

      if (progress.status === "ready") {
        results = await getSnapshotResults(triggerResult.snapshot_id);
        break;
      }

      if (progress.status === "failed") {
        console.error("[enrichment-process] Bright Data snapshot failed:", triggerResult.snapshot_id);
        break;
      }

      // Wait before polling again
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    if (!results) {
      // Timed out or failed — leave as pending for next cron run
      for (const alumnus of eligible) {
        const retryCount = getRetryCount(alumnus.enrichment_error) + 1;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from("alumni")
          .update({
            enrichment_error: `[retry ${retryCount}] Bright Data snapshot not ready in time`,
            enrichment_status: retryCount >= MAX_RETRIES ? "failed" : "pending",
          })
          .eq("id", alumnus.id);
      }
      skipped = eligible.length;
      return NextResponse.json({ ok: true, enriched, failed, skipped });
    }

    // Map results back to alumni records by input_url
    for (const profile of results) {
      const inputUrl = profile.input_url || profile.url;
      if (!inputUrl) continue;

      // Find matching alumni by URL (try both input_url and url)
      const matchingAlumni = urlToAlumni.get(inputUrl) ||
        Array.from(urlToAlumni.entries()).find(([key]) =>
          inputUrl.includes(key.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, ""))
        )?.[1];

      if (!matchingAlumni) {
        skipped++;
        continue;
      }

      const fields = mapBrightDataToFields(profile);

      for (const alumnus of matchingAlumni) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error } = await (supabase as any).rpc("enrich_alumni_by_id", {
            p_alumni_id: alumnus.id,
            p_organization_id: alumnus.organization_id,
            p_job_title: fields.job_title,
            p_current_company: fields.current_company,
            p_current_city: fields.current_city,
            p_school: fields.school,
            p_major: fields.major,
            p_position_title: fields.position_title,
            p_headline: fields.headline,
            p_summary: fields.summary,
            p_skills: null, // Not reliably available from Bright Data
            p_work_history: fields.work_history,
            p_education_history: fields.education_history,
            p_enrichment_json: profile,
          });

          if (error) {
            console.error("[enrichment-process] RPC error for alumni", alumnus.id, ":", error);
            const retryCount = getRetryCount(alumnus.enrichment_error) + 1;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any)
              .from("alumni")
              .update({
                enrichment_error: `[retry ${retryCount}] RPC error: ${error.message}`,
                enrichment_status: retryCount >= MAX_RETRIES ? "failed" : "pending",
              })
              .eq("id", alumnus.id);
            failed++;
          } else {
            enriched++;
          }
        } catch (err) {
          console.error("[enrichment-process] Error enriching alumni", alumnus.id, ":", err);
          failed++;
        }
      }
    }

    return NextResponse.json({
      ok: true,
      enriched,
      failed,
      skipped,
      durationMs: Date.now() - startTime,
    });
  } catch (err) {
    console.error("[enrichment-process] Error:", err);
    return NextResponse.json(
      { error: "Failed to process enrichment queue" },
      { status: 500 }
    );
  }
}

function getRetryCount(enrichmentError: string | null): number {
  if (!enrichmentError) return 0;
  const match = enrichmentError.match(/\[retry (\d+)\]/);
  return match ? parseInt(match[1], 10) : 0;
}
