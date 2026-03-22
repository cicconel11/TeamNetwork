# Chat Pipeline — Code Map

## Overview

The chat pipeline handles the full lifecycle of an AI chat request: rate limiting, admin auth, input validation, thread management, semantic cache check, LLM streaming via SSE, message persistence, cache write-back, and audit logging. All orchestration lives in a single route handler with dependency injection for testability.

## File Map

### Source

| File | Purpose | Key Exports (line) |
|---|---|---|
| `src/lib/ai/client.ts` | LLM client factory (OpenAI-compatible, z.ai endpoint) | `createZaiClient` (L3), `getZaiModel` (L15) |
| `src/lib/ai/context.ts` | Admin auth helper — validates user has admin role in org | `getAiOrgContext` (L41), `AiOrgContext` type (L9), `AiOrgContextDeps` type (L23) |
| `src/lib/ai/context-builder.ts` | Prompt context assembly — org data, counts, events, announcements | `buildPromptContext` (L265), `buildSystemPrompt` (L253), `buildUntrustedOrgContextMessage` (L258) |
| `src/lib/ai/response-composer.ts` | Async generator streaming LLM response as SSE chunk/error events | `composeResponse` (L22), `UsageAccumulator` type (L5) |
| `src/lib/ai/sse.ts` | SSE encoding, stream factory, event types | `CacheStatus` type (L1), `SSEEvent` type (L10), `encodeSSE` (L32), `createSSEStream` (L36), `SSE_HEADERS` (L25) |
| `src/lib/ai/audit.ts` | Audit logging with cache columns, secret redaction | `logAiRequest` (L34) |
| `src/lib/ai/thread-resolver.ts` | Thread ownership validation (normalizes all failures to 404) | `resolveOwnThread` (L11), `ThreadResolution` type (L7) |
| `src/lib/schemas/ai-assistant.ts` | Zod schemas for request validation and cache eligibility | `sendMessageSchema` (L25), `listThreadsSchema` (L34), `cacheEligibilitySchema` (L54) |
| `src/app/api/ai/[orgId]/chat/route.ts` | POST handler — orchestrates the full pipeline | `POST` (L491), `createChatPostHandler` (L36), `ChatRouteDeps` type (L25) |

### Schema

| File | Purpose |
|---|---|
| `supabase/migrations/20260319000000_ai_assistant_tables.sql` | DDL: `ai_threads`, `ai_messages`, `ai_audit_log`, RLS, indexes |
| `supabase/migrations/20260321100001_ai_semantic_cache.sql` | DDL: `ai_semantic_cache`, purge RPC, audit columns |

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
  ├─ 4.  Thread ownership check (resolveOwnThread if threadId provided)
  ├─ 5.  Abandoned stream cleanup (mark pending/streaming msgs >5 min as error)
  ├─ 6.  Idempotency check (by idempotencyKey → ai_messages unique index)
  │       ├─ Complete duplicate → SSE done event (replayed: true), return early
  │       └─ In-flight duplicate → 409 { error, threadId }
  ├─ 7.  Upsert thread (insert new if no threadId, title = first 100 chars)
  ├─ 8.  Insert user message (status: complete) + touch thread updated_at
  │
  ├─ 8.5 CACHE CHECK (if enabled + eligible)
  │       ├─ HIT → insert assistant message (complete), stream cached content, audit, return
  │       ├─ MISS → continue to live path with contextMode = "shared_static"
  │       └─ ERROR → continue to live path with full context
  │
  ├─ 9.  Insert assistant placeholder (status: pending)
  ├─ 10. Build prompt context + fetch history (parallel)
  │       ├─ buildPromptContext (org info, counts, events, announcements, donations)
  │       │   └─ "shared_static" mode: org overview only (no user/mutable data)
  │       └─ Last 20 complete messages from thread
  ├─ 11. Stream LLM response via SSE (composeResponse async generator)
  │       └─ Each chunk: { type: "chunk", content: "..." }
  ├─ 12. Finalize — update assistant message to complete/error
  │
  └─ 12.5 CACHE WRITE (if miss + stream succeeded + finalize succeeded)
          ├─ Invalidate expired conflicting rows
          ├─ Insert new cache row with surface-specific TTL
          └─ Unique constraint (23505) silently ignored on concurrent writes
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

### Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `ZAI_API_KEY` | (required) | LLM provider key — if unset, returns config-error message |
| `ZAI_MODEL` | `glm-5` | Model identifier |
| `DISABLE_AI_CACHE` | `undefined` | Set `"true"` to disable cache (kill switch) |

### Context Builder: Prompt Sections

The system prompt and org context message are built from parallel Supabase queries:

| Section | Query Target | Omitted in `shared_static` |
|---|---|---|
| Organization Overview | `organizations` | No |
| Current User | `users` | Yes |
| Active Member Count | `members` (count) | Yes |
| Alumni Count | `alumni` (count) | Yes |
| Parent Count | `parents` (count) | Yes |
| Upcoming Events | `events` (next 5 + total count) | Yes |
| Recent Announcements | `announcements` (last 14 days, limit 5) | Yes |
| Donation Summary | `organization_donation_stats` | Yes |

The system prompt includes a `NARROW_PANEL_POLICY` instructing the LLM to avoid tables and multi-column layouts.

## Test Coverage

| Test File | Cases | Coverage |
|---|---|---|
| `tests/ai-client.test.ts` | 3 | `createZaiClient`, `getZaiModel` |
| `tests/ai-context.test.ts` | 5 | `getAiOrgContext` — auth, role validation, fail-closed |
| `tests/ai-context-builder.test.ts` | 10 | `buildPromptContext`, `shared_static` mode, section rendering |
| `tests/ai-audit.test.ts` | 6 | `logAiRequest` — insert, error handling, secret redaction |
| `tests/ai-thread-resolver.test.ts` | 5 | `resolveOwnThread` — found, not found, wrong user, wrong org, DB error |
| `tests/ai-stream-consumer.test.ts` | 2 | `consumeSSEStream` — chunk/done parsing |
| `tests/ai-stream-failures.test.ts` | 2 | `parseAIChatFailure` — 409 handling, error fallback |
| `tests/ai-middleware-noise.test.ts` | 1 | Middleware suppresses AI route console noise |
| `tests/routes/ai/chat.test.ts` | 11 | Route simulation: auth, validation, idempotency, streaming, cache flows |
| `tests/routes/ai/chat-handler.test.ts` | 1 | Handler factory DI pattern |
