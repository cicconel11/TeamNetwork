// Per-stage LLM wrapper. Centralizes model choice, temperature, timeout,
// retry, and (optional) fallback model across all chat/safety/judge/extract
// call sites. Single source of truth for cost-bearing LLM behavior.
//
// Profiles are env-driven (resolved per-call) so config can flex per
// environment without redeploy. Retry policy is conservative: one retry on
// transient errors (429 / 5xx / timeout) with optional fallback model.

import type OpenAI from "openai";
import { createZaiClient, getZaiModel } from "@/lib/ai/client";

export type LlmTrackOpsEventFn = (
  event: "api_error",
  props: {
    endpoint_group: string;
    error_code: string;
    http_status?: number;
    retryable?: boolean;
  },
  orgId?: string | null,
) => void | Promise<void>;

export interface LlmProfile {
  name: string;
  model: string;
  fallbackModel?: string;
  temperature: number;
  maxTokens?: number;
  responseFormat?: { type: "json_object" } | { type: "text" };
  timeoutMs: number;
  maxRetries: number;
}

export interface LlmRunOptions {
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.ChatCompletionTool[];
  toolChoice?: OpenAI.Chat.ChatCompletionToolChoiceOption;
  signal?: AbortSignal;
  overrides?: Partial<Pick<LlmProfile, "temperature" | "maxTokens" | "model">>;
  client?: OpenAI;
  trackOpsEvent?: LlmTrackOpsEventFn;
  orgId?: string;
}

export interface LlmRunResult {
  completion: OpenAI.Chat.ChatCompletion;
  actualModel: string;
  attempts: number;
}

// ---------------------------------------------------------------------------
// Profile factory
// ---------------------------------------------------------------------------

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function defaultModel(): string {
  return getZaiModel();
}

function defaultFallback(): string | undefined {
  return process.env.ZAI_MODEL_FALLBACK || undefined;
}

function defaultTimeout(fallbackMs: number): number {
  return envInt("ZAI_TIMEOUT_MS", fallbackMs);
}

function defaultMaxRetries(fallback: number): number {
  return envInt("ZAI_MAX_RETRIES", fallback);
}

export const Profiles = {
  pass1Tools(): LlmProfile {
    return {
      name: "pass1_tools",
      model: process.env.ZAI_MODEL_PASS1 || defaultModel(),
      fallbackModel: defaultFallback(),
      temperature: envNumber("AI_PASS1_TEMPERATURE", 0),
      maxTokens: envInt("AI_PASS1_MAX_TOKENS", 2000),
      timeoutMs: defaultTimeout(25_000),
      maxRetries: defaultMaxRetries(1),
    };
  },
  pass2Compose(): LlmProfile {
    return {
      name: "pass2_compose",
      model: defaultModel(),
      fallbackModel: defaultFallback(),
      temperature: envNumber("AI_PASS2_TEMPERATURE", 0.7),
      // glm reasoning tokens count toward max_tokens; 2000 truncated real
      // multi-tool answers mid-word (visible text is a fraction of the spend).
      maxTokens: envInt("AI_PASS2_MAX_TOKENS", 4000),
      timeoutMs: defaultTimeout(30_000),
      maxRetries: defaultMaxRetries(0),
    };
  },
  safetyJudge(): LlmProfile {
    return {
      name: "safety_judge",
      model: process.env.SAFETY_JUDGE_MODEL || defaultModel(),
      temperature: 0,
      timeoutMs: 8_000,
      maxRetries: 1,
    };
  },
  ragJudge(): LlmProfile {
    return {
      name: "rag_judge",
      model: process.env.RAG_GROUNDING_JUDGE_MODEL || defaultModel(),
      temperature: 0,
      timeoutMs: 8_000,
      maxRetries: 1,
    };
  },
  scheduleExtract(): LlmProfile {
    return {
      name: "schedule_extract",
      model: defaultModel(),
      temperature: 0.2,
      maxTokens: 2500,
      timeoutMs: 30_000,
      maxRetries: 1,
    };
  },
  scheduleExtractImage(imageModel: string): LlmProfile {
    return {
      name: "schedule_extract_image",
      model: imageModel,
      temperature: 0.2,
      maxTokens: 2500,
      timeoutMs: 30_000,
      maxRetries: 1,
    };
  },
  bioGen(): LlmProfile {
    return {
      name: "bio_gen",
      model: defaultModel(),
      temperature: 0.2,
      maxTokens: 150,
      timeoutMs: 8_000,
      maxRetries: 1,
    };
  },
  signalBackfill(): LlmProfile {
    return {
      name: "signal_backfill",
      model: process.env.ZAI_MODEL_SIGNAL_BACKFILL || defaultModel(),
      temperature: 0,
      maxTokens: 300,
      responseFormat: { type: "json_object" },
      timeoutMs: 8_000,
      maxRetries: 1,
    };
  },
  whyGen(): LlmProfile {
    return {
      name: "why_gen",
      model: process.env.ZAI_MODEL_WHY_GEN || defaultModel(),
      temperature: 0.3,
      maxTokens: 400,
      responseFormat: { type: "json_object" },
      timeoutMs: 8_000,
      maxRetries: 1,
    };
  },
} as const;

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

