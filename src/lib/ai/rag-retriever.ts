/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateEmbedding } from "./embeddings";

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
  maxChunks?: number;
  similarityThreshold?: number;
  sourceTables?: string[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CHUNKS = 5;
const DEFAULT_SIMILARITY_THRESHOLD = parseFloat(
  process.env.RAG_SIMILARITY_THRESHOLD || "0.5"
);

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
    maxChunks = DEFAULT_MAX_CHUNKS,
    similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD,
    sourceTables,
  } = params;

  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query);

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
    console.error("[rag-retriever] search failed:", error);
    throw new Error(`RAG search failed: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return [];
  }

  const chunks: RetrievedChunk[] = (data as any[]).map((row) => ({
    id: row.id,
    sourceTable: row.source_table,
    sourceId: row.source_id,
    chunkIndex: row.chunk_index,
    contentText: row.content_text,
    metadata: row.metadata ?? {},
    similarity: row.similarity,
  }));

  // Auto-fetch parent thread chunks for reply results
  return await enrichWithParentChunks(chunks, orgId, serviceSupabase);
}

/**
 * For reply chunks, fetch the parent thread chunk and prepend if not
 * already present in results.
 */
async function enrichWithParentChunks(
  chunks: RetrievedChunk[],
  orgId: string,
  serviceSupabase: SupabaseClient
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
      console.warn("[rag-retriever] parent chunk fetch failed:", error);
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
