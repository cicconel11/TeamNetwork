/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateEmbedding } from "./embeddings";
import { aiLog, type AiLogContext } from "./logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetrievedChunk {
  id: string;
  sourceTable: string;
  sourceId: string;
  chunkIndex: number;
  contentText: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

export interface RetrieveParams {
  query: string;
  orgId: string;
  serviceSupabase: SupabaseClient;
  logContext?: AiLogContext;
  maxChunks?: number;
  similarityThreshold?: number;
  sourceTables?: string[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CHUNKS = 5;
const DEFAULT_SIMILARITY_THRESHOLD = parseFloat(
  process.env.RAG_SIMILARITY_THRESHOLD || "0.55"
);
// Drop chunks whose content is too short to be meaningful ("ok", "hjbjk", etc.).
const MIN_CHUNK_CONTENT_LENGTH = 40;

// Map bare domain terms to an expanded phrase so embeddings align with indexed
// content (e.g. a "job" query matches "Job: Senior Engineer" chunks).
const QUERY_EXPANSIONS: Record<string, string> = {
  job: "job posting role hiring position",
  jobs: "job postings roles hiring positions",
  event: "event meeting gathering schedule",
  events: "events meetings gatherings schedule",
  member: "team member roster directory",
  members: "team members roster directory",
  alumni: "alumni graduates former members directory",
  announcement: "announcement update news",
  announcements: "announcements updates news",
  discussion: "discussion thread conversation",
  discussions: "discussion threads conversations",
  thread: "discussion thread conversation",
  threads: "discussion threads conversations",
};

export function expandQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return trimmed;
  const lower = trimmed.toLowerCase();
  const expansion = QUERY_EXPANSIONS[lower];
  return expansion ? `${trimmed} ${expansion}` : trimmed;
}

// Heuristic: detect gibberish chunks like "hjbhjb bhjhjkjkhkuh" — consonant runs,
// no real vowels-to-letters ratio, and no recognizable word-shaped tokens. We
// require at least one token of 3+ chars with a typical vowel ratio.
function looksLikeGibberish(text: string): boolean {
  const cleaned = text.trim().toLowerCase();
  if (!cleaned) return true;
  const tokens = cleaned.split(/\s+/).filter((t) => /[a-z]/.test(t));
  if (tokens.length === 0) return true;
  const realWordish = tokens.filter((t) => {
    if (t.length < 3) return false;
    const letters = t.replace(/[^a-z]/g, "");
    if (letters.length < 3) return false;
    const vowels = (letters.match(/[aeiou]/g) ?? []).length;
    const ratio = vowels / letters.length;
    return ratio >= 0.2 && ratio <= 0.75;
  });
  return realWordish.length === 0;
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

/**
 * Retrieve document chunks relevant to the user's query via vector similarity.
 *
 * When a reply chunk is matched, auto-fetches the parent thread chunk and
 * prepends it if not already in results.
 */
export async function retrieveRelevantChunks(
  params: RetrieveParams
): Promise<RetrievedChunk[]> {
  const {
    query,
    orgId,
    serviceSupabase,
    logContext,
    maxChunks = DEFAULT_MAX_CHUNKS,
    similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD,
    sourceTables,
  } = params;

  // Generate query embedding (expand bare domain terms first)
  const queryEmbedding = await generateEmbedding(expandQuery(query));

  // Call the search RPC
  const { data, error } = await (serviceSupabase.rpc as any)(
    "search_ai_documents",
    {
      p_org_id: orgId,
      p_query_embedding: JSON.stringify(queryEmbedding),
      p_match_count: maxChunks,
      p_similarity_threshold: similarityThreshold,
      ...(sourceTables ? { p_source_tables: sourceTables } : {}),
    }
  );

  if (error) {
    aiLog("error", "rag-retriever", "search failed", logContext ?? {
      requestId: "unknown_request",
      orgId,
    }, { error });
    throw new Error(`RAG search failed: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return [];
  }

  const chunks: RetrievedChunk[] = (data as any[])
    .map((row) => ({
      id: row.id,
      sourceTable: row.source_table,
      sourceId: row.source_id,
      chunkIndex: row.chunk_index,
      contentText: row.content_text,
      metadata: row.metadata ?? {},
      similarity: row.similarity,
    }))
    .filter((c) => {
      const text = (c.contentText ?? "").trim();
      if (text.length < MIN_CHUNK_CONTENT_LENGTH) return false;
      if (looksLikeGibberish(text)) return false;
      return true;
    });

  // Auto-fetch parent thread chunks for reply results
  return await enrichWithParentChunks(chunks, orgId, serviceSupabase, logContext);
}

/**
 * For reply chunks, fetch the parent thread chunk and prepend if not
 * already present in results.
 */
async function enrichWithParentChunks(
  chunks: RetrievedChunk[],
  orgId: string,
  serviceSupabase: SupabaseClient,
  logContext?: AiLogContext
): Promise<RetrievedChunk[]> {
  // Find reply chunks with parent_thread_id metadata
  const parentThreadIds = new Set<string>();
  const existingSourceIds = new Set(chunks.map((c) => c.sourceId));

  for (const chunk of chunks) {
    if (
      chunk.sourceTable === "discussion_replies" &&
      chunk.metadata.parent_thread_id &&
      !existingSourceIds.has(String(chunk.metadata.parent_thread_id))
    ) {
      parentThreadIds.add(String(chunk.metadata.parent_thread_id));
    }
  }

  if (parentThreadIds.size === 0) return chunks;

  // Fetch parent thread chunks from ai_document_chunks
  const { data: parentChunks, error } = await (serviceSupabase as any)
    .from("ai_document_chunks")
    .select("id, source_table, source_id, chunk_index, content_text, metadata")
    .eq("org_id", orgId)
    .eq("source_table", "discussion_threads")
    .in("source_id", Array.from(parentThreadIds))
    .eq("chunk_index", 0)
    .is("deleted_at", null);

  if (error || !parentChunks) {
    // Non-fatal — return results without parent context
    if (error) {
      aiLog("warn", "rag-retriever", "parent chunk fetch failed", logContext ?? {
        requestId: "unknown_request",
        orgId,
      }, { error });
    }
    return chunks;
  }

  // Prepend parent chunks (with similarity 0 since they were not directly matched)
  const parentResults: RetrievedChunk[] = (parentChunks as any[]).map(
    (row) => ({
      id: row.id,
      sourceTable: row.source_table,
      sourceId: row.source_id,
      chunkIndex: row.chunk_index,
      contentText: row.content_text,
      metadata: { ...row.metadata, _parentContext: true },
      similarity: 0,
    })
  );

  return [...parentResults, ...chunks];
}
