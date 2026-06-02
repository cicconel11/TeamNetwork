import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";
import {
  isApifyConfigured,
  startApifyProfileRun,
  getApifyRunStatus,
  isTerminalApifyRunStatus,
} from "@/lib/linkedin/apify";
import { processFinishedApifyRun, recordRunTargets } from "@/lib/linkedin/enrichment-writeback";
import { normalizeLinkedInProfileUrl } from "@/lib/alumni/linkedin-url";

const BATCH_SIZE = 30;
const MAX_RETRIES = 3;
// A run should normally complete (and the webhook fire) well within 15 min.
const RECONCILE_AFTER_MS = 15 * 60 * 1000;
const HARD_TIMEOUT_MS = 2 * 60 * 60 * 1000;

interface PendingAlumni {
  id: string;
  organization_id: string;
  linkedin_url: string;
  enrichment_retry_count: number | null;
}

interface RunTarget {
  id: string;
  run_id: string;
  target_kind: "user" | "alumni";
  user_id: string | null;
  alumni_id: string | null;
}

export interface EnrichmentProcessRouteDeps {
  createServiceClient?: typeof createServiceClient;
  validateCronAuth?: typeof validateCronAuth;
  isApifyConfigured?: typeof isApifyConfigured;
  startApifyProfileRun?: typeof startApifyProfileRun;
  getApifyRunStatus?: typeof getApifyRunStatus;
  processFinishedApifyRun?: typeof processFinishedApifyRun;
}

function safeNormalize(url: string): string | null {
  try {
    return normalizeLinkedInProfileUrl(url);
  } catch {
    return null;
  }
}

async function markTimedOutRunsFailed(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  hardCutoff: string,
): Promise<number> {
  const { data: timedOutRows, error: selectError } = await supabase
    .from("linkedin_enrichment_runs")
    .select("id, run_id, target_kind, user_id, alumni_id")
    .eq("status", "syncing")
    .lt("created_at", hardCutoff)
    .limit(200);

  if (selectError) {
    console.error("[enrichment-process] hard-timeout select error:", selectError);
    return 0;
  }

  const targets = (timedOutRows as RunTarget[] | null) ?? [];
  if (targets.length === 0) return 0;

  const now = new Date().toISOString();
  await supabase
    .from("linkedin_enrichment_runs")
    .update({ status: "failed", error: "timed_out", updated_at: now })
    .in("id", targets.map((t) => t.id));

  const alumniIds = targets
    .filter((t) => t.target_kind === "alumni" && t.alumni_id)
    .map((t) => t.alumni_id);
  if (alumniIds.length > 0) {
    await supabase.rpc("increment_enrichment_retry", {
      p_alumni_ids: alumniIds,
      p_error: "timed_out",
      p_max_retries: MAX_RETRIES,
    });
  }

  const userTargets = targets.filter((t) => t.target_kind === "user" && t.user_id);
  for (const target of userTargets) {
    await supabase
      .from("user_linkedin_connections")
      .update({ enrichment_status: "failed", enrichment_run_id: null, sync_error: "timed_out" })
      .eq("user_id", target.user_id)
      .eq("enrichment_run_id", target.run_id);
  }

  return targets.length;
}

