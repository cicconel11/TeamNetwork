# Chat Pipeline — Code Map

## Overview

The chat pipeline handles the full lifecycle of an AI chat request: rate limiting, active-admin auth, input validation, message-safety assessment, thread management, semantic cache check, prompt construction, conditional tool attachment, LLM streaming via SSE, message persistence, cache write-back, audit logging, and deterministic grounding enforcement for tool-backed summaries. A small internal `TurnExecutionPolicy` layer now centralizes cache, RAG, context, and tool decisions from existing routing signals instead of spreading them across handler branches. Tool execution is now defense-in-depth hardened in the executor itself, and each turn stage is bounded so pass 1, each tool call, and pass 2 cannot hang indefinitely. The current read-tool set now includes `suggest_connections`, which can answer member/alumni outreach questions through a Falkor people graph with a functionally equivalent SQL fallback.

For Falkor setup, sync, and troubleshooting, see `docs/agent/falkor-people-graph.md`.

## File Map

### Source

| File | Purpose | Key Exports (line) |
|---|---|---|
| `src/lib/ai/client.ts` | LLM client factory (OpenAI-compatible, z.ai endpoint) | `createZaiClient` (L3), `getZaiModel` (L15) |
| `src/lib/ai/context.ts` | Admin auth helper — validates user has admin role in org | `getAiOrgContext` (L41), `AiOrgContext` type (L9), `AiOrgContextDeps` type (L23) |
| `src/lib/ai/context-builder.ts` | Prompt context assembly — surface-gated queries, token budget, ContextMetadata | `buildPromptContext` (L343), `buildSystemPrompt` (L331), `buildUntrustedOrgContextMessage` (L336), `ContextMetadata` (L113) |
| `src/lib/ai/response-composer.ts` | Async generator streaming LLM response as SSE chunk/error events | `composeResponse` (L22), `UsageAccumulator` type (L5) |
| `src/lib/ai/timeout.ts` | Turn-stage timeout constants and abort helpers | `PASS1_MODEL_TIMEOUT_MS`, `PASS2_MODEL_TIMEOUT_MS`, `TOOL_EXECUTION_TIMEOUT_MS`, `createStageAbortSignal`, `withStageTimeout` |
| `src/lib/ai/sse.ts` | SSE encoding, stream factory, event types | `CacheStatus` type (L1), `SSEEvent` type (L10), `encodeSSE` (L32), `createSSEStream` (L36), `SSE_HEADERS` (L25) |
| `src/lib/ai/audit.ts` | Audit logging with cache + context metadata columns, secret redaction | `logAiRequest` (L37) |
| `src/lib/ai/message-safety.ts` | Transport-noise cleanup, prompt-injection assessment, history sanitization | `assessAiMessageSafety`, `sanitizeHistoryMessageForPrompt` |
| `src/lib/ai/turn-execution-policy.ts` | Internal execution-policy builder | `buildTurnExecutionPolicy` |
| `src/lib/ai/tool-grounding.ts` | Deterministic verifier for current read-tool summaries, including `suggest_connections` names and reason codes | `verifyToolBackedResponse` |
| `src/lib/ai/tools/executor.ts` | Read-tool executor with executor-side active-admin recheck and discriminated result union | `executeToolCall`, `ToolExecutionResult`, `ToolExecutionContext` |
| `src/lib/falkordb/suggestions.ts` | `suggest_connections` implementation: unified person projection, SQL fallback parity, graph freshness metadata | `suggestConnections` |
| `src/lib/falkordb/client.ts` | Falkor client wrapper with env-gated availability and graph-scoped query helper | `falkorClient`, `FalkorUnavailableError`, `FalkorQueryError` |
| `src/lib/falkordb/sync.ts` | Graph sync worker for members, alumni, and mentorship pairs | `processGraphSyncQueue` |
| `src/lib/ai/thread-resolver.ts` | Thread ownership validation (normalizes all failures to 404) | `resolveOwnThread` (L11), `ThreadResolution` type (L7) |
| `src/lib/schemas/ai-assistant.ts` | Zod schemas for request validation and cache eligibility | `sendMessageSchema` (L25), `listThreadsSchema` (L34), `cacheEligibilitySchema` (L54) |
| `src/app/api/ai/[orgId]/chat/route.ts` | POST handler — orchestrates the full pipeline | `POST` (L491), `createChatPostHandler` (L36), `ChatRouteDeps` type (L25) |

### Schema

