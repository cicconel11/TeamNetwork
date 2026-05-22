import type {
  BlackbaudConstituent,
  BlackbaudEmail,
  BlackbaudPhone,
  BlackbaudAddress,
  SyncResult,
  NormalizedConstituent,
  SyncError,
} from "./types";
import { BlackbaudApiError, type BlackbaudClient } from "./client";
import { normalizeConstituent } from "./normalize";
import { upsertConstituents } from "./storage";
import { makeSyncError } from "./oauth";
import { checkBlackbaudHealth, formatBlackbaudHealthError } from "./health";
import type { ServiceSupabase } from "@/lib/supabase/types";
import type { Json } from "@/types/database";
import { debugLog } from "@/lib/debug";
import { isApifyConfigured } from "@/lib/linkedin/apify";
import { enqueueAlumniForEnrichment } from "@/lib/linkedin/enrichment-writeback";

const SUBRESOURCE_PACING_MS = 50;

/**
 * Fetches one sub-resource list for a constituent. Quota errors bubble so
 * runSync can stop the cycle; non-quota failures return undefined so the
 * caller can preserve the existing DB column instead of overwriting with null.
 */
async function fetchSubResource<T>(
  client: BlackbaudClient,
  constituentId: string,
  resource: "emailaddresses" | "phones" | "addresses",
): Promise<T[] | undefined> {
  try {
    const res = await client.getList<T>(
      `/constituent/v1/constituents/${constituentId}/${resource}`,
    );
    await new Promise((resolve) => setTimeout(resolve, SUBRESOURCE_PACING_MS));
    return res.value;
  } catch (err) {
    if (err instanceof BlackbaudApiError && err.isQuotaExhausted) {
      throw err;
    }
    debugLog("blackbaud-sync", `${resource} fetch error`, {
      constituentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

export interface SyncDeps {
  client: BlackbaudClient;
  supabase: ServiceSupabase;
  integrationId: string;
  organizationId: string;
  alumniLimit: number | null;
  currentAlumniCount: number;
  syncType: "full" | "incremental" | "manual";
  lastSyncedAt: string | null;
}

class BlackbaudSyncFailure extends Error {
  phase: SyncError["phase"];
  code: string;
  isQuotaExhausted: boolean;
  retryAfterHuman: string | null;

  constructor(phase: SyncError["phase"], code: string, message: string, opts?: { isQuotaExhausted?: boolean; retryAfterHuman?: string | null }) {
    super(message);
    this.phase = phase;
    this.code = code;
    this.isQuotaExhausted = opts?.isQuotaExhausted ?? false;
    this.retryAfterHuman = opts?.retryAfterHuman ?? null;
  }
}

function parsePositiveIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getDevSyncControls() {
  if (process.env.NODE_ENV === "production") {
    return { limit: 500, maxPages: Infinity, skipEmails: false };
  }

  return {
    limit: Math.min(500, parsePositiveIntegerEnv(process.env.BLACKBAUD_DEV_PAGE_SIZE, 500)),
    maxPages: parsePositiveIntegerEnv(process.env.BLACKBAUD_DEV_MAX_PAGES, Infinity),
    skipEmails: process.env.BLACKBAUD_DEV_SKIP_EMAILS === "true",
  };
}

/**
 * Runs a full sync cycle: paginated fetch → normalize → upsert.
 * Creates a sync log entry and updates integration state.
 */
export async function runSync(deps: SyncDeps): Promise<SyncResult> {
  const { client, supabase, integrationId, syncType, lastSyncedAt } = deps;

  // ── Concurrency guard (insert-first, catch unique violation) ──
  const UNIQUE_VIOLATION = "23505";
  const STALE_THRESHOLD_MS = 5 * 60 * 1000;

  let syncLogId: string | null = null;

  const { data: syncLog, error: logError } = await supabase
    .from("integration_sync_log")
    .insert({
      integration_id: integrationId,
      sync_type: syncType,
      status: "running",
    })
    .select("id")
    .single();

  if (logError) {
    const pgCode = (logError as { code?: string }).code;
    if (pgCode === UNIQUE_VIOLATION) {
      const { data: runningSyncs } = await supabase
        .from("integration_sync_log")
        .select("id, started_at")
        .eq("integration_id", integrationId)
        .eq("status", "running")
        .limit(1);

      if (runningSyncs && runningSyncs.length > 0) {
        const runningSync = runningSyncs[0];
        const startedAt = new Date(runningSync.started_at);

        if (Date.now() - startedAt.getTime() < STALE_THRESHOLD_MS) {
          return { ok: false, created: 0, updated: 0, unchanged: 0, skipped: 0, error: "Sync already in progress" };
        }

        await supabase
          .from("integration_sync_log")
          .update({ status: "failed", error_message: "Stale lock released", completed_at: new Date().toISOString() })
          .eq("id", runningSync.id);

        debugLog("blackbaud-sync", "released stale sync lock", {
          staleId: runningSync.id,
          integrationId,
          staleSinceMs: Date.now() - startedAt.getTime(),
        });

        const { data: retryLog, error: retryError } = await supabase
          .from("integration_sync_log")
          .insert({
            integration_id: integrationId,
            sync_type: syncType,
            status: "running",
          })
          .select("id")
          .single();

        if (retryError) {
          debugLog("blackbaud-sync", "failed to acquire sync lock after stale release", { error: retryError.message });
          return { ok: false, created: 0, updated: 0, unchanged: 0, skipped: 0, error: "Sync already in progress" };
        }

        syncLogId = retryLog?.id ?? null;
      } else {
        return { ok: false, created: 0, updated: 0, unchanged: 0, skipped: 0, error: "Sync already in progress" };
      }
    } else {
      debugLog("blackbaud-sync", "failed to create sync log", { error: logError.message });
      return { ok: false, created: 0, updated: 0, unchanged: 0, skipped: 0, error: `Failed to acquire sync lock: ${logError.message}` };
    }
  } else {
    syncLogId = syncLog?.id ?? null;
  }

  const totals: SyncResult = { ok: true, created: 0, updated: 0, unchanged: 0, skipped: 0, skippedReasons: {} };
  const syncStartedAt = new Date().toISOString();
  let partialDueToDevCap = false;
  // Existing alumni updated by this sync — candidates for LinkedIn enrichment if
  // they already carry a linkedin_url (Blackbaud itself never supplies one).
  const touchedAlumniIds: string[] = [];

  try {
    const health = await checkBlackbaudHealth(client);
    if (!health.ok) {
      const msg = formatBlackbaudHealthError(health);
      throw new BlackbaudSyncFailure(
        "api_verify",
        health.reason === "quota_exhausted" ? "QUOTA_EXHAUSTED" : "VERIFY_FAILED",
        msg,
        { isQuotaExhausted: health.reason === "quota_exhausted", retryAfterHuman: health.retryAfterHuman },
      );
    }

    let offset = 0;
    const { limit, maxPages, skipEmails } = getDevSyncControls();
    let hasMore = true;
    let pagesFetched = 0;

    while (hasMore) {
      const params: Record<string, string> = {
        limit: String(limit),
        offset: String(offset),
      };

      if (syncType === "incremental" && lastSyncedAt) {
        params.date_modified = `>${lastSyncedAt}`;
      }

      const response = await client.getList<BlackbaudConstituent>(
        "/constituent/v1/constituents",
        params
      );

      const constituents = response.value;
      debugLog("blackbaud-sync", "fetched page", {
        offset,
        count: constituents.length,
        total: response.count,
      });

      if (constituents.length === 0) {
        break;
      }

      const normalized: NormalizedConstituent[] = [];
      const subresourceFailures = { emails: 0, phones: 0, addresses: 0 };
      for (const constituent of constituents) {
        try {
          // undefined here means "skipEmails dev gate active" — distinct from a
          // failed fetch (also undefined) only because skipEmails skips before
          // any fetch attempt. Storage treats both the same: preserve existing.
          let emails: BlackbaudEmail[] | undefined;
          let phones: BlackbaudPhone[] | undefined;
          let addresses: BlackbaudAddress[] | undefined;

          // skipEmails gates all sub-resource fetches in dev (single flag covers
          // emails, phones, addresses) to keep quota usage low during local work.
          if (skipEmails) {
            // In dev skip mode, treat sub-resources as "Blackbaud said nothing"
            // (empty arrays → null fields) rather than "fetch failed" — preserves
            // the historical insert-side semantics for the dev test fixture.
            emails = [];
            phones = [];
            addresses = [];
          } else {
            emails = await fetchSubResource<BlackbaudEmail>(client, constituent.id, "emailaddresses");
            if (emails === undefined) subresourceFailures.emails += 1;
            phones = await fetchSubResource<BlackbaudPhone>(client, constituent.id, "phones");
            if (phones === undefined) subresourceFailures.phones += 1;
            addresses = await fetchSubResource<BlackbaudAddress>(client, constituent.id, "addresses");
            if (addresses === undefined) subresourceFailures.addresses += 1;
          }

          normalized.push(normalizeConstituent(constituent, emails, phones, addresses));
        } catch (err) {
          if (err instanceof BlackbaudApiError && err.isQuotaExhausted) {
            throw new BlackbaudSyncFailure(
              "api_fetch",
              "QUOTA_EXHAUSTED",
              `Blackbaud API quota exhausted.${err.retryAfterHuman ? ` Quota resets in ${err.retryAfterHuman}.` : ""}`,
              { isQuotaExhausted: true, retryAfterHuman: err.retryAfterHuman },
            );
          }
          debugLog("blackbaud-sync", "normalize error", {
            constituentId: constituent.id,
            error: err instanceof Error ? err.message : String(err),
          });
          normalized.push(normalizeConstituent(constituent, undefined, undefined, undefined));
        }
      }

      const batchResult = await upsertConstituents(
        {
          supabase: deps.supabase,
          integrationId: deps.integrationId,
          organizationId: deps.organizationId,
          alumniLimit: deps.alumniLimit,
          currentAlumniCount: deps.currentAlumniCount + totals.created,
        },
        normalized
      );

      totals.created += batchResult.created;
      totals.updated += batchResult.updated;
      totals.unchanged += batchResult.unchanged;
      totals.skipped += batchResult.skipped;
      for (const [reason, count] of Object.entries(batchResult.skippedReasons ?? {})) {
        totals.skippedReasons![reason] = (totals.skippedReasons![reason] ?? 0) + count;
      }
      if (batchResult.touchedAlumniIds?.length) {
        touchedAlumniIds.push(...batchResult.touchedAlumniIds);
      }

      // R5: surface sub-resource failures so operators can see partial syncs
      // even when the constituent row itself updated successfully.
      if (subresourceFailures.emails > 0) {
        totals.skippedReasons!["subresource_emails_failed"] =
          (totals.skippedReasons!["subresource_emails_failed"] ?? 0) + subresourceFailures.emails;
      }
      if (subresourceFailures.phones > 0) {
        totals.skippedReasons!["subresource_phones_failed"] =
          (totals.skippedReasons!["subresource_phones_failed"] ?? 0) + subresourceFailures.phones;
      }
      if (subresourceFailures.addresses > 0) {
        totals.skippedReasons!["subresource_addresses_failed"] =
          (totals.skippedReasons!["subresource_addresses_failed"] ?? 0) + subresourceFailures.addresses;
      }

      offset += limit;
      pagesFetched += 1;
      partialDueToDevCap = constituents.length === limit && pagesFetched >= maxPages;
      hasMore = constituents.length === limit && !partialDueToDevCap;
    }

    if (partialDueToDevCap) {
      totals.partial = true;
      totals.warning = "Blackbaud sync stopped early because BLACKBAUD_DEV_MAX_PAGES is set. last_synced_at was not advanced.";
    }

    // R5: any sub-resource failures → mark partial + structured warning.
    // Existing alumni columns were preserved (storage skips undefined fields).
    const failedKinds = (["emails", "phones", "addresses"] as const).filter(
      (kind) => (totals.skippedReasons?.[`subresource_${kind}_failed`] ?? 0) > 0,
    );
    const subresourceWarning =
      failedKinds.length > 0
        ? `Blackbaud sub-resource fetch failed for: ${failedKinds
            .map((k) => `${k} (${totals.skippedReasons![`subresource_${k}_failed`]})`)
            .join(", ")}. Existing alumni values preserved.`
        : null;
    if (subresourceWarning) {
      totals.partial = true;
      totals.warning = totals.warning
        ? `${totals.warning} ${subresourceWarning}`
        : subresourceWarning;
    }

    if (syncLogId) {
      await supabase
        .from("integration_sync_log")
        .update({
          status: "completed",
          records_created: totals.created,
          records_updated: totals.updated,
          records_unchanged: totals.unchanged,
          records_skipped: totals.skipped,
          error_message: subresourceWarning,
          completed_at: new Date().toISOString(),
        })
        .eq("id", syncLogId);
    }

    await supabase
      .from("org_integrations")
      .update({
        ...(partialDueToDevCap ? {} : { last_synced_at: syncStartedAt }),
        last_sync_count: totals.created + totals.updated,
        last_sync_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", integrationId);

    // Best-effort: enqueue LinkedIn enrichment for synced alumni that already
    // have a URL. Must never fail or roll back the Blackbaud sync itself.
    if (touchedAlumniIds.length > 0 && isApifyConfigured()) {
      try {
        const { enqueued } = await enqueueAlumniForEnrichment(
          supabase,
          deps.organizationId,
          touchedAlumniIds,
        );
        if (enqueued > 0) {
          debugLog("blackbaud-sync", "queued linkedin enrichment", { enqueued });
        }
      } catch (enrichErr) {
        debugLog("blackbaud-sync", "linkedin enrichment enqueue failed", {
          error: enrichErr instanceof Error ? enrichErr.message : String(enrichErr),
        });
      }
    }

    return totals;
  } catch (err) {
    const failure =
      err instanceof BlackbaudSyncFailure
        ? err
        : new BlackbaudSyncFailure(
            "api_fetch",
            err instanceof BlackbaudApiError && err.isQuotaExhausted ? "QUOTA_EXHAUSTED" : "SYNC_FAILED",
            err instanceof Error ? err.message : String(err),
            err instanceof BlackbaudApiError ? { isQuotaExhausted: err.isQuotaExhausted, retryAfterHuman: err.retryAfterHuman } : undefined,
          );
    const errorMessage = failure.message;
    const syncError = makeSyncError(failure.phase, failure.code, errorMessage);

    if (syncLogId) {
      await supabase
        .from("integration_sync_log")
        .update({
          status: "failed",
          records_created: totals.created,
          records_updated: totals.updated,
          records_unchanged: totals.unchanged,
          records_skipped: totals.skipped,
          error_message: errorMessage,
          completed_at: new Date().toISOString(),
        })
        .eq("id", syncLogId);
    }

    await supabase
      .from("org_integrations")
      .update({
        last_sync_error: syncError as unknown as Json,
        updated_at: new Date().toISOString(),
      })
      .eq("id", integrationId);

    return { ...totals, ok: false, error: errorMessage };
  }
}
