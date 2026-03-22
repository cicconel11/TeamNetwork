import type { SupabaseClient } from "@supabase/supabase-js";
import type { CacheStatus } from "./sse";

interface AuditEntry {
  threadId: string | null;
  messageId: string | null;
  userId: string;
  orgId: string;
  intent?: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  latencyMs?: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
  cacheStatus?: CacheStatus;
  cacheEntryId?: string; // UUID of the cache entry that was hit
  cacheBypassReason?: string; // why cache was bypassed (eligibility reason)
}

interface AuditInsertClient {
  from(table: "ai_audit_log"): {
    insert(row: Record<string, unknown>): Promise<{ error: unknown }> | { error: unknown };
  };
}

function redactSensitive(value: string): string {
  return value
    .replace(/sk-[a-zA-Z0-9]+/g, "[REDACTED]")
    .replace(/key_[a-zA-Z0-9]+/g, "[REDACTED]")
    .replace(/Bearer [a-zA-Z0-9._-]+/g, "Bearer [REDACTED]");
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
      tool_calls: toolCallsJson,
      latency_ms: entry.latencyMs ?? null,
      model: entry.model ?? null,
      input_tokens: entry.inputTokens ?? null,
      output_tokens: entry.outputTokens ?? null,
      error: entry.error ? entry.error.slice(0, 1000) : null,
      cache_status: entry.cacheStatus ?? null,
      cache_entry_id: entry.cacheEntryId ?? null,
      cache_bypass_reason: entry.cacheBypassReason ?? null,
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