| File | Purpose |
|---|---|
| `supabase/migrations/20260319000000_ai_assistant_tables.sql` | DDL: `ai_threads`, `ai_messages`, `ai_audit_log`, RLS, indexes |
| `supabase/migrations/20260321100001_ai_semantic_cache.sql` | DDL: `ai_semantic_cache`, purge RPC, audit columns |
| `supabase/migrations/20260710100000_ai_audit_log_context_columns.sql` | Adds `context_surface`, `context_token_estimate` to `ai_audit_log` |

## Dependency Graph

```
src/app/api/ai/[orgId]/chat/route.ts  (orchestrator)
  ├── src/lib/ai/context.ts             (getAiOrgContext — admin auth)
  │     └── src/lib/supabase/service.ts (createServiceClient)
  ├── src/lib/ai/client.ts              (createZaiClient, getZaiModel)
  ├── src/lib/ai/context-builder.ts     (buildPromptContext)
  │     └── Supabase queries: organizations, users, members, alumni, parents, events, announcements, donation stats
  ├── src/lib/ai/response-composer.ts   (composeResponse — async generator)
  │     └── src/lib/ai/client.ts        (getZaiModel)
  ├── src/lib/ai/sse.ts                 (createSSEStream, SSE_HEADERS, encodeSSE)
  ├── src/lib/ai/audit.ts               (logAiRequest)
  │     └── src/lib/ai/sse.ts           (CacheStatus type)
  ├── src/lib/ai/message-safety.ts      (message risk assessment + history sanitization)
  ├── src/lib/ai/thread-resolver.ts     (resolveOwnThread)
  ├── src/lib/ai/semantic-cache-utils.ts (normalizePrompt, hashPrompt, buildPermissionScopeKey, checkCacheEligibility)
  ├── src/lib/ai/semantic-cache.ts      (lookupSemanticCache, writeCacheEntry)
  ├── src/lib/schemas/ai-assistant.ts   (sendMessageSchema)
  └── src/lib/security/rate-limit.ts    (checkRateLimit, buildRateLimitResponse)
```

## Data Flow: Request Pipeline