interface ClassifiedError {
  retryable: boolean;
  errorCode: string;
  httpStatus?: number;
  retryAfterMs?: number;
}

function classifyError(err: unknown): ClassifiedError {
  if (err && typeof err === "object") {
    const obj = err as { status?: number; name?: string; code?: string; headers?: { get?: (n: string) => string | null } };
    const status = typeof obj.status === "number" ? obj.status : undefined;
    if (status === 429) {
      let retryAfterMs: number | undefined;
      try {
        const raw = obj.headers?.get?.("retry-after");
        const seconds = raw ? Number.parseFloat(raw) : NaN;
        if (Number.isFinite(seconds) && seconds > 0) retryAfterMs = seconds * 1000;
      } catch {
        // ignore
      }
      return { retryable: true, errorCode: "429", httpStatus: 429, retryAfterMs };
    }
    if (typeof status === "number" && status >= 500 && status < 600) {
      return { retryable: true, errorCode: String(status), httpStatus: status };
    }
    if (obj.name === "AbortError" || obj.code === "ABORT_ERR") {
      return { retryable: true, errorCode: "timeout" };
    }
    if (obj.code === "ECONNRESET" || obj.code === "ETIMEDOUT" || obj.code === "ENETDOWN") {
      return { retryable: true, errorCode: `net_${obj.code.toLowerCase()}` };
    }
  }
  return { retryable: false, errorCode: "non_retryable" };
}

function emit(
  fn: LlmTrackOpsEventFn | undefined,
  endpoint: string,
  errorCode: string,
  httpStatus: number | undefined,
  orgId: string | undefined,
): void {
  if (!fn) return;
  try {
    void Promise.resolve(
      fn(
        "api_error",
        {
          endpoint_group: endpoint,
          error_code: errorCode,
          http_status: httpStatus,
          retryable: errorCode.startsWith("llm_retry_"),
        },
        orgId ?? null,
      ),
    ).catch(() => {});
  } catch {
    // swallow
  }
}

// ---------------------------------------------------------------------------
// runLlmCompletion
// ---------------------------------------------------------------------------

