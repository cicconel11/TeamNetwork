import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";
import {
  fetchBrightDataProfile,
  mapBrightDataToFields,
  isBrightDataConfigured,
} from "@/lib/linkedin/bright-data";
import { normalizeLinkedInProfileUrl } from "@/lib/alumni/linkedin-url";

const BATCH_SIZE = 30;
const MAX_RETRIES = 3;

interface PendingAlumni {
  id: string;
  organization_id: string;
  linkedin_url: string;
  enrichment_retry_count: number;
  enrichment_snapshot_id: string | null;
}

export interface EnrichmentProcessRouteDeps {
  createServiceClient?: typeof createServiceClient;
  validateCronAuth?: typeof validateCronAuth;
  fetchBrightDataProfile?: typeof fetchBrightDataProfile;
  mapBrightDataToFields?: typeof mapBrightDataToFields;
  isBrightDataConfigured?: typeof isBrightDataConfigured;
}

function safeNormalize(url: string): string | null {
  try {
    return normalizeLinkedInProfileUrl(url);
  } catch {
    return null;
  }
}

async function incrementRetry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  alumniIds: string[],
  error: string
) {
  if (alumniIds.length === 0) {
    return;
  }

  await supabase.rpc("increment_enrichment_retry", {
    p_alumni_ids: alumniIds,
    p_error: error,
    p_max_retries: MAX_RETRIES,
  });
}

export function createEnrichmentProcessGetHandler(
  deps: EnrichmentProcessRouteDeps = {}
) {
  const createServiceClientFn = deps.createServiceClient ?? createServiceClient;
  const validateCronAuthFn = deps.validateCronAuth ?? validateCronAuth;
  const fetchBrightDataProfileFn =
    deps.fetchBrightDataProfile ?? fetchBrightDataProfile;
  const mapBrightDataToFieldsFn = deps.mapBrightDataToFields ?? mapBrightDataToFields;
  const isBrightDataConfiguredFn =
    deps.isBrightDataConfigured ?? isBrightDataConfigured;

  return async function GET(request: Request) {
    const authError = validateCronAuthFn(request);
    if (authError) return authError;

    if (!isBrightDataConfiguredFn()) {
      return NextResponse.json({ ok: true, skipped: "bright_data_not_configured" });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createServiceClientFn() as any;
    let enriched = 0;
    let failed = 0;

    try {
      const { data, error } = await supabase
        .from("alumni")
        .select(
          "id, organization_id, linkedin_url, enrichment_retry_count, enrichment_snapshot_id"
        )
        .eq("enrichment_status", "pending")
        .is("deleted_at", null)
        .not("linkedin_url", "is", null)
        .lt("enrichment_retry_count", MAX_RETRIES)
        .limit(BATCH_SIZE);

      if (error) {
        console.error("[enrichment-process] query error:", error);
        return NextResponse.json(
          { error: "Failed to process enrichment queue" },
          { status: 500 }
        );
      }

      const batch = ((data as PendingAlumni[] | null) ?? []).slice(0, BATCH_SIZE);
      const processed = batch.length;

      for (const alumni of batch) {
        if (alumni.enrichment_snapshot_id) {
          await supabase
            .from("alumni")
            .update({ enrichment_snapshot_id: null })
            .in("id", [alumni.id]);
        }

        const normalizedLinkedInUrl = safeNormalize(alumni.linkedin_url);
        if (!normalizedLinkedInUrl) {
          await incrementRetry(supabase, [alumni.id], "invalid_linkedin_url");
          failed += 1;
          continue;
        }

        try {
          const result = await fetchBrightDataProfileFn(normalizedLinkedInUrl);
          if (!result || !result.ok) {
            await incrementRetry(supabase, [alumni.id], "bright_data_fetch_failed");
            failed += 1;
            continue;
          }

          const fields = mapBrightDataToFieldsFn(result.profile);
          const { error: enrichError } = await supabase.rpc("enrich_alumni_by_id", {
            p_alumni_id: alumni.id,
            p_organization_id: alumni.organization_id,
            p_job_title: fields.job_title,
            p_current_company: fields.current_company,
            p_current_city: fields.current_city,
            p_school: fields.school,
            p_major: fields.major,
            p_position_title: fields.position_title,
            p_headline: null,
            p_summary: null,
            p_work_history: null,
            p_education_history: null,
          });

          if (enrichError) {
            console.error("[enrichment-process] enrich_alumni_by_id error:", enrichError);
            await incrementRetry(
              supabase,
              [alumni.id],
              enrichError.message ?? "enrich_alumni_failed"
            );
            failed += 1;
            continue;
          }

          enriched += 1;
        } catch (error) {
          console.error("[enrichment-process] Bright Data error:", error);
          await incrementRetry(
            supabase,
            [alumni.id],
            error instanceof Error ? error.message : "bright_data_fetch_failed"
          );
          failed += 1;
        }
      }

      await supabase
        .from("alumni")
        .update({ enrichment_status: "failed" })
        .eq("enrichment_status", "pending")
        .gte("enrichment_retry_count", MAX_RETRIES);

      return NextResponse.json({
        ok: true,
        enriched,
        failed,
        processed,
      });
    } catch (error) {
      console.error("[enrichment-process] Error:", error);
      return NextResponse.json(
        { error: "Failed to process enrichment queue" },
        { status: 500 }
      );
    }
  };
}
