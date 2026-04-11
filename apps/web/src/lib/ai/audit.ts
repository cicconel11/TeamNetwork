import type { SupabaseClient } from "@supabase/supabase-js";
import type { CacheStatus } from "./sse";
import type { CacheSurface } from "./semantic-cache-utils";

interface AuditEntry {
  threadId: string | null;
  messageId: string | null;
  userId: string;
  orgId: string;
  intent?: string;
  intentType?: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  latencyMs?: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
  cacheStatus?: CacheStatus;
  cacheEntryId?: string; // UUID of the cache entry that was hit
  cacheBypassReason?: string; // why cache was bypassed (eligibility reason)
  contextSurface?: CacheSurface; // which surface was used for context selection
  contextTokenEstimate?: number; // estimated token count of the context message
  ragChunkCount?: number; // number of RAG chunks injected into context
  ragTopSimilarity?: number; // highest cosine similarity score
  ragError?: string; // error message if RAG retrieval failed
}

interface AuditInsertClient {
  from(table: "ai_audit_log"): {
    insert(row: Record<string, unknown>): Promise<{ error: unknown }> | { error: unknown };
  };
}

function redactSensitive(value: string): string {
  return value
    .replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED]")                // OpenAI API keys
    .replace(/key_[a-zA-Z0-9_-]+/g, "[REDACTED]")              // Generic key_ prefixed
    .replace(/AIza[a-zA-Z0-9_-]{30,}/g, "[REDACTED]")          // Google/Gemini API keys
    .replace(/sbp_[a-zA-Z0-9]{20,}/g, "[REDACTED]")            // Supabase keys
    .replace(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, "[REDACTED]") // JWTs
    .replace(/Bearer [a-zA-Z0-9._-]+/g, "Bearer [REDACTED]");  // Auth headers
}

export async function logAiRequest(
  serviceSupabase: SupabaseClient,
  entry: AuditEntry
): Promise<void> {
  try {
    const toolCallsJson = entry.toolCalls
      ? JSON.parse(redactSensitive(JSON.stringify(entry.toolCalls)))
      : null;

    const row = {
      thread_id: entry.threadId,
      message_id: entry.messageId,
      user_id: entry.userId,
      org_id: entry.orgId,
      intent: entry.intent ?? null,
      intent_type: entry.intentType ?? null,
      tool_calls: toolCallsJson,
      latency_ms: entry.latencyMs ?? null,
      model: entry.model ?? null,
      input_tokens: entry.inputTokens ?? null,
      output_tokens: entry.outputTokens ?? null,
      error: entry.error ? entry.error.slice(0, 1000) : null,
      cache_status: entry.cacheStatus ?? null,
      cache_entry_id: entry.cacheEntryId ?? null,
      cache_bypass_reason: entry.cacheBypassReason ?? null,
      context_surface: entry.contextSurface ?? null,
      context_token_estimate: entry.contextTokenEstimate ?? null,
      rag_chunk_count: entry.ragChunkCount ?? null,
      rag_top_similarity: entry.ragTopSimilarity ?? null,
      rag_error: entry.ragError ? entry.ragError.slice(0, 500) : null,
    };

    const { error } = await (serviceSupabase as unknown as AuditInsertClient)
      .from("ai_audit_log")
      .insert(row);

    if (error) {
      console.error("[ai-audit] insert failed:", error);
    }
  } catch (err) {
    console.error("[ai-audit] unexpected error:", err);
  }
}
