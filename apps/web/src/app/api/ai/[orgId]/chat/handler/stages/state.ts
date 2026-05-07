/**
 * Pipeline-scoped state slices returned by chat handler stages.
 *
 * Each stage owns one explicit output shape. The handler orchestrator unwraps
 * the slice, short-circuits on `StageOutcome`, and passes only the required
 * fields to later stages; nothing here lives globally.
 */
import type { NextResponse } from "next/server";
import type { AiOrgContext } from "@/lib/ai/context";
import type { RateLimitResult } from "@/lib/security/rate-limit";
import type { AiLogContext } from "@/lib/ai/logger";
import type { CacheStatus } from "@/lib/ai/sse";
import type { TurnExecutionPolicy } from "@/lib/ai/turn-execution-policy";
import type { CacheSurface } from "@/lib/ai/semantic-cache-utils";
import type { resolveSurfaceRouting } from "@/lib/ai/intent-router";
import type { sendMessageSchema } from "@/lib/schemas";
import type { assessAiMessageSafety } from "@/lib/ai/message-safety";
import type { AiThreadMetadata } from "@/lib/ai/thread-resolver";
import type { DraftSessionRecord } from "@/lib/ai/draft-sessions";
import type { RouteEntityContext } from "@/lib/ai/route-entity";
import type {
  PendingEventActionRecord,
  PendingEventRevisionAnalysis,
} from "../pending-event-revision";
import type { getPass1Tools } from "../pass1-tools";
import type { ChatAttachment } from "../shared";

// ---------------------------------------------------------------------------
// auth-context stage output
// ---------------------------------------------------------------------------

export interface AuthContextSlice {
  /** Org context + service supabase. Discriminated union; orchestrator handles `ok:false`. */
  ctx: Extract<AiOrgContext, { ok: true }>;
  /** Rate-limit result; headers spread into every downstream Response. */
  rateLimit: RateLimitResult;
  /** Whether tests / runtime support draft-session storage. */
  canUseDraftSessions: boolean;
  /** Per-request log context (request id + org + user). */
  requestLogContext: AiLogContext;
  /** Per-request log context without user (used before ctx resolves). */
  baseLogContext: AiLogContext;
  /** Cached `process.env.DISABLE_AI_CACHE === "true"` snapshot. */
  cacheDisabled: boolean;
}

// ---------------------------------------------------------------------------
// validate-policy stage output
// ---------------------------------------------------------------------------

type ValidatedBody = ReturnType<typeof sendMessageSchema.parse>;
type SurfaceRouting = ReturnType<typeof resolveSurfaceRouting>;

export interface ValidatePolicySlice {
  validatedBody: ValidatedBody;
  message: string;
  surface: ValidatedBody["surface"];
  existingThreadId: string | undefined;
  idempotencyKey: string;
  currentPath: string | undefined;
  attachment: ChatAttachment | undefined;
  messageSafety: ReturnType<typeof assessAiMessageSafety>;
  routing: SurfaceRouting;
  effectiveSurface: CacheSurface;
  resolvedIntent: SurfaceRouting["intent"];
  resolvedIntentType: SurfaceRouting["intentType"];
  executionPolicy: TurnExecutionPolicy;
  usesSharedStaticContext: boolean;
  pass1Tools: ReturnType<typeof getPass1Tools>;
  cacheStatus: CacheStatus;
  cacheEntryId: string | undefined;
  cacheBypassReason: string | undefined;
}

// ---------------------------------------------------------------------------
// thread-idempotency stage output
// ---------------------------------------------------------------------------

/**
 * Output of the thread+idempotency stage.
 *
 * Holds thread resolution + draft-session/pending-event/route-entity context
 * loaded prior to init_ai_chat. May mutate `pass1Tools` (drafts narrow tools)
 * and `usesToolFirstContext`.
 */
export interface ThreadIdempotencySlice {
  threadId: string | undefined;
  threadMetadata: AiThreadMetadata;
  activeDraftSession: DraftSessionRecord | null;
  activePendingEventActions: PendingEventActionRecord[];
  pendingEventRevisionAnalysis: PendingEventRevisionAnalysis;
  routeEntityContext: RouteEntityContext | null;
  pass1Tools: ReturnType<typeof getPass1Tools>;
  usesToolFirstContext: boolean;
}

// ---------------------------------------------------------------------------
// Stage error envelope
// ---------------------------------------------------------------------------

/**
 * Some stages can short-circuit with a Response (validation failure, rate
 * limit). Others may rethrow domain errors that the orchestrator handles.
 * Stages return a discriminated union so the orchestrator decides.
 */
export type StageOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; response: NextResponse | Response };
