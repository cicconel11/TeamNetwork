export const MEDIA_BULK_DELETE_BATCH_SIZE = 100;

interface BulkDeleteChunkResponse {
  deletedIds?: string[];
}

interface BulkDeleteRequest {
  orgId: string;
  mediaIds: string[];
  batchSize?: number;
  fetchImpl?: typeof fetch;
}

interface BulkDeleteResult {
  deletedIds: string[];
  deletedCount: number;
}

export class BulkDeletePartialError extends Error {
  deletedIds: string[];
  failedIds: string[];

  constructor(message: string, deletedIds: string[], failedIds: string[]) {
    super(message);
    this.name = "BulkDeletePartialError";
    this.deletedIds = deletedIds;
    this.failedIds = failedIds;
  }
}

export function chunkBulkDeleteMediaIds(
  mediaIds: string[],
  batchSize = MEDIA_BULK_DELETE_BATCH_SIZE,
): string[][] {
  const uniqueIds = Array.from(new Set(mediaIds));
  if (uniqueIds.length === 0) return [];

  const chunks: string[][] = [];
  for (let index = 0; index < uniqueIds.length; index += batchSize) {
    chunks.push(uniqueIds.slice(index, index + batchSize));
  }
  return chunks;
}

async function parseBulkDeleteError(response: Response): Promise<string> {
  const data = await response.json().catch(() => null) as { error?: string } | null;
  return data?.error || "Failed to delete";
}

export async function bulkDeleteSelectedMedia({
  orgId,
  mediaIds,
  batchSize = MEDIA_BULK_DELETE_BATCH_SIZE,
  fetchImpl = fetch,
}: BulkDeleteRequest): Promise<BulkDeleteResult> {
  const chunks = chunkBulkDeleteMediaIds(mediaIds, batchSize);
  if (chunks.length === 0) {
    return { deletedIds: [], deletedCount: 0 };
  }

  const deletedIds: string[] = [];

  for (const [chunkIndex, chunk] of chunks.entries()) {
    const response = await fetchImpl("/api/media/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, mediaIds: chunk }),
    });

    if (!response.ok) {
      const message = await parseBulkDeleteError(response);
      if (deletedIds.length > 0) {
        throw new BulkDeletePartialError(
          message,
          deletedIds,
          chunks.slice(chunkIndex).flat(),
        );
      }
      throw new Error(message);
    }

    const data = await response.json().catch(() => null) as BulkDeleteChunkResponse | null;
    deletedIds.push(...(data?.deletedIds ?? []));
  }

  return {
    deletedIds,
    deletedCount: deletedIds.length,
  };
}

export function getBulkDeleteSuccessMessage(deletedCount: number): string {
  return `Deleted ${deletedCount} item${deletedCount === 1 ? "" : "s"}`;
}

export function getBulkDeletePartialFailureMessage(deletedCount: number, failedCount: number): string {
  return `Deleted ${deletedCount} item${deletedCount === 1 ? "" : "s"}; ${failedCount} failed`;
}
