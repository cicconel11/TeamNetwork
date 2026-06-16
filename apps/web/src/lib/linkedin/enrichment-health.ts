import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Read-only checker for enrichment data-tagging health. Surfaces the rows that
 * silently stall or carry an incomplete tagging trail:
 *  - userless member rows (invisible to the enrichment cron and un-keyable in
 *    the people-graph under a `user:` node)
 *  - permanently-failed enrichment (retries exhausted)
 *  - stalled enrichment runs (still "syncing" long past the hard timeout)
 *  - pre-provenance rows (enriched data with no `enrichment_filled_fields`)
 */

const MAX_RETRIES = 3;
const HARD_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const SAMPLE_CAP = 50;
/** Upper bound on rows scanned per category — keeps the checker bounded. */
const SCAN_LIMIT = 5000;

export interface EnrichmentHealthReport {
  orgId: string;
  state: "ok" | "gaps" | "degraded";
  reason: string | null;
  /** Member rows with no linked user_id. */
  userlessRows: string[];
  /** Alumni whose enrichment failed after exhausting retries. */
  permanentlyFailed: string[];
  /** Enrichment runs stuck in "syncing" past the hard timeout. */
  stalledRuns: string[];
  /** Enriched alumni with no provenance array (pre-provenance rows). */
  preProvenance: string[];
  counts: {
    userlessRows: number;
    permanentlyFailed: number;
    stalledRuns: number;
    preProvenance: number;
  };
  truncated: boolean;
}

function toMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "unknown_error";
}

function degraded(orgId: string, reason: string): EnrichmentHealthReport {
  return {
    orgId,
    state: "degraded",
    reason,
    userlessRows: [],
    permanentlyFailed: [],
    stalledRuns: [],
    preProvenance: [],
    counts: { userlessRows: 0, permanentlyFailed: 0, stalledRuns: 0, preProvenance: 0 },
    truncated: false,
  };
}

interface CheckOptions {
  /** Injectable clock for deterministic stalled-run detection. */
  now?: number;
}

export interface EnrichmentHealthSummary {
  userlessRows: number;
  permanentlyFailed: number;
  stalledRuns: number;
  preProvenance: number;
}

/**
 * Cross-org aggregate counts of the same enrichment-tagging problems
 * {@link checkEnrichmentHealth} reports per org. Best-effort: any failed count
 * resolves to 0 so the enrichment cron's response is never broken by it.
 */
export async function summarizeEnrichmentHealthGlobal(
  serviceSupabase: SupabaseClient,
  options: CheckOptions = {}
): Promise<EnrichmentHealthSummary> {
  const now = options.now ?? Date.now();
  const hardCutoff = new Date(now - HARD_TIMEOUT_MS).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = serviceSupabase as any;

  async function count(run: () => Promise<{ count: unknown; error: unknown }>): Promise<number> {
    try {
      const { count: value, error } = await run();
      if (error || typeof value !== "number") return 0;
      return value;
    } catch {
      return 0;
    }
  }

  const [userlessRows, permanentlyFailed, stalledRuns, preProvenance] = await Promise.all([
    count(() =>
      sb
        .from("members")
        .select("id", { count: "exact", head: true })
        .is("user_id", null)
        .is("deleted_at", null)
    ),
    count(() =>
      sb
        .from("alumni")
        .select("id", { count: "exact", head: true })
        .eq("enrichment_status", "failed")
        .gte("enrichment_retry_count", MAX_RETRIES)
        .is("deleted_at", null)
    ),
    count(() =>
      sb
        .from("linkedin_enrichment_runs")
        .select("id", { count: "exact", head: true })
        .eq("status", "syncing")
        .lt("updated_at", hardCutoff)
    ),
    count(() =>
      sb
        .from("alumni")
        .select("id", { count: "exact", head: true })
        .eq("enrichment_status", "enriched")
        .is("enrichment_filled_fields", null)
        .is("deleted_at", null)
    ),
  ]);

  return { userlessRows, permanentlyFailed, stalledRuns, preProvenance };
}

export async function checkEnrichmentHealth(
  serviceSupabase: SupabaseClient,
  orgId: string,
  options: CheckOptions = {}
): Promise<EnrichmentHealthReport> {
  const now = options.now ?? Date.now();
  const hardCutoff = new Date(now - HARD_TIMEOUT_MS).toISOString();
  let truncated = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = serviceSupabase as any;

  async function fetchIds(
    run: () => Promise<{ data: unknown; error: unknown }>,
    key: string
  ): Promise<string[]> {
    const { data, error } = await run();
    if (error) throw new Error(toMessage(error));
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (rows.length >= SCAN_LIMIT) truncated = true;
    return rows.map((row) => String(row[key]));
  }

  let userlessRows: string[];
  let permanentlyFailed: string[];
  let stalledRuns: string[];
  let preProvenance: string[];

  try {
    [userlessRows, permanentlyFailed, stalledRuns, preProvenance] = await Promise.all([
      fetchIds(
        () =>
          sb
            .from("members")
            .select("id")
            .eq("organization_id", orgId)
            .is("user_id", null)
            .is("deleted_at", null)
            .limit(SCAN_LIMIT),
        "id"
      ),
      fetchIds(
        () =>
          sb
            .from("alumni")
            .select("id")
            .eq("organization_id", orgId)
            .eq("enrichment_status", "failed")
            .gte("enrichment_retry_count", MAX_RETRIES)
            .is("deleted_at", null)
            .limit(SCAN_LIMIT),
        "id"
      ),
      fetchIds(
        () =>
          sb
            .from("linkedin_enrichment_runs")
            .select("id")
            .eq("organization_id", orgId)
            .eq("status", "syncing")
            .lt("updated_at", hardCutoff)
            .limit(SCAN_LIMIT),
        "id"
      ),
      fetchIds(
        () =>
          sb
            .from("alumni")
            .select("id")
            .eq("organization_id", orgId)
            .eq("enrichment_status", "enriched")
            .is("enrichment_filled_fields", null)
            .is("deleted_at", null)
            .limit(SCAN_LIMIT),
        "id"
      ),
    ]);
  } catch (error) {
    return degraded(orgId, toMessage(error));
  }

  const counts = {
    userlessRows: userlessRows.length,
    permanentlyFailed: permanentlyFailed.length,
    stalledRuns: stalledRuns.length,
    preProvenance: preProvenance.length,
  };
  const hasGaps =
    counts.userlessRows > 0 ||
    counts.permanentlyFailed > 0 ||
    counts.stalledRuns > 0 ||
    counts.preProvenance > 0;

  return {
    orgId,
    state: hasGaps ? "gaps" : "ok",
    reason: truncated ? "partial_scan" : null,
    userlessRows: userlessRows.slice(0, SAMPLE_CAP),
    permanentlyFailed: permanentlyFailed.slice(0, SAMPLE_CAP),
    stalledRuns: stalledRuns.slice(0, SAMPLE_CAP),
    preProvenance: preProvenance.slice(0, SAMPLE_CAP),
    counts,
    truncated,
  };
}
