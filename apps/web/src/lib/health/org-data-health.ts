import type { SupabaseClient } from "@supabase/supabase-js";
import { checkRagHealth, type RagHealthReport } from "@/lib/ai/rag-health";
import {
  checkEnrichmentHealth,
  type EnrichmentHealthReport,
} from "@/lib/linkedin/enrichment-health";

/**
 * Consolidated read-only data-health report for one org, spanning the two
 * background-synced pipelines:
 *  - RAG index (pgvector): chunk coverage, orphans, staleness, audience tagging
 *  - enrichment (Apify): userless rows, failures, stalled runs, provenance gaps
 *
 * The people-graph is served directly from Postgres (`mentorship_pairs` +
 * member/alumni projections), so there is no separate store to drift against.
 *
 * Each section degrades independently — a section that cannot be computed
 * reports `degraded` rather than failing the whole report.
 */
export interface OrgDataHealthReport {
  orgId: string;
  rag: RagHealthReport;
  enrichment: EnrichmentHealthReport;
}

interface GetOrgDataHealthOptions {
  /** Injectable clock for deterministic enrichment stalled-run detection. */
  now?: number;
}

export async function getOrgDataHealth(
  serviceSupabase: SupabaseClient,
  orgId: string,
  options: GetOrgDataHealthOptions = {}
): Promise<OrgDataHealthReport> {
  const [rag, enrichment] = await Promise.all([
    checkRagHealth(serviceSupabase, orgId),
    checkEnrichmentHealth(serviceSupabase, orgId, { now: options.now }),
  ]);

  return {
    orgId,
    rag,
    enrichment,
  };
}