```
Client POST /api/ai/{orgId}/chat
  │  { message, surface, threadId?, idempotencyKey, bypassCache? }
  │
  ├─ 1.  Rate limit check (30/IP, 20/user per window)
  ├─ 2.  Auth — getAiOrgContext (validates admin role, fail-closed)
  ├─ 3.  Validate body (sendMessageSchema: normalizes bypass_cache → bypassCache)
  ├─ 3.5 Assess message safety
  │       ├─ Strip transport noise (zero-width/control chars, normalize Unicode)
  │       ├─ Classify `none` / `suspicious` / `blocked`
  │       └─ Derive prompt-safe text for routing, cache, RAG, and history replay
  ├─ 4.  Thread ownership check (resolveOwnThread if threadId provided)
  ├─ 5.  Abandoned stream cleanup (mark pending/streaming msgs >5 min as error)
  ├─ 6.  Idempotency check (by idempotencyKey → ai_messages unique index)
  │       ├─ Complete duplicate → SSE done event (replayed: true), return early
  │       └─ In-flight duplicate → 409 { error, threadId }
  ├─ 7.  Upsert thread (insert new if no threadId, title = first 100 chars)
  ├─ 8.  Insert user message (status: complete) + touch thread updated_at
  │
  ├─ 8.25 Safety short-circuit
  │       ├─ `suspicious` / `blocked` → insert assistant refusal, skip model/tools/RAG/cache write
  │       └─ emit ops telemetry + audit row with `cache_status: bypass`
  ├─ 8.5 Build TurnExecutionPolicy
  │       ├─ casual            → no cache, no tools, no RAG
  │       ├─ static_general    → exact cache lookup, shared_static, no tools, no RAG
  │       ├─ live_lookup       → full context, tools allowed, RAG allowed
  │       ├─ follow_up         → full context, tools allowed, no shared cache
  │       └─ out_of_scope      → no cache, no tools, no RAG
  │
  ├─ 8.6 CACHE CHECK (if policy allows lookup_exact)
  │       ├─ HIT → insert assistant message (complete), stream cached content, audit, return
  │       ├─ MISS → continue to live path with contextMode = "shared_static"
  │       └─ ERROR → continue to live path with full context
  │
  ├─ 8.7 RAG retrieval
  │       ├─ casual / static_general / out_of_scope skip retrieval
  │       └─ follow_up / live_lookup may retrieve additive chunks
  │
  ├─ 9.  Insert assistant placeholder (status: pending)
  ├─ 10. Build prompt context + fetch history (parallel)
  │       ├─ buildPromptContext (surface-gated queries + token budget)
  │       │   ├─ Queries gated by surface: events only loads org+events, etc.
  │       │   ├─ 4000-token budget drops lowest-priority sections first
  │       │   ├─ Trusted system prompt includes current local date/time
  │       │   ├─ Returns { systemPrompt, orgContextMessage, metadata }
  │       │   └─ "shared_static" mode: org overview only (overrides surface)
  │       └─ Last 20 complete messages from thread
  │            └─ user-role history re-assessed and sanitized before model replay
  ├─ 11. Resolve pass-1 tools from execution policy
  │       ├─ `none` for casual / static_general / out_of_scope
  │       └─ surface-gated read tools for follow_up / live_lookup
  ├─ 12. Stream LLM response via SSE (composeResponse async generator)
  │       ├─ Pass 1 runs with a 15s timeout budget
  │       ├─ Each requested tool is re-authorized in the executor (`role = admin`, `status = active`) and runs with a 5s timeout budget
  │       ├─ Tool executor returns one of `ok`, `tool_error`, `timeout`, `forbidden`, `auth_error`
  │       ├─ `suggest_connections` may return either `mode: "falkor"` or `mode: "sql_fallback"` plus `freshness` metadata
  │       ├─ Tool `timeout` opens a per-pass breaker, skips later tools in that pass, then still allows a single fallback pass 2
  │       ├─ Tool `forbidden` / `auth_error` fail the turn closed, emit SSE error, and skip pass 2
  │       ├─ When tools are available, pass-1 text is buffered until the route knows whether the turn stayed text-only or switched into tool mode
  │       ├─ Pass 2 runs with a 15s timeout budget when tool results exist
  │       ├─ Pass-2 text is buffered server-side, never streamed immediately
  │       └─ `tool_status` SSE events still stream live during tool execution
  ├─ 13. Finalize — update assistant message to complete/error
  ├─ 13.2 If pass-2 used successful read tools: verifyToolBackedResponse()
  │       ├─ grounded   → emit buffered answer, persist it, continue normally
  │       └─ ungrounded → discard buffered answer, emit/persist fallback, log ops telemetry
  │
  └─ 13.5 CACHE WRITE (if miss + stream succeeded + finalize succeeded)
          ├─ Invalidate expired conflicting rows
          ├─ Insert new cache row with surface-specific TTL
          ├─ Record inserted `cache_entry_id` in audit metadata
          └─ Surface duplicate / oversize / error outcomes via write-result metadata
```

## Configuration

### Rate Limits

| Endpoint | Per-IP | Per-User |
|---|---|---|
| POST `/chat` | 30/window | 20/window |

### LLM Parameters

| Parameter | Value |
|---|---|
| Model | `glm-5` (configurable via `ZAI_MODEL`) |
| Temperature | 0.7 |
| Max tokens | 2000 |
| Stream | `true` (with `include_usage`) |

### Stage Timeouts

| Stage | Budget |
|---|---|
| Pass 1 model call | `15s` |
| Each tool execution | `5s` |
| Pass 2 model call | `15s` |

Timeouts are launch-time code constants, not env-configurable knobs.

### Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `ZAI_API_KEY` | (required) | LLM provider key — if unset, returns config-error message |
| `ZAI_MODEL` | `glm-5` | Model identifier |
| `DISABLE_AI_CACHE` | `undefined` | Set `"true"` to disable cache (kill switch) |

### Context Builder: Surface-Gated Sections

Queries are gated by the `surface` parameter. Each surface only loads the data sources it needs:

| Surface | Data Sources Loaded |
|---|---|
| `general` (default) | All 8 sources |
| `members` | org, userName, memberCount, alumniCount, parentCount |
| `analytics` | org, userName, memberCount, alumniCount, parentCount, donationStats |
| `events` | org, userName, upcomingEvents |

`shared_static` mode overrides surface — only loads org overview regardless. It is now entered via the execution policy’s `static_general` profile rather than ad hoc branching in the handler.

#### Sections (priority order, highest first)

