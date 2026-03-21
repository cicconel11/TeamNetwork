import type {
  BlackbaudConstituent,
  BlackbaudEmail,
  SyncResult,
  NormalizedConstituent,
  SyncError,
} from "./types";
import type { BlackbaudClient } from "./client";
import { normalizeConstituent } from "./normalize";
import { upsertConstituents } from "./storage";
import { makeSyncError } from "./oauth";
import { checkBlackbaudHealth, formatBlackbaudHealthError } from "./health";
import { debugLog } from "@/lib/debug";

export interface SyncDeps {
  client: BlackbaudClient;
  supabase: any; // eslint-disable-line @typescript-eslint/no-explicit-any
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

  constructor(phase: SyncError["phase"], code: string, message: string) {
    super(message);
    this.phase = phase;
    this.code = code;
  }
}

/**
 * Runs a full sync cycle: paginated fetch → normalize → upsert.
 * Creates a sync log entry and updates integration state.
 */
export async function runSync(deps: SyncDeps): Promise<SyncResult> {
  const { client, supabase, integrationId, syncType, lastSyncedAt } = deps;

  // ── Concurrency guard (insert-first, catch unique violation) ──
  // The unique partial index on (integration_id) WHERE status = 'running'
  // atomically prevents concurrent syncs.
  const UNIQUE_VIOLATION = "23505";
  const STALE_THRESHOLD_MS = 30 * 60 * 1000;

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
      // Another sync is running — check if stale
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

        // Stale lock — mark as failed and retry
        await supabase
          .from("integration_sync_log")
          .update({ status: "failed", error_message: "Stale lock released", completed_at: new Date().toISOString() })
          .eq("id", runningSync.id);

        debugLog("blackbaud-sync", "released stale sync lock", {
          staleId: runningSync.id,
          integrationId,
          staleSinceMs: Date.now() - startedAt.getTime(),
        });

        // Retry insert after releasing stale lock
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
        // Unique violation but no running sync found (race resolved) — bail
        return { ok: false, created: 0, updated: 0, unchanged: 0, skipped: 0, error: "Sync already in progress" };
      }
    } else {
      debugLog("blackbaud-sync", "failed to create sync log", { error: logError.message });
      return { ok: false, created: 0, updated: 0, unchanged: 0, skipped: 0, error: `Failed to acquire sync lock: ${logError.message}` };
    }
  } else {
    syncLogId = syncLog?.id ?? null;
  }

  const totals: SyncResult = { ok: true, created: 0, updated: 0, unchanged: 0, skipped: 0 };

  // Capture cursor BEFORE fetching so records modified during this sync
  // are re-processed next run (upsert handles overlap harmlessly).
  const syncStartedAt = new Date().toISOString();

  try {
    const health = await checkBlackbaudHealth(client);
    if (!health.ok) {
      throw new BlackbaudSyncFailure(
        "api_verify",
        "VERIFY_FAILED",
        formatBlackbaudHealthError(health)
      );
    }

    let offset = 0;
    const limit = 500;
    let hasMore = true;

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

      // Phase 1: fetch email sub-resource only
      const normalized: NormalizedConstituent[] = [];
      for (const constituent of constituents) {
        try {
          let emails: BlackbaudEmail[] = [];
          try {
            const emailsRes = await client.getList<BlackbaudEmail>(
              `/constituent/v1/constituents/${constituent.id}/emailaddresses`
            );
            emails = emailsRes.value;
            await new Promise((resolve) => setTimeout(resolve, 50));
          } catch (err) {
            debugLog("blackbaud-sync", "email fetch error", {
              constituentId: constituent.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }

          normalized.push(normalizeConstituent(constituent, emails, [], []));
        } catch (err) {
          debugLog("blackbaud-sync", "normalize error", {
            constituentId: constituent.id,
            error: err instanceof Error ? err.message : String(err),
          });
          normalized.push(normalizeConstituent(constituent, [], [], []));
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

      offset += limit;
      hasMore = constituents.length === limit;
    }

    // Update sync log as completed
    if (syncLogId) {
      await supabase
        .from("integration_sync_log")
        .update({
          status: "completed",
          records_created: totals.created,
          records_updated: totals.updated,
          records_unchanged: totals.unchanged,
          records_skipped: totals.skipped,
          completed_at: new Date().toISOString(),
        })
        .eq("id", syncLogId);
    }

    // Update integration state
    await supabase
      .from("org_integrations")
      .update({
        last_synced_at: syncStartedAt,
        last_sync_count: totals.created + totals.updated,
        last_sync_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", integrationId);

    return totals;
  } catch (err) {
    const failure =
      err instanceof BlackbaudSyncFailure
        ? err
        : new BlackbaudSyncFailure(
            "api_fetch",
            "SYNC_FAILED",
            err instanceof Error ? err.message : String(err)
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
        last_sync_error: syncError,
        updated_at: new Date().toISOString(),
      })
      .eq("id", integrationId);

    return { ...totals, ok: false, error: errorMessage };
  }
}
