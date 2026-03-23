import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChunkInput {
  text: string;
  chunkIndex: number;
  metadata: Record<string, unknown>;
}

export type SourceTable =
  | "announcements"
  | "discussion_threads"
  | "discussion_replies"
  | "events"
  | "job_postings";

/** Parent thread context passed for discussion_replies rendering. */
export interface ParentThreadContext {
  title: string;
  body: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CHUNK_CHARS = 2048;
const REPLY_MIN_LENGTH = 500;
const PARENT_BODY_PREFIX_LENGTH = 200;

// ---------------------------------------------------------------------------
// Hash
// ---------------------------------------------------------------------------

export function computeContentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Renderers per source table
// ---------------------------------------------------------------------------

function renderAnnouncement(record: Record<string, unknown>): ChunkInput[] {
  const title = String(record.title ?? "");
  const body = String(record.body ?? "");
  const audience = record.audience ? String(record.audience) : null;
  const publishedAt = record.published_at ? String(record.published_at) : null;

  const lines = [`Announcement: ${title}`];
  if (body) lines.push(body);
  if (audience) lines.push(`Audience: ${audience}`);
  if (publishedAt) lines.push(`Published: ${publishedAt}`);

  const text = lines.join("\n");
  return splitIfNeeded(text, { title, audience });
}

function renderEvent(record: Record<string, unknown>): ChunkInput[] {
  const title = String(record.title ?? "");
  const description = record.description ? String(record.description) : null;
  const startDate = record.start_date ? String(record.start_date) : null;
  const endDate = record.end_date ? String(record.end_date) : null;
  const location = record.location ? String(record.location) : null;
  const audience = record.audience ? String(record.audience) : null;

  const lines = [`Event: ${title}`];
  if (description) lines.push(description);
  if (startDate) {
    const dateStr = endDate ? `${startDate} to ${endDate}` : startDate;
    lines.push(`Date: ${dateStr}`);
  }
  if (location) lines.push(`Location: ${location}`);
  if (audience) lines.push(`Audience: ${audience}`);

  const text = lines.join("\n");
  return splitIfNeeded(text, { title, audience });
}

function renderDiscussionThread(
  record: Record<string, unknown>
): ChunkInput[] {
  const title = String(record.title ?? "");
  const body = String(record.body ?? "");

  const text = `Discussion: ${title}\n${body}`;
  return splitIfNeeded(text, { title });
}

function renderDiscussionReply(
  record: Record<string, unknown>,
  parentContext?: ParentThreadContext
): ChunkInput[] {
  const body = String(record.body ?? "");
  const threadId = record.thread_id ? String(record.thread_id) : null;

  // Short replies are skipped — parent thread chunk captures the topic
  if (body.length <= REPLY_MIN_LENGTH) {
    return [];
  }

  // Inject parent context so the reply is self-contained
  const lines: string[] = [];
  if (parentContext) {
    const parentBodyPrefix = parentContext.body.slice(
      0,
      PARENT_BODY_PREFIX_LENGTH
    );
    lines.push(`Discussion: ${parentContext.title}`);
    lines.push(`${parentBodyPrefix}...`);
    lines.push("---");
  }
  lines.push(`Reply: ${body}`);

  const text = lines.join("\n");
  const metadata: Record<string, unknown> = {};
  if (threadId) metadata.parent_thread_id = threadId;

  return splitIfNeeded(text, metadata);
}

function renderJobPosting(record: Record<string, unknown>): ChunkInput[] {
  const title = String(record.title ?? "");
  const company = record.company ? String(record.company) : null;
  const description = String(record.description ?? "");
  const location = record.location ? String(record.location) : null;
  const locationType = record.location_type
    ? String(record.location_type)
    : null;

  const lines = [`Job: ${title}`];
  if (company) lines.push(`Company: ${company}`);
  if (description) lines.push(description);
  if (location || locationType) {
    const parts = [location, locationType].filter(Boolean);
    lines.push(`Location: ${parts.join(" — ")}`);
  }

  const text = lines.join("\n");
  return splitIfNeeded(text, { title, company });
}

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------

/**
 * Break a single oversized paragraph into pieces at sentence boundaries
 * or at the hard character limit if no sentence boundary is found.
 */
function breakOversizedParagraph(para: string): string[] {
  if (para.length <= MAX_CHUNK_CHARS) return [para];

  const pieces: string[] = [];
  let remaining = para;

  while (remaining.length > MAX_CHUNK_CHARS) {
    // Try to break at a sentence boundary (". ") within the limit
    const searchWindow = remaining.slice(0, MAX_CHUNK_CHARS);
    const lastSentence = searchWindow.lastIndexOf(". ");

    let breakPoint: number;
    if (lastSentence > MAX_CHUNK_CHARS / 2) {
      breakPoint = lastSentence + 2; // Include the ". "
    } else {
      // No good sentence boundary — hard break at limit
      breakPoint = MAX_CHUNK_CHARS;
    }

    pieces.push(remaining.slice(0, breakPoint).trimEnd());
    remaining = remaining.slice(breakPoint).trimStart();
  }

  if (remaining.length > 0) {
    pieces.push(remaining);
  }

  return pieces;
}

/**
 * Split text into chunks of MAX_CHUNK_CHARS on paragraph boundaries.
 * Oversized paragraphs are further split on sentence boundaries.
 * Returns ChunkInput[] with sequential chunk indexes.
 */
function splitIfNeeded(
  text: string,
  baseMetadata: Record<string, unknown>
): ChunkInput[] {
  if (text.length <= MAX_CHUNK_CHARS) {
    return [{ text, chunkIndex: 0, metadata: baseMetadata }];
  }

  // Split into paragraphs, then break oversized ones
  const rawParagraphs = text.split(/\n\n+/);
  const paragraphs: string[] = [];
  for (const para of rawParagraphs) {
    paragraphs.push(...breakOversizedParagraph(para));
  }

  const chunks: ChunkInput[] = [];
  let current = "";
  let chunkIndex = 0;

  for (const para of paragraphs) {
    // If adding this paragraph would exceed the limit, flush
    if (current.length > 0 && current.length + para.length + 2 > MAX_CHUNK_CHARS) {
      chunks.push({ text: current, chunkIndex, metadata: baseMetadata });
      chunkIndex++;
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }

  // Flush remaining
  if (current.length > 0) {
    chunks.push({ text: current, chunkIndex, metadata: baseMetadata });
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render content from a source table record into embeddable text chunks.
 *
 * @param sourceTable - The table the record comes from.
 * @param record - The raw DB row.
 * @param parentContext - For discussion_replies, the parent thread's title and body.
 */
export function renderChunks(
  sourceTable: SourceTable,
  record: Record<string, unknown>,
  parentContext?: ParentThreadContext
): ChunkInput[] {
  switch (sourceTable) {
    case "announcements":
      return renderAnnouncement(record);
    case "events":
      return renderEvent(record);
    case "discussion_threads":
      return renderDiscussionThread(record);
    case "discussion_replies":
      return renderDiscussionReply(record, parentContext);
    case "job_postings":
      return renderJobPosting(record);
    default: {
      const _exhaustive: never = sourceTable;
      throw new Error(`Unknown source table: ${_exhaustive}`);
    }
  }
}
