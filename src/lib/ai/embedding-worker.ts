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

async function fetchExclusions(
  supabase: SupabaseClient,
  orgId: string
): Promise<Set<string>> {
  // Build a set of "source_table:source_id" keys for excluded items
  const { data, error } = await (supabase as any)
    .from("ai_indexing_exclusions")
    .select("source_table, source_id")
    .eq("org_id", orgId);

  if (error || !data) {
    // On error, assume nothing is excluded (fail-open for embedding)
    if (error) {
      console.error("[embedding-worker] fetch exclusions failed:", error);
    }
    return new Set();
  }

  const excluded = new Set<string>();
  for (const row of data as { source_table: string; source_id: string }[]) {
    excluded.add(`${row.source_table}:${row.source_id}`);
  }
  return excluded;
}

async function markProcessed(
  supabase: SupabaseClient,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await (supabase as any)
    .from("ai_embedding_queue")
    .update({ processed_at: new Date().toISOString() })
    .in("id", ids);

  if (error) {
    console.error("[embedding-worker] mark processed failed:", error);
  }
}

async function incrementAttempts(
  supabase: SupabaseClient,
  id: string,
  errorMsg: string
): Promise<void> {
  // Read current attempts, then increment (Supabase JS has no SQL template literals)
  const { data: row } = await (supabase as any)
    .from("ai_embedding_queue")
    .select("attempts")
    .eq("id", id)
    .single();

  if (row) {
    await (supabase as any)
      .from("ai_embedding_queue")
      .update({
        attempts: (row.attempts ?? 0) + 1,
        error: errorMsg.slice(0, 500),
      })
      .eq("id", id);
  }
}

// ---------------------------------------------------------------------------
// Core processor
// ---------------------------------------------------------------------------

/**
 * Process pending items from the embedding queue.
 * Fetches source records, renders chunks, generates embeddings in batch,
 * and upserts into ai_document_chunks.
 */
export async function processEmbeddingQueue(
  serviceSupabase: SupabaseClient,
  options?: ProcessOptions
): Promise<QueueStats> {
  const batchSize = options?.batchSize ?? 50;
  const stats: QueueStats = { processed: 0, skipped: 0, failed: 0 };

  // 1. Dequeue pending items
  const { data: queueItems, error: dequeueError } = await (
    serviceSupabase as any
  )
    .from("ai_embedding_queue")
    .select("id, org_id, source_table, source_id, action")
    .is("processed_at", null)
    .lt("attempts", 3)
    .order("created_at", { ascending: true })
    .limit(batchSize);

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
      await markProcessed(serviceSupabase, [item.id]);
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

  // 3. Check exclusions (per-org)
  const orgIds = new Set(items.map((i) => i.org_id));
  const exclusionsByOrg = new Map<string, Set<string>>();
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

    const exclusions = exclusionsByOrg.get(item.org_id) ?? new Set();
    const exclusionKey = `${item.source_table}:${item.source_id}`;

    if (exclusions.has(exclusionKey)) {
      stats.skipped++;
      await markProcessed(serviceSupabase, [item.id]);
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
        await markProcessed(serviceSupabase, [item.id]);
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
  const processedItemIds: string[] = [];
  const skippedItemIds: string[] = [];

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
      // Short reply — skipped by chunker
      stats.skipped++;
      skippedItemIds.push(item.id);
      continue;
    }

    // Check existing hashes to skip unchanged content
    const { data: existingChunks } = await (serviceSupabase as any)
      .from("ai_document_chunks")
      .select("chunk_index, content_hash")
      .eq("org_id", item.org_id)
      .eq("source_table", item.source_table)
      .eq("source_id", item.source_id)
      .is("deleted_at", null);

    const existingHashes = new Map<number, string>();
    if (existingChunks) {
      for (const ec of existingChunks) {
        existingHashes.set(ec.chunk_index, ec.content_hash);
      }
    }

    let allUnchanged = true;
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
      skippedItemIds.push(item.id);
    }
  }

  // Mark skipped items as processed
  if (skippedItemIds.length > 0) {
    await markProcessed(serviceSupabase, skippedItemIds);
  }

  if (pendingChunks.length === 0) return stats;

  // Batch-embed all new/changed texts in a single API call
  try {
    const texts = pendingChunks.map((c) => c.text);
    const embeddings = await generateEmbeddings(texts);

    // Upsert chunks into ai_document_chunks
    const now = new Date().toISOString();
    for (let i = 0; i < pendingChunks.length; i++) {
      const chunk = pendingChunks[i];
      const embedding = embeddings[i];

      // Soft-delete any existing chunk for this source+index, then insert fresh
      await (serviceSupabase as any)
        .from("ai_document_chunks")
        .update({ deleted_at: now })
        .eq("org_id", chunk.item.org_id)
        .eq("source_table", chunk.item.source_table)
        .eq("source_id", chunk.item.source_id)
        .eq("chunk_index", chunk.chunkIndex)
        .is("deleted_at", null);

      const { error: upsertError } = await (serviceSupabase as any)
        .from("ai_document_chunks")
        .insert({
          org_id: chunk.item.org_id,
          source_table: chunk.item.source_table,
          source_id: chunk.item.source_id,
          chunk_index: chunk.chunkIndex,
          content_text: chunk.text,
          content_hash: chunk.contentHash,
          embedding: JSON.stringify(embedding),
          metadata: chunk.metadata,
        });

      if (upsertError) {
        console.error("[embedding-worker] upsert chunk failed:", upsertError);
        stats.failed++;
        await incrementAttempts(
          serviceSupabase,
          chunk.item.id,
          upsertError.message
        );
      } else {
        // Track which queue items had successful chunks
        if (!processedItemIds.includes(chunk.item.id)) {
          processedItemIds.push(chunk.item.id);
          stats.processed++;
        }
      }
    }

    // Mark successfully processed queue items
    await markProcessed(serviceSupabase, processedItemIds);
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
