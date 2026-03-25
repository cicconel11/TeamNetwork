import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";
import {
  triggerBulkEnrichment,
  getSnapshotProgress,
  getSnapshotResults,
  mapBrightDataToFields,
  isBrightDataConfigured,
} from "@/lib/linkedin/bright-data";
import { normalizeLinkedInProfileUrl } from "@/lib/alumni/linkedin-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const BATCH_SIZE = 30;
const MAX_RETRIES = 3;

interface PendingAlumni {
  id: string;
  organization_id: string;
  linkedin_url: string;
  enrichment_retry_count: number;
  enrichment_snapshot_id: string | null;
}

/** Wraps normalizeLinkedInProfileUrl in try/catch, returns null on error. */
function safeNormalize(url: string): string | null {
  try {
    return normalizeLinkedInProfileUrl(url);
  } catch {
    return null;
  }
}

/**
 * Cron job to process alumni LinkedIn enrichment via Bright Data.
 *
 * Two-phase approach:
 *   Phase 1 — Trigger: pick up pending alumni without a snapshot, send to Bright Data.
 *   Phase 2 — Collect: check snapshot progress, download results, write to DB.
 */
export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  if (!isBrightDataConfigured()) {
    return NextResponse.json({ ok: true, skipped: "bright_data_not_configured" });
  }

  const supabase = createServiceClient();
  let enrichedCount = 0;
  let failedCount = 0;
  let triggeredCount = 0;

  try {
    // -----------------------------------------------------------------------
    // Phase 1: Trigger — pick up pending alumni without a snapshot
    // -----------------------------------------------------------------------
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: triggerBatch, error: triggerErr } = await (supabase as any)
      .from("alumni")
      .select("id, organization_id, linkedin_url, enrichment_retry_count, enrichment_snapshot_id")
      .eq("enrichment_status", "pending")
      .is("deleted_at", null)
      .is("enrichment_snapshot_id", null)
      .not("linkedin_url", "is", null)
      .lt("enrichment_retry_count", MAX_RETRIES)
      .limit(BATCH_SIZE);

    if (triggerErr) {
      console.error("[enrichment-process] Phase 1 query error:", triggerErr);
    }

    const toTrigger: PendingAlumni[] = triggerBatch ?? [];

    if (toTrigger.length > 0) {
      // Build URL-to-alumni map
      const urlToAlumni = new Map<string, PendingAlumni[]>();
      for (const alumni of toTrigger) {
        const normalized = safeNormalize(alumni.linkedin_url);
        if (!normalized) continue;
        const existing = urlToAlumni.get(normalized) ?? [];
        existing.push(alumni);
        urlToAlumni.set(normalized, existing);
      }

      const urls = Array.from(urlToAlumni.keys());

      if (urls.length > 0) {
        try {
          const snapshotId = await triggerBulkEnrichment(urls);

          // Store snapshot_id on all alumni records in this batch
          const alumniIds = toTrigger.map((a) => a.id);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any)
            .from("alumni")
            .update({ enrichment_snapshot_id: snapshotId })
            .in("id", alumniIds);

          triggeredCount = alumniIds.length;
        } catch (err) {
          console.error("[enrichment-process] Phase 1 trigger error:", err);
          const alumniIds = toTrigger.map((a) => a.id);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any).rpc("increment_enrichment_retry", {
            p_alumni_ids: alumniIds,
            p_error: err instanceof Error ? err.message : "trigger_failed",
            p_max_retries: MAX_RETRIES,
          });
          failedCount += alumniIds.length;
        }
      }
    }

    // -----------------------------------------------------------------------
    // Phase 2: Collect — check snapshot progress and download results
    // -----------------------------------------------------------------------
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: collectBatch, error: collectErr } = await (supabase as any)
      .from("alumni")
      .select("id, organization_id, linkedin_url, enrichment_retry_count, enrichment_snapshot_id")
      .eq("enrichment_status", "pending")
      .is("deleted_at", null)
      .not("enrichment_snapshot_id", "is", null)
      .limit(BATCH_SIZE);

    if (collectErr) {
      console.error("[enrichment-process] Phase 2 query error:", collectErr);
    }

    const toCollect: PendingAlumni[] = collectBatch ?? [];

    if (toCollect.length > 0) {
      // Group by snapshot_id
      const bySnapshot = new Map<string, PendingAlumni[]>();
      for (const alumni of toCollect) {
        if (!alumni.enrichment_snapshot_id) continue;
        const existing = bySnapshot.get(alumni.enrichment_snapshot_id) ?? [];
        existing.push(alumni);
        bySnapshot.set(alumni.enrichment_snapshot_id, existing);
      }

      for (const [snapshotId, alumni] of bySnapshot.entries()) {
        // Validate snapshot ID format
        if (!/^[a-zA-Z0-9_-]+$/.test(snapshotId)) {
          console.error("[enrichment-process] Invalid snapshot ID format:", snapshotId);
          const ids = alumni.map((a) => a.id);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any).rpc("increment_enrichment_retry", {
            p_alumni_ids: ids,
            p_error: "invalid_snapshot_id",
            p_max_retries: MAX_RETRIES,
          });
          failedCount += ids.length;
          continue;
        }

        try {
          const progress = await getSnapshotProgress(snapshotId);

          if (progress?.status === "ready") {
            const results = await getSnapshotResults(snapshotId);

            // Build URL map from results
            if (!results) continue;
            const resultsByUrl = new Map<string, (typeof results)[number]>();
            for (const result of results) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const url = (result as any).url || (result as any).input?.url;
              if (url) {
                const normalized = safeNormalize(url);
                if (normalized) {
                  resultsByUrl.set(normalized, result);
                }
              }
            }

            // Match alumni to results and enrich
            const enrichedIds: string[] = [];
            const unmatchedIds: string[] = [];

            for (const alum of alumni) {
              const normalized = safeNormalize(alum.linkedin_url);
              if (!normalized) {
                unmatchedIds.push(alum.id);
                continue;
              }

              const result = resultsByUrl.get(normalized);
              if (!result) {
                unmatchedIds.push(alum.id);
                continue;
              }

              const fields = mapBrightDataToFields(result);

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const { error: enrichErr } = await (supabase as any).rpc("enrich_alumni_by_id", {
                p_alumni_id: alum.id,
                p_organization_id: alum.organization_id,
                p_job_title: fields.job_title,
                p_current_company: fields.current_company,
                p_current_city: fields.current_city,
                p_school: fields.school,
                p_major: fields.major,
                p_position_title: fields.position_title,
                p_headline: null,
                p_summary: null,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                p_work_history: (result as any).experience ?? null,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                p_education_history: (result as any).education ?? null,
              });

              if (enrichErr) {
                console.error("[enrichment-process] enrich_alumni_by_id error:", enrichErr);
                unmatchedIds.push(alum.id);
              } else {
                enrichedIds.push(alum.id);
                enrichedCount++;
              }
            }

            // Clear snapshot_id for ALL alumni in batch (not just enriched)
            const allIds = alumni.map((a) => a.id);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any)
              .from("alumni")
              .update({ enrichment_snapshot_id: null })
              .in("id", allIds);

            // Increment retry for unmatched
            if (unmatchedIds.length > 0) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await (supabase as any).rpc("increment_enrichment_retry", {
                p_alumni_ids: unmatchedIds,
                p_error: "no_matching_result",
                p_max_retries: MAX_RETRIES,
              });
              failedCount += unmatchedIds.length;
            }
          } else if (progress?.status === "failed") {
            const ids = alumni.map((a) => a.id);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any).rpc("increment_enrichment_retry", {
              p_alumni_ids: ids,
              p_error: "snapshot_failed",
              p_max_retries: MAX_RETRIES,
            });
            failedCount += ids.length;
          }
          // If still processing, leave as-is for next cron run
        } catch (err) {
          console.error("[enrichment-process] Phase 2 snapshot error:", snapshotId, err);
          const ids = alumni.map((a) => a.id);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any).rpc("increment_enrichment_retry", {
            p_alumni_ids: ids,
            p_error: err instanceof Error ? err.message : "snapshot_error",
            p_max_retries: MAX_RETRIES,
          });
          failedCount += ids.length;
        }
      }
    }

    // -----------------------------------------------------------------------
    // Cleanup: mark records that have exhausted retries as 'failed'
    // -----------------------------------------------------------------------
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from("alumni")
      .update({ enrichment_status: "failed" })
      .eq("enrichment_status", "pending")
      .gte("enrichment_retry_count", MAX_RETRIES);

    return NextResponse.json({
      ok: true,
      enriched: enrichedCount,
      failed: failedCount,
      triggered: triggeredCount,
    });
  } catch (err) {
    console.error("[enrichment-process] Error:", err);
    return NextResponse.json(
      { error: "Failed to process enrichment queue" },
      { status: 500 },
    );
  }
}