export function createEnrichmentProcessGetHandler(deps: EnrichmentProcessRouteDeps = {}) {
  const createServiceClientFn = deps.createServiceClient ?? createServiceClient;
  const validateCronAuthFn = deps.validateCronAuth ?? validateCronAuth;
  const isApifyConfiguredFn = deps.isApifyConfigured ?? isApifyConfigured;
  const startApifyProfileRunFn = deps.startApifyProfileRun ?? startApifyProfileRun;
  const getApifyRunStatusFn = deps.getApifyRunStatus ?? getApifyRunStatus;
  const processFinishedApifyRunFn = deps.processFinishedApifyRun ?? processFinishedApifyRun;

  return async function GET(request: Request) {
    const authError = validateCronAuthFn(request);
    if (authError) return authError;

    if (!isApifyConfiguredFn()) {
      return NextResponse.json({ ok: true, skipped: "apify_not_configured" });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createServiceClientFn() as any;

    let started = 0;
    let startFailed = 0;
    let reconciledEnriched = 0;
    let reconciledFailed = 0;
    let hardTimedOut = 0;

    try {
      // --- 1. Start runs for the pending queue -----------------------------
      const { data, error } = await supabase
        .from("alumni")
        .select("id, organization_id, linkedin_url, enrichment_retry_count")
        .eq("enrichment_status", "pending")
        .is("deleted_at", null)
        .not("linkedin_url", "is", null)
        .lt("enrichment_retry_count", MAX_RETRIES)
        .limit(BATCH_SIZE);

      if (error) {
        console.error("[enrichment-process] query error:", error);
        return NextResponse.json({ error: "Failed to process enrichment queue" }, { status: 500 });
      }

      const batch = ((data as PendingAlumni[] | null) ?? []).slice(0, BATCH_SIZE);

      const targets: Array<{ kind: "alumni"; alumniId: string; organizationId: string; linkedinUrl: string }> = [];
      const invalidIds: string[] = [];
      for (const alumni of batch) {
        const normalized = safeNormalize(alumni.linkedin_url);
        if (!normalized) {
          invalidIds.push(alumni.id);
          continue;
        }
        targets.push({
          kind: "alumni",
          alumniId: alumni.id,
          organizationId: alumni.organization_id,
          linkedinUrl: normalized,
        });
      }

      if (invalidIds.length > 0) {
        await supabase.rpc("increment_enrichment_retry", {
          p_alumni_ids: invalidIds,
          p_error: "invalid_linkedin_url",
          p_max_retries: MAX_RETRIES,
        });
        startFailed += invalidIds.length;
      }

      if (targets.length > 0) {
        const start = await startApifyProfileRunFn(targets.map((t) => t.linkedinUrl));
        if (start.ok) {
          await recordRunTargets(supabase, start.runId, targets);
          await supabase
            .from("alumni")
            .update({ enrichment_status: "syncing", enrichment_snapshot_id: start.runId })
            .in("id", targets.map((t) => t.alumniId));
          started += targets.length;
        } else {
          await supabase.rpc("increment_enrichment_retry", {
            p_alumni_ids: targets.map((t) => t.alumniId),
            p_error: `apify_start_failed:${start.kind}`,
            p_max_retries: MAX_RETRIES,
          });
          startFailed += targets.length;
        }
      }

      // --- 2. Reconcile runs the webhook may have missed -------------------
      const cutoff = new Date(Date.now() - RECONCILE_AFTER_MS).toISOString();
      const { data: stuckRows } = await supabase
        .from("linkedin_enrichment_runs")
        .select("run_id, created_at")
        .eq("status", "syncing")
        .lt("created_at", cutoff)
        .limit(200);

      const runIds = Array.from(
        new Set(((stuckRows as Array<{ run_id: string }> | null) ?? []).map((r) => r.run_id)),
      );

      for (const runId of runIds) {
        const status = await getApifyRunStatusFn(runId);
        if (isTerminalApifyRunStatus(status)) {
          const res = await processFinishedApifyRunFn(supabase, runId);
          reconciledEnriched += res.enriched;
          reconciledFailed += res.failed;
        }
      }

      // Hard-timeout: runs still 'syncing' long past completion are abandoned.
      const hardCutoff = new Date(Date.now() - HARD_TIMEOUT_MS).toISOString();
      hardTimedOut = await markTimedOutRunsFailed(supabase, hardCutoff);

      return NextResponse.json({
        ok: true,
        started,
        start_failed: startFailed,
        reconciled_enriched: reconciledEnriched,
        reconciled_failed: reconciledFailed,
        hard_timed_out: hardTimedOut,
      });
    } catch (error) {
      console.error("[enrichment-process] Error:", error);
      return NextResponse.json({ error: "Failed to process enrichment queue" }, { status: 500 });
    }
  };
}
