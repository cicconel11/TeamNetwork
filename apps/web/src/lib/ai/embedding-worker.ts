/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateEmbeddings } from "./embeddings";
import {
  renderChunks,
  computeContentHash,
  type SourceTable,
  type ParentThreadContext,
} from "./chunker";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueueStats {
  processed: number;
  skipped: number;
  failed: number;
}

interface QueueItem {
  id: string;
  org_id: string;
  source_table: string;
  source_id: string;
  action: string;
}

interface ProcessOptions {
  batchSize?: number;
}

// ---------------------------------------------------------------------------
// Source table column selects
// ---------------------------------------------------------------------------

const SOURCE_SELECTS: Record<SourceTable, string> = {
  announcements: "id, title, body, audience, published_at, organization_id, deleted_at",
  events:
    "id, title, description, start_date, end_date, location, audience, organization_id, deleted_at",
  discussion_threads: "id, title, body, organization_id, deleted_at",
  discussion_replies: "id, thread_id, body, organization_id, deleted_at",
  job_postings:
    "id, title, company, description, location, location_type, organization_id, deleted_at",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidSourceTable(t: string): t is SourceTable {
  return t in SOURCE_SELECTS;
}

async function fetchSourceRecords(
  supabase: SupabaseClient,
  sourceTable: SourceTable,
  sourceIds: string[]
): Promise<Map<string, Record<string, unknown>>> {
  const { data, error } = await (supabase as any)
    .from(sourceTable)
    .select(SOURCE_SELECTS[sourceTable])
    .in("id", sourceIds);

  if (error || !data) {
    console.error(`[embedding-worker] fetch ${sourceTable} failed:`, error);
    return new Map();
  }

  const map = new Map<string, Record<string, unknown>>();
  for (const row of data as Record<string, unknown>[]) {
    map.set(String(row.id), row);
  }
  return map;
}

async function fetchParentThreads(
  supabase: SupabaseClient,
  threadIds: string[]
): Promise<Map<string, ParentThreadContext>> {
  if (threadIds.length === 0) return new Map();

  const { data, error } = await (supabase as any)
    .from("discussion_threads")
    .select("id, title, body")
    .in("id", threadIds);

  if (error || !data) {
    console.error("[embedding-worker] fetch parent threads failed:", error);
    return new Map();
  }

  const map = new Map<string, ParentThreadContext>();
  for (const row of data as Record<string, unknown>[]) {
    map.set(String(row.id), {
      title: String(row.title ?? ""),
      body: String(row.body ?? ""),
    });
  }
  return map;
}

/**
 * Fetch exclusions for an org. Returns null on failure (fail-closed).
 * When null, caller must skip all items for this org.
 */
async function fetchExclusions(
  supabase: SupabaseClient,
  orgId: string
): Promise<Set<string> | null> {
  const { data, error } = await (supabase as any)
    .from("ai_indexing_exclusions")
    .select("source_table, source_id")
    .eq("org_id", orgId);

  if (error || !data) {
    if (error) {
      console.error("[embedding-worker] fetch exclusions failed — skipping org:", error);
    }
    return null; // fail-closed: caller must skip this org
  }

  const excluded = new Set<string>();
  for (const row of data as { source_table: string; source_id: string }[]) {
    excluded.add(`${row.source_table}:${row.source_id}`);
  }
  return excluded;
}

/**
 * Atomically increment attempts and re-enqueue for retry via RPC.
 * Clears processed_at so the item re-enters the queue.
 */
async function incrementAttempts(
  supabase: SupabaseClient,
  id: string,
  errorMsg: string
): Promise<void> {
  const { error } = await (supabase as any).rpc("increment_ai_queue_attempts", {
    p_id: id,
    p_error: errorMsg.slice(0, 500),
  });
  if (error) {
    console.error("[embedding-worker] increment attempts RPC failed:", error);
  }
}

/**
 * Batch-fetch existing chunk hashes for multiple source IDs in one query.
 * Returns Map<source_id, Map<chunk_index, content_hash>>.
 */
async function batchFetchExistingHashes(
  supabase: SupabaseClient,
  orgId: string,
  sourceTable: string,
  sourceIds: string[]
): Promise<Map<string, Map<number, string>>> {
  const hashLookup = new Map<string, Map<number, string>>();
  if (sourceIds.length === 0) return hashLookup;

  const { data } = await (supabase as any)
    .from("ai_document_chunks")
    .select("source_id, chunk_index, content_hash")
    .eq("org_id", orgId)
    .eq("source_table", sourceTable)
    .in("source_id", sourceIds)
    .is("deleted_at", null);

  if (data) {
    for (const ec of data as { source_id: string; chunk_index: number; content_hash: string }[]) {
      if (!hashLookup.has(ec.source_id)) hashLookup.set(ec.source_id, new Map());
      hashLookup.get(ec.source_id)!.set(ec.chunk_index, ec.content_hash);
    }
  }

  return hashLookup;
}

// ---------------------------------------------------------------------------
// Core processor
// ---------------------------------------------------------------------------

/**
 * Process pending items from the embedding queue.
 * Uses FOR UPDATE SKIP LOCKED via RPC to prevent concurrent processing.
 * Fetches source records, renders chunks, generates embeddings in batch,
 * and atomically replaces chunks via RPC.
 */
export async function processEmbeddingQueue(
  serviceSupabase: SupabaseClient,
  options?: ProcessOptions
): Promise<QueueStats> {
  const batchSize = options?.batchSize ?? 50;
  const stats: QueueStats = { processed: 0, skipped: 0, failed: 0 };

  // 1. Dequeue pending items with row-level locking (FOR UPDATE SKIP LOCKED)
  const { data: queueItems, error: dequeueError } = await (
    serviceSupabase as any
  ).rpc("dequeue_ai_embeddings", { p_batch_size: batchSize });

  if (dequeueError || !queueItems || queueItems.length === 0) {
    if (dequeueError) {
      console.error("[embedding-worker] dequeue failed:", dequeueError);
    }
    return stats;
  }

  const items = queueItems as QueueItem[];

  // Group by source_table for batch fetching
  const byTable = new Map<string, QueueItem[]>();
  for (const item of items) {
    if (!isValidSourceTable(item.source_table)) {
      console.warn(
        `[embedding-worker] unknown source_table: ${item.source_table}`
      );
      stats.skipped++;
      // Already marked processed_at by dequeue RPC — leave as-is
      continue;
    }
    const list = byTable.get(item.source_table) ?? [];
    list.push(item);
    byTable.set(item.source_table, list);
  }

  // 2. Fetch all source records in bulk + parent threads for replies
  const sourceRecords = new Map<string, Map<string, Record<string, unknown>>>();
  let parentThreads = new Map<string, ParentThreadContext>();

  for (const [table, tableItems] of byTable) {
    const ids = tableItems.map((i) => i.source_id);
    const records = await fetchSourceRecords(
      serviceSupabase,
      table as SourceTable,
      ids
    );
    sourceRecords.set(table, records);

    // For replies, collect parent thread IDs
    if (table === "discussion_replies") {
      const threadIds = new Set<string>();
      for (const record of records.values()) {
        if (record.thread_id) threadIds.add(String(record.thread_id));
      }
      parentThreads = await fetchParentThreads(
        serviceSupabase,
        Array.from(threadIds)
      );
    }
  }

  // 3. Check exclusions (per-org) — fail-closed on error
  const orgIds = new Set(items.map((i) => i.org_id));
  const exclusionsByOrg = new Map<string, Set<string> | null>();
  for (const orgId of orgIds) {
    exclusionsByOrg.set(
      orgId,
      await fetchExclusions(serviceSupabase, orgId)
    );
  }

  // 4. Process items — separate deletes and upserts
  const deleteItems: QueueItem[] = [];
  const upsertItems: QueueItem[] = [];

  for (const item of items) {
    if (!isValidSourceTable(item.source_table)) continue;

    // Fail-closed: if exclusion fetch failed, skip all items for this org
    const exclusions = exclusionsByOrg.get(item.org_id);
    if (!exclusions) {
      stats.failed++;
      await incrementAttempts(serviceSupabase, item.id, "exclusion_fetch_failed");
      continue;
    }

    const exclusionKey = `${item.source_table}:${item.source_id}`;

    if (exclusions.has(exclusionKey)) {
      // Purge any existing chunks for excluded content
      await (serviceSupabase as any)
        .from("ai_document_chunks")
        .update({ deleted_at: new Date().toISOString() })
        .eq("org_id", item.org_id)
        .eq("source_table", item.source_table)
        .eq("source_id", item.source_id)
        .is("deleted_at", null);
      stats.skipped++;
      // Already marked processed_at by dequeue RPC
      continue;
    }

    const record = sourceRecords.get(item.source_table)?.get(item.source_id);

    if (item.action === "delete" || !record || record.deleted_at) {
      deleteItems.push(item);
    } else {
      upsertItems.push(item);
    }
  }

  // 5. Process deletes — soft-delete existing chunks
  if (deleteItems.length > 0) {
    for (const item of deleteItems) {
      const { error } = await (serviceSupabase as any)
        .from("ai_document_chunks")
        .update({ deleted_at: new Date().toISOString() })
        .eq("org_id", item.org_id)
        .eq("source_table", item.source_table)
        .eq("source_id", item.source_id)
        .is("deleted_at", null);

      if (error) {
        console.error("[embedding-worker] soft-delete chunks failed:", error);
        stats.failed++;
        await incrementAttempts(serviceSupabase, item.id, error.message);
      } else {
        stats.processed++;
        // Already marked processed_at by dequeue RPC
      }
    }
  }

  // 6. Process upserts — render, hash, embed, write
  if (upsertItems.length === 0) return stats;

  // Render chunks and check content hashes
  interface PendingChunk {
    item: QueueItem;
    text: string;
    chunkIndex: number;
    contentHash: string;
    metadata: Record<string, unknown>;
  }

  const pendingChunks: PendingChunk[] = [];

  // Batch-fetch existing hashes per (org, table) to avoid N+1 queries
  const hashLookupByKey = new Map<string, Map<string, Map<number, string>>>();
  for (const [table, tableItems] of byTable) {
    // Group items by org within table
    const byOrg = new Map<string, string[]>();
    for (const item of tableItems) {
      if (item.action === "delete") continue;
      const list = byOrg.get(item.org_id) ?? [];
      list.push(item.source_id);
      byOrg.set(item.org_id, list);
    }
    for (const [orgId, sourceIds] of byOrg) {
      const hashes = await batchFetchExistingHashes(
        serviceSupabase,
        orgId,
        table,
        sourceIds
      );
      hashLookupByKey.set(`${orgId}:${table}`, hashes);
    }
  }

  for (const item of upsertItems) {
    const record = sourceRecords.get(item.source_table)!.get(item.source_id)!;
    const parentContext =
      item.source_table === "discussion_replies" && record.thread_id
        ? parentThreads.get(String(record.thread_id))
        : undefined;

    const chunks = renderChunks(
      item.source_table as SourceTable,
      record,
      parentContext
    );

    if (chunks.length === 0) {
      // Content too short — clean up any existing chunks for this source
      await (serviceSupabase as any)
        .from("ai_document_chunks")
        .update({ deleted_at: new Date().toISOString() })
        .eq("org_id", item.org_id)
        .eq("source_table", item.source_table)
        .eq("source_id", item.source_id)
        .is("deleted_at", null);
      stats.skipped++;
      // Already marked processed_at by dequeue RPC
      continue;
    }

    // Use batch-fetched hashes instead of per-item query
    const lookupKey = `${item.org_id}:${item.source_table}`;
    const orgTableHashes = hashLookupByKey.get(lookupKey);
    const existingHashes = orgTableHashes?.get(item.source_id) ?? new Map<number, string>();

    // Check for orphaned chunks (old indexes not in new chunks)
    const newChunkIndexes = new Set(chunks.map((c) => c.chunkIndex));
    const hasOrphanedChunks = Array.from(existingHashes.keys()).some(
      (idx) => !newChunkIndexes.has(idx)
    );

    let allUnchanged = !hasOrphanedChunks;
    for (const chunk of chunks) {
      const hash = computeContentHash(chunk.text);
      if (existingHashes.get(chunk.chunkIndex) === hash) {
        continue; // Skip unchanged chunk
      }
      allUnchanged = false;
      pendingChunks.push({
        item,
        text: chunk.text,
        chunkIndex: chunk.chunkIndex,
        contentHash: hash,
        metadata: chunk.metadata,
      });
    }

    if (allUnchanged) {
      stats.skipped++;
      // Already marked processed_at by dequeue RPC
    }
  }

  if (pendingChunks.length === 0) return stats;

  // Batch-embed all new/changed texts in a single API call
  try {
    const texts = pendingChunks.map((c) => c.text);
    const embeddings = await generateEmbeddings(texts);

    // Group chunks by queue item for atomic per-item processing
    const chunksByItem = new Map<string, Array<{ chunk: PendingChunk; embedding: number[] }>>();
    for (let i = 0; i < pendingChunks.length; i++) {
      const chunk = pendingChunks[i];
      const list = chunksByItem.get(chunk.item.id) ?? [];
      list.push({ chunk, embedding: embeddings[i] });
      chunksByItem.set(chunk.item.id, list);
    }

    for (const [itemId, itemChunks] of chunksByItem) {
      const firstChunk = itemChunks[0].chunk;

      // Atomic chunk replacement via RPC (delete + insert in one transaction)
      const { error: replaceError } = await (serviceSupabase as any).rpc(
        "replace_ai_chunks",
        {
          p_org_id: firstChunk.item.org_id,
          p_source_table: firstChunk.item.source_table,
          p_source_id: firstChunk.item.source_id,
          p_chunks: itemChunks.map(({ chunk, embedding }) => ({
            chunk_index: chunk.chunkIndex,
            content_text: chunk.text,
            content_hash: chunk.contentHash,
            embedding: JSON.stringify(embedding),
            metadata: chunk.metadata,
          })),
        }
      );

      if (replaceError) {
        console.error("[embedding-worker] replace_ai_chunks RPC failed:", replaceError);
        stats.failed++;
        await incrementAttempts(serviceSupabase, itemId, "chunk_replace_failed");
      } else {
        stats.processed++;
        // Already marked processed_at by dequeue RPC
      }
    }
  } catch (err) {
    // Embedding API failure — increment attempts for all pending items
    const errorMsg =
      err instanceof Error ? err.message : "embedding_api_failed";
    console.error("[embedding-worker] batch embedding failed:", err);

    const failedIds = new Set(pendingChunks.map((c) => c.item.id));
    for (const id of failedIds) {
      await incrementAttempts(serviceSupabase, id, errorMsg);
      stats.failed++;
    }
  }

  return stats;
}
