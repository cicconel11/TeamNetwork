/**
 * Type-only definitions for the chat route. Lives outside handler.ts so
 * extracted stage modules can import without creating an import cycle.
 */
import type { createClient } from "@/lib/supabase/server";
import type { getAiOrgContext } from "@/lib/ai/context";
import type { buildPromptContext } from "@/lib/ai/context-builder";
import type { createZaiClient, getZaiModel } from "@/lib/ai/client";
import type { composeResponse } from "@/lib/ai/response-composer";
import type { logAiRequest } from "@/lib/ai/audit";
import type { resolveOwnThread } from "@/lib/ai/thread-resolver";
import type { retrieveRelevantChunks } from "@/lib/ai/rag-retriever";
import type { executeToolCall } from "@/lib/ai/tools/executor";
import type { buildTurnExecutionPolicy } from "@/lib/ai/turn-execution-policy";
import type { verifyToolBackedResponse } from "@/lib/ai/grounding/tool/verifier";
import type { classifySafety } from "@/lib/ai/safety-gate";
import type { verifyRagGrounding } from "@/lib/ai/grounding/rag";
import type { trackOpsEventServer } from "@/lib/analytics/events-server";
import type {
  getDraftSession,
  saveDraftSession,
  clearDraftSession,
} from "@/lib/ai/draft-sessions";
import type { loadRouteEntityContext } from "@/lib/ai/route-entity-loaders";

export interface ChatRouteDeps {
  createClient?: typeof createClient;
  getAiOrgContext?: typeof getAiOrgContext;
  buildPromptContext?: typeof buildPromptContext;
  createZaiClient?: typeof createZaiClient;
  getZaiModel?: typeof getZaiModel;
  composeResponse?: typeof composeResponse;
  logAiRequest?: typeof logAiRequest;
  resolveOwnThread?: typeof resolveOwnThread;
  retrieveRelevantChunks?: typeof retrieveRelevantChunks;
  executeToolCall?: typeof executeToolCall;
  buildTurnExecutionPolicy?: typeof buildTurnExecutionPolicy;
  verifyToolBackedResponse?: typeof verifyToolBackedResponse;
  classifySafety?: typeof classifySafety;
  verifyRagGrounding?: typeof verifyRagGrounding;
  trackOpsEventServer?: typeof trackOpsEventServer;
  getDraftSession?: typeof getDraftSession;
  saveDraftSession?: typeof saveDraftSession;
  clearDraftSession?: typeof clearDraftSession;
  loadRouteEntityContext?: typeof loadRouteEntityContext;
}
