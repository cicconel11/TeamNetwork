import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeContentHash,
  renderChunks,
  type ParentThreadContext,
  type SourceTable,
} from "@/lib/ai/chunker";

/**
 * Read-only correctness checker for the RAG index (`ai_document_chunks`).
 */

const SAMPLE_CAP = 50;
const PAGE_SIZE = 1000;
const MAX_ROWS = PAGE_SIZE * 20;

interface IndexedTable {
  table: SourceTable;
  /** Columns required to re-render the chunk for staleness comparison. */
  select: string;
  hasAudience: boolean;
}

const INDEXED_TABLES: IndexedTable[] = [
  {
    table: "announcements",
    select: "id, title, body, audience, published_at, deleted_at",
    hasAudience: true,
  },
  {
    table: "events",
    select: "id, title, description, start_date, end_date, location, audience, deleted_at",
    hasAudience: true,
  },
  { table: "discussion_threads", select: "id, title, body, deleted_at", hasAudience: false },
  { table: "discussion_replies", select: "id, thread_id, body, deleted_at", hasAudience: false },
  {
    table: "job_postings",
    select: "id, title, company, description, location, location_type, deleted_at",
    hasAudience: false,
  },
  {
    table: "mentor_profiles",
    select: "id, user_id, bio, topics, industries, is_active",
    hasAudience: false,
  },
  {
    table: "form_submissions",
    select: "id, form_id, user_id, data, deleted_at",
    hasAudience: false,
  },
];

export interface RagSourceRef {
  sourceTable: string;
  sourceId: string;
}

export interface RagHealthReport {
  orgId: string;
  state: "ok" | "gaps" | "degraded";
  reason: string | null;
  /** Eligible, non-excluded source rows with no chunk. */
  missingCoverage: RagSourceRef[];
  /** Chunks whose source row is deleted or missing. */
  orphanChunks: RagSourceRef[];
  /** Sources whose current rendered content no longer matches stored chunk hashes. */
  staleSources: RagSourceRef[];
  /** Audience-restricted sources whose chunk metadata is missing the audience tag. */
  untaggedAudience: RagSourceRef[];
  counts: {
    missingCoverage: number;
    orphanChunks: number;
    staleSources: number;
    untaggedAudience: number;
  };
  truncated: boolean;
}

interface ChunkRow {
  source_table: string;
  source_id: string;
  chunk_index: number;
  content_hash: string;
  metadata: Record<string, unknown> | null;
}

function toMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "unknown_error";
}

async function fetchAll<T>(
  supabase: SupabaseClient,
  build: (from: number, to: number) => Promise<{ data: unknown; error: unknown }>
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  let from = 0;
  while (from < MAX_ROWS) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(toMessage(error));
    }
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return { rows, truncated: false };
    from += PAGE_SIZE;
  }
  return { rows, truncated: true };
}

function degraded(orgId: string, reason: string): RagHealthReport {
  return {
    orgId,
    state: "degraded",
    reason,
    missingCoverage: [],
    orphanChunks: [],
    staleSources: [],
    untaggedAudience: [],
    counts: { missingCoverage: 0, orphanChunks: 0, staleSources: 0, untaggedAudience: 0 },
    truncated: false,
  };
}

function isLiveSource(table: SourceTable, row: Record<string, unknown>): boolean {
  if (table === "mentor_profiles") {
    return row.is_active !== false;
  }
  return !row.deleted_at;
}