export async function runLlmCompletion(
  profile: LlmProfile,
  opts: LlmRunOptions,
): Promise<LlmRunResult> {
  const client = opts.client ?? createZaiClient();
  const temperature = opts.overrides?.temperature ?? profile.temperature;
  const maxTokens = opts.overrides?.maxTokens ?? profile.maxTokens;
  const baseModel = opts.overrides?.model ?? profile.model;
  const endpoint = `ai_llm_${profile.name}`;

  let attempts = 0;
  let lastErr: unknown = null;
  const totalAttempts = profile.maxRetries + 1;

  for (let i = 0; i < totalAttempts; i++) {
    attempts += 1;
    if (opts.signal?.aborted) {
      throw opts.signal.reason ?? new Error("aborted");
    }
    const useFallback = i > 0 && !!profile.fallbackModel;
    const model = useFallback ? (profile.fallbackModel as string) : baseModel;

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), profile.timeoutMs);
    const combinedSignal = mergeSignals(opts.signal, timeoutController.signal);

    try {
      const completion = await client.chat.completions.create(
        {
          model,
          temperature,
          ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
          ...(profile.responseFormat ? { response_format: profile.responseFormat } : {}),
          ...(opts.tools ? { tools: opts.tools } : {}),
          ...(opts.toolChoice ? { tool_choice: opts.toolChoice } : {}),
          messages: opts.messages,
        },
        { signal: combinedSignal },
      );
      clearTimeout(timer);
      return { completion, actualModel: model, attempts };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      const classification = classifyError(err);
      if (opts.signal?.aborted) throw err;
      const remaining = totalAttempts - attempts;
      if (!classification.retryable || remaining <= 0) {
        emit(
          opts.trackOpsEvent,
          endpoint,
          `llm_giveup_${classification.errorCode}`,
          classification.httpStatus,
          opts.orgId,
        );
        throw err;
      }
      emit(
        opts.trackOpsEvent,
        endpoint,
        `llm_retry_${classification.errorCode}`,
        classification.httpStatus,
        opts.orgId,
      );
      if (classification.retryAfterMs && classification.retryAfterMs > 0) {
        await delay(Math.min(classification.retryAfterMs, 5_000));
      } else if (classification.errorCode === "429") {
        await delay(500);
      }
    }
  }
  throw lastErr ?? new Error(`runLlmCompletion exhausted retries for ${profile.name}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mergeSignals(
  external: AbortSignal | undefined,
  internal: AbortSignal,
): AbortSignal {
  if (!external) return internal;
  if (external.aborted) return external;
  const controller = new AbortController();
  const onExternal = () => controller.abort(external.reason);
  const onInternal = () => controller.abort(internal.reason);
  external.addEventListener("abort", onExternal, { once: true });
  internal.addEventListener("abort", onInternal, { once: true });
  return controller.signal;
}

// ---------------------------------------------------------------------------
// runLlmStream (streaming variant for pass1/pass2)
// ---------------------------------------------------------------------------
//
// Streaming retry semantics:
// - Pre-stream errors (connection refused, 429/5xx on POST, timeout before any
//   chunk) are retryable. Retry consults profile.maxRetries + fallbackModel
//   (same policy as runLlmCompletion).
// - Once the stream begins yielding deltas, mid-stream errors are NOT
//   retryable (already emitted to client). They surface as a final
//   `{ type: "stream_error" }` event with classification metadata.
// - The first successful chunk clears the connect-timeout AbortController.
// - External `signal` propagates and short-circuits before any retry.

export type LlmStreamEvent =
  | { type: "chunk"; content: string }
  | {
      type: "tool_call_delta";
      index: number;
      id?: string;
      name?: string;
      argumentsFragment?: string;
    }
  | { type: "finish"; reason: string | null }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | {
      type: "stream_error";
      errorCode: string;
      httpStatus?: number;
      retryable: boolean;
      midStream: boolean;
    };

export interface LlmStreamOptions {
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.ChatCompletionTool[];
  toolChoice?: OpenAI.Chat.ChatCompletionToolChoiceOption;
  signal?: AbortSignal;
  overrides?: Partial<Pick<LlmProfile, "temperature" | "maxTokens" | "model">>;
  client?: OpenAI;
  trackOpsEvent?: LlmTrackOpsEventFn;
  orgId?: string;
}

export async function* runLlmStream(
  profile: LlmProfile,
  opts: LlmStreamOptions,
): AsyncGenerator<LlmStreamEvent> {
  const client = opts.client ?? createZaiClient();
  const temperature = opts.overrides?.temperature ?? profile.temperature;
  const maxTokens = opts.overrides?.maxTokens ?? profile.maxTokens;
  const baseModel = opts.overrides?.model ?? profile.model;
  const endpoint = `ai_llm_${profile.name}`;
  const totalAttempts = profile.maxRetries + 1;

  let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> | null = null;
  let cleanupCurrentAttempt: (() => void) | null = null;

  for (let i = 0; i < totalAttempts; i++) {
    if (opts.signal?.aborted) {
      throw opts.signal.reason ?? new Error("aborted");
    }
    const useFallback = i > 0 && !!profile.fallbackModel;
    const model = useFallback ? (profile.fallbackModel as string) : baseModel;

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), profile.timeoutMs);
    const combinedSignal = mergeSignals(opts.signal, timeoutController.signal);
    cleanupCurrentAttempt = () => clearTimeout(timer);

    try {
      stream = await client.chat.completions.create(
        {
          model,
          temperature,
          ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
          ...(opts.tools ? { tools: opts.tools, tool_choice: opts.toolChoice ?? "auto" } : {}),
          messages: opts.messages,
          stream: true,
          stream_options: { include_usage: true },
        },
        { signal: combinedSignal },
      );
      break;
    } catch (err) {
      clearTimeout(timer);
      cleanupCurrentAttempt = null;
      if (opts.signal?.aborted) throw err;
      const classification = classifyError(err);
      const remaining = totalAttempts - (i + 1);
      if (!classification.retryable || remaining <= 0) {
        emit(
          opts.trackOpsEvent,
          endpoint,
          `llm_giveup_${classification.errorCode}`,
          classification.httpStatus,
          opts.orgId,
        );
        yield {
          type: "stream_error",
          errorCode: classification.errorCode,
          httpStatus: classification.httpStatus,
          retryable: false,
          midStream: false,
        };
        return;
      }
      emit(
        opts.trackOpsEvent,
        endpoint,
        `llm_retry_${classification.errorCode}`,
        classification.httpStatus,
        opts.orgId,
      );
      if (classification.retryAfterMs && classification.retryAfterMs > 0) {
        await delay(Math.min(classification.retryAfterMs, 5_000));
      } else if (classification.errorCode === "429") {
        await delay(500);
      }
    }
  }

  if (!stream) {
    return;
  }

  try {
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      const finishReason = chunk.choices[0]?.finish_reason ?? null;

      if (delta?.content) {
        yield { type: "chunk", content: delta.content };
      }

      for (const tc of delta?.tool_calls ?? []) {
        yield {
          type: "tool_call_delta",
          index: tc.index,
          id: tc.id,
          name: tc.function?.name,
          argumentsFragment: tc.function?.arguments,
        };
      }

      if (finishReason) {
        yield { type: "finish", reason: finishReason };
      }

      if (chunk.usage) {
        yield {
          type: "usage",
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
        };
      }
    }
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    const classification = classifyError(err);
    emit(
      opts.trackOpsEvent,
      endpoint,
      `llm_midstream_${classification.errorCode}`,
      classification.httpStatus,
      opts.orgId,
    );
    yield {
      type: "stream_error",
      errorCode: classification.errorCode,
      httpStatus: classification.httpStatus,
      retryable: false,
      midStream: true,
    };
  } finally {
    cleanupCurrentAttempt?.();
  }
}