| Section | Priority | Query Target |
|---|---|---|
| Organization Overview | 1 | `organizations` |
| Current User | 2 | `users` |
| Counts | 3 | `members`, `alumni`, `parents` (counts) |
| Upcoming Events | 4 | `events` (next 5 + total count) |
| Recent Announcements | 5 | `announcements` (last 14 days, limit 5) |
| Donation Summary | 6 | `organization_donation_stats` |

#### Token Budget

- Budget: **4000 tokens** (~16,000 chars at 4 chars/token)
- When total context exceeds budget, lowest-priority sections are dropped first
- `estimatedTokens` in metadata is computed from the full assembled message (includes preamble)
- Typical context is ~300 tokens — budget is a safety net, not a tight constraint

#### ContextMetadata

`buildPromptContext` returns `{ systemPrompt, orgContextMessage, metadata }` where metadata is:

```typescript
interface ContextMetadata {
  surface: CacheSurface;
  sectionsIncluded: SectionName[];
  sectionsExcluded: SectionName[];
  estimatedTokens: number;
  budgetTokens: number;
}
```

Metadata is passed to audit logging (`context_surface`, `context_token_estimate` columns).

The system prompt includes a `NARROW_PANEL_POLICY` instructing the LLM to avoid tables and multi-column layouts, plus a trusted `Current local date/time:` line for relative-time questions. It also instructs the LLM to prefer real human names over raw emails in member/admin lists, avoid placeholder renderings like `Member(email@example.com)`, and describe remaining no-name records as email-only member/admin accounts.

## Tool Execution Semantics

`executeToolCall()` now returns a discriminated union so the route can respond deterministically:

```typescript
type ToolExecutionResult =
  | { kind: "ok"; data: unknown }
  | { kind: "forbidden"; error: "Forbidden" }
  | { kind: "auth_error"; error: "Auth check failed" }
  | { kind: "tool_error"; error: string }
  | { kind: "timeout"; error: "Tool timed out" };
```

- `ok`: emit `tool_status:done`, append trusted tool result, continue.
- `tool_error`: emit `tool_status:error`, append error payload, continue later tools in the same pass.
- `timeout`: emit `tool_status:error`, append timeout payload, open the current-pass breaker, skip later tools in that pass, then run one fallback pass 2.
- `forbidden`: emit `tool_status:error`, emit a non-retryable SSE error, finalize the turn as `error`, and skip pass 2.
- `auth_error`: same user-visible behavior as `forbidden`, but logged separately as executor auth infrastructure failure.

## Tool Catalog

### `suggest_connections`

- **Inputs:** `person_type`, `person_id`, optional `limit` (default 10, max 25)
- **Outputs:** `{ mode, freshness, results }`
- `mode`: `"falkor"` when the graph path succeeds, `"sql_fallback"` when Falkor is disabled or query execution fails
- `freshness`: `{ state: "fresh" | "stale", as_of, lag_seconds? }`
- `results[]`: ranked same-org member/alumni suggestions with deterministic `score`, compact `preview`, and machine-readable `reasons[]`
- **Ranking contract:** direct mentorship `100`, second-degree mentorship `50`, shared company `20`, shared industry `12`, shared major `10`, shared graduation year `8`, shared city `5`
- **Grounding contract:** pass-2 prose may name only returned suggestions and may claim only returned reason codes for those people

## Test Coverage

| Test File | Cases | Coverage |
|---|---|---|
| `tests/ai-client.test.ts` | 3 | `createZaiClient`, `getZaiModel` |
| `tests/ai-context.test.ts` | 5 | `getAiOrgContext` — auth, role validation, fail-closed |
| `tests/ai-context-builder.test.ts` | 17 | `buildPromptContext`, `shared_static` mode, surface selection, token budget, metadata, section rendering |
| `tests/ai-audit.test.ts` | 6 | `logAiRequest` — insert, error handling, secret redaction |
| `tests/ai-thread-resolver.test.ts` | 5 | `resolveOwnThread` — found, not found, wrong user, wrong org, DB error |
| `tests/ai-stream-consumer.test.ts` | 2 | `consumeSSEStream` — chunk/done parsing |
| `tests/ai-stream-failures.test.ts` | 2 | `parseAIChatFailure` — 409 handling, error fallback |
| `tests/ai-middleware-noise.test.ts` | 1 | Middleware suppresses AI route console noise |
| `tests/routes/ai/chat.test.ts` | 40 | Route simulation: auth, validation, idempotency, streaming, cache flows, schema aliases |
| `tests/routes/ai/chat-handler.test.ts` | 1 | Handler factory DI pattern |
