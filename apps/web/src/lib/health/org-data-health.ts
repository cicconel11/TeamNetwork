import type { SupabaseClient } from "@supabase/supabase-js";
import { falkorClient, type FalkorQueryClient } from "@/lib/falkordb/client";
import { getGraphHealthSurface, type GraphHealthSurface } from "@/lib/falkordb/sync";
import { checkGraphDrift, type GraphDriftReport } from "@/lib/falkordb/drift";
import { checkRagHealth, type RagHealthReport } from "@/lib/ai/rag-health";
import {
  checkEnrichmentHealth,
  type EnrichmentHealthReport,
} from "@/lib/linkedin/enrichment-health";

/**
 * Consolidated read-only data-health report for one org, spanning the three
 * independently-synced pipelines:
 *  - people-graph (FalkorDB): freshness/queue surface + drift vs Supabase truth
 *  - RAG index (pgvector): chunk coverage, orphans, staleness, audience tagging
 *  - enrichment (Apify): userless rows, failures, stalled runs, provenance gaps
 *
 * Each section degrades independently — a section that cannot be computed (e.g.
 * Falkor unavailable) reports `degraded` rather than failing the whole report.
 */
export interface OrgDataHealthReport {
  orgId: string;
  graph: {
    surface: GraphHealthSurface;
    drift: GraphDriftReport;
  };
  rag: RagHealthReport;
  enrichment: EnrichmentHealthReport;
}

interface GetOrgDataHealthOptions {
  /** Override the FalkorDB client (tests). Defaults to the shared client. */
  graphClient?: FalkorQueryClient;
  /** Injectable clock for deterministic enrichment stalled-run detection. */
  now?: number;
}

export async function getOrgDataHealth(
  serviceSupabase: SupabaseClient,
  orgId: string,
  options: GetOrgDataHealthOptions = {}
): Promise<OrgDataHealthReport> {
  const graphClient = options.graphClient ?? falkorClient;

  const [surface, drift, rag, enrichment] = await Promise.all([
    getGraphHealthSurface(serviceSupabase, orgId),
    checkGraphDrift(serviceSupabase, orgId, graphClient),
    checkRagHealth(serviceSupabase, orgId),
    checkEnrichmentHealth(serviceSupabase, orgId, { now: options.now }),
  ]);

  return {
    orgId,
    graph: { surface, drift },
    rag,
    enrichment,
  };
}
