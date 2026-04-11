import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";
import {
  fetchBrightDataProfile,
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
 * Uses the synchronous Profiles collect API (`fetchBrightDataProfile`) per URL.
 * Pending rows may still carry a legacy `enrichment_snapshot_id` from an older
 * bulk snapshot flow — we clear it when processing so nothing stays stuck.
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

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: batch, error: batchErr } = await (supabase as any)
      .from("alumni")
      .select("id, organization_id, linkedin_url, enrichment_retry_count")
      .eq("enrichment_status", "pending")
      .is("deleted_at", null)
      .not("linkedin_url", "is", null)
      .lt("enrichment_retry_count", MAX_RETRIES)
      .limit(BATCH_SIZE);

    if (batchErr) {
      console.error("[enrichment-process] batch query error:", batchErr);
    }

    const pending: PendingAlumni[] = batch ?? [];

    for (const alum of pending) {
      const normalized = safeNormalize(alum.linkedin_url);
      if (!normalized) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).rpc("increment_enrichment_retry", {
          p_alumni_ids: [alum.id],
          p_error: "invalid_linkedin_url",
          p_max_retries: MAX_RETRIES,
        });
        failedCount += 1;
        continue;
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from("alumni")
          .update({ enrichment_snapshot_id: null })
          .eq("id", alum.id);

        const fetchResult = await fetchBrightDataProfile(normalized);
        if (!fetchResult.ok) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any).rpc("increment_enrichment_retry", {
            p_alumni_ids: [alum.id],
            p_error: fetchResult.kind,
            p_max_retries: MAX_RETRIES,
          });
          failedCount += 1;
          continue;
        }

        const profile = fetchResult.profile;
        const fields = mapBrightDataToFields(profile);

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
          p_headline: profile.position || null,
          p_summary: profile.about || null,
          p_work_history: profile.experience ?? null,
          p_education_history: profile.education ?? null,
        });

        if (enrichErr) {
          console.error("[enrichment-process] enrich_alumni_by_id error:", enrichErr);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any).rpc("increment_enrichment_retry", {
            p_alumni_ids: [alum.id],
            p_error: enrichErr.message ?? "enrich_rpc_failed",
            p_max_retries: MAX_RETRIES,
          });
          failedCount += 1;
        } else {
          enrichedCount += 1;
        }
      } catch (err) {
        console.error("[enrichment-process] row error:", alum.id, err);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).rpc("increment_enrichment_retry", {
          p_alumni_ids: [alum.id],
          p_error: err instanceof Error ? err.message : "enrichment_error",
          p_max_retries: MAX_RETRIES,
        });
        failedCount += 1;
      }
    }

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
      processed: pending.length,
    });
  } catch (err) {
    console.error("[enrichment-process] Error:", err);
    return NextResponse.json(
      { error: "Failed to process enrichment queue" },
      { status: 500 },
    );
  }
}
