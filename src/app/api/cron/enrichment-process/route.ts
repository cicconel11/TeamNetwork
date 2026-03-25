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

/**
 * Cron job to process the LinkedIn enrichment queue.
 * Runs every 5 minutes using a two-phase trigger/collect pattern:
 *
 * Phase 1 (trigger): Find pending alumni without a snapshot_id, trigger
 *   Bright Data bulk enrichment, store the snapshot_id on the records.
 * Phase 2 (collect): Find pending alumni WITH a snapshot_id, check if
 *   results are ready, and write enrichment data back.
 */
export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  if (!isBrightDataConfigured()) {
    return NextResponse.json({ ok: true, skipped: true, reason: "BRIGHT_DATA_API_KEY not configured" });
  }

  let enriched = 0;
  let failed = 0;
  let triggered = 0;

  try {
    const supabase = createServiceClient();

    // ── Phase 1: Trigger new batches ──────────────────────────────────────
    // Find pending alumni that have NOT been triggered yet (no snapshot_id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: untriggered, error: fetchError } = await (supabase as any)
      .from("alumni")
      .select("id, organization_id, linkedin_url, enrichment_retry_count")
      .eq("enrichment_status", "pending")
      .is("deleted_at", null)
      .is("enrichment_snapshot_id", null)
      .not("linkedin_url", "is", null)
      .lt("enrichment_retry_count", MAX_RETRIES)
      .limit(BATCH_SIZE);

    if (fetchError) {
      console.error("[enrichment-process] Failed to fetch untriggered alumni:", fetchError);
      return NextResponse.json({ error: "Failed to fetch pending alumni" }, { status: 500 });
    }

    if (untriggered && untriggered.length > 0) {
      // Build URL-to-alumni map using normalized URLs
      const urlToAlumni = new Map<string, PendingAlumni[]>();
      for (const alumnus of untriggered as PendingAlumni[]) {
        const normalized = safeNormalize(alumnus.linkedin_url);
        if (!normalized) continue;
        if (!urlToAlumni.has(normalized)) urlToAlumni.set(normalized, []);
        urlToAlumni.get(normalized)!.push(alumnus);
      }

      const urls = Array.from(urlToAlumni.keys());
      if (urls.length > 0) {
        const triggerResult = await triggerBulkEnrichment(urls);

        if (triggerResult) {
          // Store snapshot_id on the alumni records so Phase 2 can collect later
          const allIds = (untriggered as PendingAlumni[]).map((a) => a.id);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any)
            .from("alumni")
            .update({ enrichment_snapshot_id: triggerResult.snapshot_id })
            .in("id", allIds);
          triggered = allIds.length;
        } else {
          // Trigger failed — increment retry count in batch
          const allIds = (untriggered as PendingAlumni[]).map((a) => a.id);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any).rpc("increment_enrichment_retry", {
            p_alumni_ids: allIds,
            p_error: "Bright Data trigger failed",
            p_max_retries: MAX_RETRIES,
          });
          failed = allIds.length;
        }
      }
    }

    // ── Phase 2: Collect ready results ────────────────────────────────────
    // Find pending alumni that HAVE a snapshot_id (previously triggered)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inFlight, error: inFlightError } = await (supabase as any)
      .from("alumni")
      .select("id, organization_id, linkedin_url, enrichment_retry_count, enrichment_snapshot_id")
      .eq("enrichment_status", "pending")
      .is("deleted_at", null)
      .not("enrichment_snapshot_id", "is", null)
      .limit(BATCH_SIZE);

    if (inFlightError) {
      console.error("[enrichment-process] Failed to fetch in-flight alumni:", inFlightError);
    }

    if (inFlight && inFlight.length > 0) {
      // Group by snapshot_id
      const bySnapshot = new Map<string, PendingAlumni[]>();
      for (const alumnus of inFlight as PendingAlumni[]) {
        const sid = alumnus.enrichment_snapshot_id!;
        if (!bySnapshot.has(sid)) bySnapshot.set(sid, []);
        bySnapshot.get(sid)!.push(alumnus);
      }

      for (const [snapshotId, alumni] of bySnapshot) {
        if (!/^[a-zA-Z0-9_-]+$/.test(snapshotId)) {
          console.error("[enrichment-process] Invalid snapshot_id format:", snapshotId);
          continue;
        }

        const progress = await getSnapshotProgress(snapshotId);
        if (!progress) continue;

        if (progress.status === "ready") {
          const results = await getSnapshotResults(snapshotId);
          if (results) {
            // Build normalized URL lookup for these alumni
            const urlToAlumni = new Map<string, PendingAlumni[]>();
            for (const alumnus of alumni) {
              const normalized = safeNormalize(alumnus.linkedin_url);
              if (!normalized) continue;
              if (!urlToAlumni.has(normalized)) urlToAlumni.set(normalized, []);
              urlToAlumni.get(normalized)!.push(alumnus);
            }

            for (const profile of results) {
              const inputUrl = profile.input_url || profile.url;
              if (!inputUrl) continue;

              const normalizedInput = safeNormalize(inputUrl);
              const matching = normalizedInput ? urlToAlumni.get(normalizedInput) : undefined;
              if (!matching) continue;

              const fields = mapBrightDataToFields(profile);

              for (const alumnus of matching) {
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
                    p_work_history: fields.work_history,
                    p_education_history: fields.education_history,
                  });

                  if (error) {
                    console.error("[enrichment-process] RPC error for alumni", alumnus.id, ":", error);
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

            // Clear snapshot_id for all alumni in this batch (processed)
            const processedIds = alumni.map((a) => a.id);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any)
              .from("alumni")
              .update({ enrichment_snapshot_id: null })
              .in("id", processedIds)
              .eq("enrichment_status", "enriched");
          }
        } else if (progress.status === "failed") {
          // Batch increment retry count
          const failedIds = alumni.map((a) => a.id);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any).rpc("increment_enrichment_retry", {
            p_alumni_ids: failedIds,
            p_error: "Bright Data snapshot failed",
            p_max_retries: MAX_RETRIES,
          });
          failed += failedIds.length;
        }
        // If still "collecting" or "digesting", leave as-is for next cron run
      }
    }

    // ── Mark exhausted retries as permanently failed ──────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from("alumni")
      .update({ enrichment_status: "failed", enrichment_snapshot_id: null })
      .eq("enrichment_status", "pending")
      .is("deleted_at", null)
      .gte("enrichment_retry_count", MAX_RETRIES);

    return NextResponse.json({ ok: true, enriched, failed, triggered });
  } catch (err) {
    console.error("[enrichment-process] Error:", err);
    return NextResponse.json(
      { error: "Failed to process enrichment queue" },
      { status: 500 }
    );
  }
}

/** Normalize a LinkedIn URL for map lookups. Returns null if invalid. */
function safeNormalize(url: string): string | null {
  try {
    return normalizeLinkedInProfileUrl(url);
  } catch {
    return null;
  }
}
