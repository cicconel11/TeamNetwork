/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Default ChatRouteDeps for the eval harness. Mirrors the `buildDefaultDeps`
 * helper in `tests/routes/ai/chat-handler-tools.test.ts`, but reshaped so
 * that:
 *   - the LLM (`composeResponse`) is driven by a per-case stub script
 *   - every tool call invocation is captured for scorers
 *   - the audit row written by `logAiRequest` is captured
 *   - auth context can be overridden per case (admin / non-admin / refusal)
 *   - the three production guardrails (safety / RAG / tool) can be forced
 *     to specific outcomes per case to test downstream propagation
 *
 * No real LLM, no real Supabase, no real network. Cases that need real LLM
 * runs (Phase 2+) will swap `composeResponse` for the real one.
 */
import { NextResponse } from "next/server";
import type { ChatRouteDeps } from "../../../src/app/api/ai/[orgId]/chat/handler-types.ts";
import { AI_CONTEXT_ERRORS } from "@/lib/ai/context";
import type { EvalCaseInput } from "../types.ts";
import { ADMIN_USER, ORG_ID, createSupabaseStub, type SupabaseStub } from "./supabase-stub.ts";

export interface CapturedToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface DepsCapture {
  toolCalls: CapturedToolCall[];
  /** Last audit row written by the handler. */
  auditEntry: Record<string, unknown> | null;
  supabase: SupabaseStub;
}

function buildThreadId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

/**
 * Build deps + a capture object. Pass the case's `input` to drive the
 * pass-1/pass-2 LLM stub script, the executor's tool result, the auth
 * context, and any forced guardrail outcomes.
 */
export function buildHarnessDeps(input: EvalCaseInput): {
  deps: ChatRouteDeps;
  capture: DepsCapture;
} {
  const supabase = createSupabaseStub();
  const capture: DepsCapture = {
    toolCalls: [],
    auditEntry: null,
    supabase,
  };

  const stub = input.llmStub ?? {};
  const stubToolName = stub.pass1ToolName;
  const stubArgsJson = stub.pass1ArgsJson ?? "{}";
  const finalText = stub.finalText ?? "I cannot help with that.";

  const auth = input.authContext ?? { ok: true as const, role: "admin" as const };
  const guardrails = input.guardrails ?? {};

  const deps: ChatRouteDeps = {
    createClient: (async () => supabase) as any,
    getAiOrgContext: (async (_orgId: string, _user: any, rateLimit: any) => {
      if (!auth.ok) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: errorBodyForReason(auth.reason) },
            { status: auth.status, headers: rateLimit?.headers ?? {} }
          ),
        } as any;
      }
      return {
        ok: true,
        orgId: auth.orgId ?? ORG_ID,
        userId: auth.userId ?? ADMIN_USER.id,
        role: auth.role,
        supabase: supabase as any,
        serviceSupabase: {
          from: supabase.from,
          rpc: async (_fn: string, params: any) => ({
            data: {
              thread_id: params?.p_thread_id ?? buildThreadId(++supabase.state.threadCount),
              user_msg_id: "user-1",
            },
            error: null,
          }),
        } as any,
      };
    }) as any,
    buildPromptContext: (async (ctx: any) => ({
      systemPrompt: "System prompt",
      orgContextMessage: null,
      metadata: { surface: ctx.surface, estimatedTokens: 100 },
    })) as any,
    createZaiClient: (() => ({ client: "fake-eval" })) as any,
    getZaiModel: (() => "glm-5.1") as any,
    composeResponse: (async function* (options: any) {
      const isPass1 = options.tools && !options.toolResults;
      if (isPass1 && stubToolName) {
        yield { type: "tool_call_requested", id: "call-eval-1", name: stubToolName, argsJson: stubArgsJson };
        return;
      }
      options.onUsage?.({ inputTokens: 10, outputTokens: 5 });
      yield { type: "chunk", content: finalText };
    }) as any,
    logAiRequest: (async (_sb: unknown, entry: unknown) => {
      capture.auditEntry = entry as Record<string, unknown>;
    }) as any,
    retrieveRelevantChunks: (async () => []) as any,
    resolveOwnThread: (async (threadId: string) => ({
      ok: true,
      thread: { id: threadId, user_id: ADMIN_USER.id, org_id: ORG_ID, surface: "general", title: "T" },
    })) as any,
    executeToolCall: (async (_ctx: any, call: any) => {
      capture.toolCalls.push({ name: call.name, args: call.args });
      return input.toolResult ?? { kind: "ok", data: [] };
    }) as any,
    verifyToolBackedResponse: (() => {
      if (guardrails.tool) {
        return { grounded: guardrails.tool.grounded, failures: guardrails.tool.failures ?? [] };
      }
      return { grounded: true, failures: [] };
    }) as any,
    classifySafety: (async () => {
      if (guardrails.safety) {
        return {
          verdict: guardrails.safety.verdict,
          categories: guardrails.safety.categories ?? [],
          latencyMs: 0,
          usedJudge: false,
        };
      }
      return { verdict: "safe", categories: [], latencyMs: 0, usedJudge: false };
    }) as any,
    verifyRagGrounding: (async () => {
      if (guardrails.rag) {
        return {
          grounded: guardrails.rag.grounded,
          uncoveredClaims: guardrails.rag.uncoveredClaims ?? [],
          topChunkExcerpt: null,
          latencyMs: 0,
          usedJudge: false,
        };
      }
      return { grounded: true, uncoveredClaims: [], topChunkExcerpt: null, latencyMs: 0, usedJudge: false };
    }) as any,
  };

  return { deps, capture };
}

function errorBodyForReason(reason: string): string {
  switch (reason) {
    case "revoked":
    case "not_member":
    case "wrong_org":
      return AI_CONTEXT_ERRORS.noMembership;
    case "auth_error":
      return AI_CONTEXT_ERRORS.serviceUnavailable;
    default:
      return AI_CONTEXT_ERRORS.roleNotAllowed;
  }
}
