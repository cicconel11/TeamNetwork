/**
 * Stage wrapper that decides whether to call `retrieveRag` or skip it.
 *
 * Owns the eligibility check (`hasEmbeddingKey && !skipRagRetrieval`) and the
 * `not_available` retrieval-decision write that the orchestrator previously
 * inlined. Returns the four downstream-facing fields exactly.
 */
import type { retrieveRelevantChunks } from "@/lib/ai/rag-retriever";
import type { RagChunkInput } from "@/lib/ai/context-builder";
import type { AiAuditStageTimings } from "@/lib/ai/chat-telemetry";
import type { AiLogContext } from "@/lib/ai/logger";
import type { AiOrgContext } from "@/lib/ai/context";
import type { TurnExecutionPolicy } from "@/lib/ai/turn-execution-policy";
import { retrieveRag, skipRagStage } from "../cache-rag";

export interface RunRagRetrievalInput {
  ctx: Extract<AiOrgContext, { ok: true }>;
  threadId: string;
  promptSafeMessage: string;
  skipRagRetrieval: boolean;
  hasEmbeddingKey: boolean;
  executionPolicy: TurnExecutionPolicy;
  stageTimings: AiAuditStageTimings;
  requestLogContext: AiLogContext;
  retrieveRelevantChunksFn: typeof retrieveRelevantChunks;
}

export interface RagRetrievalSlice {
  ragChunks: RagChunkInput[];
  ragChunkCount: number;
  ragTopSimilarity: number | undefined;
  ragError: string | undefined;
}

export async function runRagRetrievalStage(
  input: RunRagRetrievalInput,
): Promise<RagRetrievalSlice> {
  if (input.hasEmbeddingKey && !input.skipRagRetrieval) {
    const ragResult = await retrieveRag({
      retrieveRelevantChunksFn: input.retrieveRelevantChunksFn,
      query: input.promptSafeMessage,
      orgId: input.ctx.orgId,
      serviceSupabase: input.ctx.serviceSupabase,
      stageTimings: input.stageTimings,
      logContext: { ...input.requestLogContext, threadId: input.threadId },
    });
    return {
      ragChunks: ragResult.chunks,
      ragChunkCount: ragResult.chunkCount,
      ragTopSimilarity: ragResult.topSimilarity,
      ragError: ragResult.error,
    };
  }

  if (!input.hasEmbeddingKey && input.executionPolicy.retrieval.mode === "allow") {
    input.stageTimings.retrieval = {
      decision: "not_available",
      reason: "embedding_key_missing",
    };
  }
  skipRagStage(input.stageTimings);

  return {
    ragChunks: [],
    ragChunkCount: 0,
    ragTopSimilarity: undefined,
    ragError: undefined,
  };
}