export async function checkRagHealth(
  serviceSupabase: SupabaseClient,
  orgId: string
): Promise<RagHealthReport> {
  const missingCoverage: RagSourceRef[] = [];
  const orphanChunks: RagSourceRef[] = [];
  const staleSources: RagSourceRef[] = [];
  const untaggedAudience: RagSourceRef[] = [];
  let truncated = false;

  // Exclusions (admin opt-outs). On failure, fail-closed by treating none as
  // excluded would over-report; instead degrade so the surface is honest.
  let excluded: Set<string>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (serviceSupabase as any)
      .from("ai_indexing_exclusions")
      .select("source_table, source_id")
      .eq("org_id", orgId);
    if (error) return degraded(orgId, toMessage(error));
    excluded = new Set(
      ((data ?? []) as Array<{ source_table: string; source_id: string }>).map(
        (row) => `${row.source_table}:${row.source_id}`
      )
    );
  } catch (error) {
    return degraded(orgId, toMessage(error));
  }

  for (const config of INDEXED_TABLES) {
    let sources: Array<Record<string, unknown>>;
    let chunks: ChunkRow[];

    try {
      const sourceResult = await fetchAll<Record<string, unknown>>(serviceSupabase, (from, to) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (serviceSupabase as any)
          .from(config.table)
          .select(config.select)
          .eq("organization_id", orgId)
          .range(from, to)
      );
      const chunkResult = await fetchAll<ChunkRow>(serviceSupabase, (from, to) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (serviceSupabase as any)
          .from("ai_document_chunks")
          .select("source_table, source_id, chunk_index, content_hash, metadata")
          .eq("org_id", orgId)
          .eq("source_table", config.table)
          .is("deleted_at", null)
          .range(from, to)
      );
      sources = sourceResult.rows;
      chunks = chunkResult.rows;
      truncated = truncated || sourceResult.truncated || chunkResult.truncated;
    } catch (error) {
      return degraded(orgId, toMessage(error));
    }

    // Index source rows and chunks.
    const sourceById = new Map<string, Record<string, unknown>>();
    const liveSourceIds = new Set<string>();
    for (const row of sources) {
      const id = String(row.id);
      sourceById.set(id, row);
      if (isLiveSource(config.table, row)) liveSourceIds.add(id);
    }

    const chunksBySource = new Map<string, ChunkRow[]>();
    for (const chunk of chunks) {
      const list = chunksBySource.get(chunk.source_id) ?? [];
      list.push(chunk);
      chunksBySource.set(chunk.source_id, list);
    }

    // Parent-thread context for reply rendering (mirrors the embedding worker).
    const parentThreads = new Map<string, ParentThreadContext>();
    if (config.table === "discussion_replies") {
      const threadIds = [
        ...new Set(
          sources
            .filter((row) => isLiveSource(config.table, row) && row.thread_id)
            .map((row) => String(row.thread_id))
        ),
      ];
      if (threadIds.length > 0) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data, error } = await (serviceSupabase as any)
            .from("discussion_threads")
            .select("id, title, body")
            .in("id", threadIds);
          if (error) return degraded(orgId, toMessage(error));
          for (const row of (data ?? []) as Array<Record<string, unknown>>) {
            parentThreads.set(String(row.id), {
              title: String(row.title ?? ""),
              body: String(row.body ?? ""),
            });
          }
        } catch (error) {
          return degraded(orgId, toMessage(error));
        }
      }
    }

    // Missing coverage: eligible (live, non-excluded) sources with no chunks.
    for (const id of liveSourceIds) {
      if (excluded.has(`${config.table}:${id}`)) continue;
      if (!chunksBySource.has(id)) {
        missingCoverage.push({ sourceTable: config.table, sourceId: id });
      }
    }

    for (const [sourceId, sourceChunks] of chunksBySource.entries()) {
      // Orphan: chunk whose source row is deleted or missing entirely.
      if (!liveSourceIds.has(sourceId)) {
        orphanChunks.push({ sourceTable: config.table, sourceId });
        continue;
      }

      const record = sourceById.get(sourceId)!;

      // Untagged audience: source carries an audience but the chunk metadata
      // dropped it (cannot be enforced at query time → feeds the audience fix).
      if (config.hasAudience && record.audience) {
        const anyTagged = sourceChunks.some(
          (chunk) => chunk.metadata && chunk.metadata.audience != null
        );
        if (!anyTagged) {
          untaggedAudience.push({ sourceTable: config.table, sourceId });
        }
      }

      // Stale: re-render and compare hashes against stored chunks.
      const parentContext =
        config.table === "discussion_replies" && record.thread_id
          ? parentThreads.get(String(record.thread_id))
          : undefined;
      const rendered = renderChunks(config.table, record, parentContext);
      const renderedByIndex = new Map(
        rendered.map((chunk) => [chunk.chunkIndex, computeContentHash(chunk.text)])
      );
      const storedByIndex = new Map(sourceChunks.map((chunk) => [chunk.chunk_index, chunk.content_hash]));

      let stale = renderedByIndex.size !== storedByIndex.size;
      if (!stale) {
        for (const [index, hash] of renderedByIndex.entries()) {
          if (storedByIndex.get(index) !== hash) {
            stale = true;
            break;
          }
        }
      }
      if (stale) {
        staleSources.push({ sourceTable: config.table, sourceId });
      }
    }
  }

  const counts = {
    missingCoverage: missingCoverage.length,
    orphanChunks: orphanChunks.length,
    staleSources: staleSources.length,
    untaggedAudience: untaggedAudience.length,
  };
  const hasGaps =
    counts.missingCoverage > 0 ||
    counts.orphanChunks > 0 ||
    counts.staleSources > 0 ||
    counts.untaggedAudience > 0;

  return {
    orgId,
    state: hasGaps ? "gaps" : "ok",
    reason: truncated ? "partial_scan" : null,
    missingCoverage: missingCoverage.slice(0, SAMPLE_CAP),
    orphanChunks: orphanChunks.slice(0, SAMPLE_CAP),
    staleSources: staleSources.slice(0, SAMPLE_CAP),
    untaggedAudience: untaggedAudience.slice(0, SAMPLE_CAP),
    counts,
    truncated,
  };
}
