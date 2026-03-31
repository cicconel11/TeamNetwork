# Chat Pipeline — Code Map

## Overview

The chat pipeline handles the full lifecycle of an AI chat request: rate limiting, active-admin auth, input validation, message-safety assessment, thread management, semantic cache check, prompt construction, conditional tool attachment, LLM streaming via SSE, message persistence, cache write-back, audit logging, and deterministic grounding enforcement for tool-backed summaries. A small internal `TurnExecutionPolicy` layer now centralizes cache, retrieval, context, and tool decisions from existing routing signals instead of spreading them across handler branches. Tool execution is now defense-in-depth hardened in the executor itself, and each turn stage is bounded so pass 1, each tool call, and pass 2 cannot hang indefinitely. The shipped read-tool set includes members, events, announcements, discussions, job postings, org stats, connection suggestions, and `find_navigation_targets` for page/deep-link lookup. Navigation/action requests short-circuit to `find_navigation_targets` instead of routing through the broader read-tool set, while job-creation prompts can attach `prepare_job_posting` and discussion-creation prompts can attach `prepare_discussion_thread` to validate a draft and emit a structured `pending_action` confirmation event. Prompt construction also receives the attached tool list plus a client-reported current page path as untrusted context for the turn. Audit rows now also persist a `stage_timings` JSON payload with per-stage duration/status plus the final retrieval decision/reason for each logged turn.

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
| `src/lib/ai/pending-actions.ts` | Pending-action persistence, validation, and status transitions for assistant writes | `createPendingAction`, `getPendingAction`, `updatePendingActionStatus`, `isAuthorizedAction` |
| `src/lib/ai/audit.ts` | Audit logging with cache/context metadata plus `stage_timings`, secret redaction | `logAiRequest` (L37) |
| `src/lib/ai/chat-telemetry.ts` | Shared retrieval/stage timing contracts for AI audit payloads | `AiAuditStageTimings`, `AiAuditStageName` |
| `src/lib/ai/message-safety.ts` | Transport-noise cleanup, prompt-injection assessment, history sanitization | `assessAiMessageSafety`, `sanitizeHistoryMessageForPrompt` |
| `src/lib/ai/turn-execution-policy.ts` | Internal execution-policy builder | `buildTurnExecutionPolicy` |
| `src/lib/ai/tool-grounding.ts` | Deterministic verifier for current read-tool summaries, including connection-template validation against `suggest_connections` payload states, names, order, and reasons | `verifyToolBackedResponse` |
| `src/lib/ai/tools/executor.ts` | Read-tool executor with executor-side active-admin recheck and discriminated result union | `executeToolCall`, `ToolExecutionResult`, `ToolExecutionContext` |
| `src/lib/falkordb/suggestions.ts` | `suggest_connections` implementation: unified person projection, server-side person-query resolution, chat-ready payload normalization, SQL fallback parity, graph freshness metadata | `suggestConnections` |
| `src/lib/falkordb/client.ts` | Falkor client wrapper with env-gated availability and graph-scoped query helper | `falkorClient`, `FalkorUnavailableError`, `FalkorQueryError` |
| `src/lib/falkordb/sync.ts` | Graph sync worker for members, alumni, and mentorship pairs | `processGraphSyncQueue` |
| `src/lib/ai/thread-resolver.ts` | Thread ownership validation (normalizes all failures to 404) | `resolveOwnThread` (L11), `ThreadResolution` type (L7) |
| `src/lib/schemas/ai-assistant.ts` | Zod schemas for request validation and cache eligibility | `sendMessageSchema` (L25), `listThreadsSchema` (L34), `cacheEligibilitySchema` (L54) |
| `src/app/api/ai/[orgId]/chat/route.ts` | POST handler — orchestrates the full pipeline | `POST` (L491), `createChatPostHandler` (L36), `ChatRouteDeps` type (L25) |
| `src/app/api/ai/[orgId]/pending-actions/[actionId]/confirm/route.ts` | POST handler — confirms and executes a pending assistant action | `POST` |
| `src/app/api/ai/[orgId]/pending-actions/[actionId]/cancel/route.ts` | POST handler — cancels a pending assistant action | `POST` |

### Schema

| File | Purpose |
|---|---|
| `supabase/migrations/20260319000000_ai_assistant_tables.sql` | DDL: `ai_threads`, `ai_messages`, `ai_audit_log`, RLS, indexes |
| `supabase/migrations/20260321100001_ai_semantic_cache.sql` | DDL: `ai_semantic_cache`, purge RPC, audit columns |
| `supabase/migrations/20260710100000_ai_audit_log_context_columns.sql` | Adds `context_surface`, `context_token_estimate` to `ai_audit_log` |
| `supabase/migrations/20260719000000_ai_audit_stage_timings.sql` | Adds `stage_timings` JSONB to `ai_audit_log` |
| `supabase/migrations/20260727000000_ai_pending_actions.sql` | Adds `ai_pending_actions` for confirmation-gated assistant writes |

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
  │       ├─ casual            → no cache, no tools, retrieval skipped (`casual_turn`)
  │       ├─ static_general    → exact cache lookup, shared_static, retrieval skipped (`general_knowledge_query`)
  │       ├─ live_lookup       → full context, tools allowed, retrieval may be allowed or skipped
  │       ├─ follow_up         → full context, tools allowed, no shared cache, retrieval depends on follow-up shape
  │       └─ out_of_scope      → no cache, no tools, retrieval skipped (`out_of_scope_request`)
  │
  ├─ 8.6 CACHE CHECK (if policy allows lookup_exact)
  │       ├─ HIT → insert assistant message (complete), stream cached content, audit, return
  │       ├─ MISS → continue to live path with contextMode = "shared_static"
  │       └─ ERROR → continue to live path with full context
  │
  ├─ 8.7 RAG retrieval
  │       ├─ skip when policy says structured tool-only / casual / out-of-scope / cache-hit
  │       ├─ allow for mixed asks, ambiguous asks, and context-dependent follow-ups
  │       ├─ this is why member/event/parent count turns now feel noticeably faster than discussion explainers
  │       └─ record final retrieval decision/reason in audit `stage_timings`
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
  │       └─ surface-gated read tools for follow_up / live_lookup, plus `prepare_job_posting` / `prepare_discussion_thread` for create requests
  ├─ 12. Stream LLM response via SSE (composeResponse async generator)
  │       ├─ Pass 1 runs with a 15s timeout budget
  │       ├─ Each requested tool runs with a 5s timeout budget
  │       ├─ Chat route calls pass an explicit `preverified_admin` authorization contract so duplicate membership lookups can be skipped safely
  │       ├─ Non-chat executor callers still use the fallback membership verification path
  │       ├─ Tool executor returns one of `ok`, `tool_error`, `timeout`, `forbidden`, `auth_error`
  │       ├─ Direct-name connection prompts on the `members` surface expose only `suggest_connections`
  │       ├─ Navigation / action prompts can expose only `find_navigation_targets`
  │       ├─ Job creation prompts can expose only `prepare_job_posting`
  │       ├─ Discussion creation prompts can expose only `prepare_discussion_thread`
  │       ├─ Clear job/discussion create turns now preempt surface-specific read routing, so keywords like fundraising, alumni, or events do not knock the turn off the pending-action path
  │       ├─ Those single-tool create turns also force pass-1 `tool_choice` to the prepare tool so the model cannot bypass the pending-action flow with a freeform draft
  │       ├─ `suggest_connections` may resolve `person_query` server-side and return one of `resolved`, `ambiguous`, `not_found`, `no_suggestions`
  │       ├─ `find_navigation_targets` returns org-scoped deep links for open/create/manage page requests
  │       ├─ `prepare_job_posting` returns `missing_fields`, `needs_confirmation`, `invalid_source_url`, or `forbidden`
  │       ├─ `prepare_discussion_thread` returns `missing_fields`, `needs_confirmation`, or `forbidden`
  │       ├─ `needs_confirmation` emits a `pending_action` SSE payload instead of writing immediately
  │       ├─ Successful connection payloads include display-ready `source_person`, ordered `suggestions`, normalized reason labels, `mode`, and `freshness`
  │       ├─ If quick structured queries succeed but connection prompts fail, treat the execution-policy path as healthy first and inspect the Falkor/suggestions stack separately
  │       ├─ Tool `timeout` opens a per-pass breaker, skips later tools in that pass, then still allows a single fallback pass 2
  │       ├─ Tool `forbidden` / `auth_error` fail the turn closed, emit SSE error, and skip pass 2
  │       ├─ When tools are available, pass-1 text is buffered until the route knows whether the turn stayed text-only or switched into tool mode
  │       ├─ Single-tool `suggest_connections`, `list_announcements`, and `find_navigation_targets` results are rendered deterministically in-route
  │       ├─ Pass 2 runs with a 15s timeout budget for the remaining tool-backed turns and still receives an extra fixed-template contract for `suggest_connections` when mixed tool results require model synthesis
  │       ├─ Pass-2 text is buffered server-side, never streamed immediately
  │       └─ `tool_status` SSE events still stream live during tool execution
  ├─ 13. Finalize — update assistant message to complete/error
  ├─ 13.2 If pass-2 used successful read tools: verifyToolBackedResponse()
  │       ├─ grounded   → emit buffered answer, persist it, continue normally
  │       └─ ungrounded → discard buffered answer, emit/persist fallback, log ops telemetry
  ├─ 13.3 Persist stage timings
  │       ├─ per-stage duration/status for auth, policy, cache, RAG, prompt build, history, pass 1, tools, pass 2, grounding, finalize, cache write
  │       └─ tool call timing includes `auth_mode` and error classification
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
| `general` (default) | All 6 prompt-context sources |
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

Metadata is passed to audit logging (`context_surface`, `context_token_estimate`, and `stage_timings` payloads).

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

### `list_members`

- **Inputs:** optional `limit` (default 20, max 50)
- **Outputs:** active member rows with `id`, `user_id`, `status`, `role`, `created_at`, `name`, `email`
- **Name handling:** prefers `members.first_name` + `last_name`; falls back to linked `users.name` for placeholder rows; otherwise returns an empty name so the UI/prompt can treat the record as an email-only account
- **Pass-2 contract:** member answers stay row-backed. They may add presentation-only role suffixes to returned names, but they must not infer org-wide totals or grouped role counts from roster rows alone

### `list_events`

- **Inputs:** optional `limit` (default 10, max 25), optional `upcoming` (boolean, default `true`)
- **Outputs:** event rows with `id`, `title`, `start_date`, `end_date`, `location`, `description`
- **Behavior:** `upcoming: true` filters to `start_date >= now`, `false` filters to past events and reverses ordering

### `list_announcements`

- **Inputs:** optional `limit` (default 10, max 25)
- **Outputs:** recent announcement rows with `title`, `published_at`, `audience`, `is_pinned`, and `body_preview`
- **Deterministic path:** single-tool announcement turns are rendered in-route as a compact `Recent announcements` list instead of paying for a second model pass

### `list_discussions`

- **Inputs:** optional `limit` (default 10, max 25)
- **Outputs:** recent discussion-thread rows with `id`, `title`, `author_name`, `created_at`, `reply_count`, and `body_preview`
- **Behavior:** used for community-conversation prompts and recent forum/discussion summaries

### `list_job_postings`

- **Inputs:** optional `limit` (default 10, max 25)
- **Outputs:** active job-posting rows with `id`, `title`, `company`, `location`, `location_type`, `experience_level`, `application_url`, and `description_preview`
- **Behavior:** used for hiring/job-board prompts and org career-opportunity summaries

### `get_org_stats`

- **Inputs:** none
- **Outputs:** aggregate counts and donation stats for organization overview / dashboard-style questions
- **Surface:** `general`, `members`, `analytics`, and `events`

### `find_navigation_targets`

- **Inputs:** `query`, optional `limit` (default 5, max 10)
- **Outputs:** `{ state, query, matches[] }` where each match includes org-scoped `href`, `label`, `description`, and `kind`
- **Deterministic path:** single-tool navigation turns are rendered in-route as clickable markdown links so the panel can deep-link users directly to matched pages

### `prepare_job_posting`

- **Inputs:** partial job draft fields plus optional `application_url`, `contact_email`, `expires_at`, and `mediaIds`
- **Outputs:** `{ state, missing_fields?, pending_action?, draft, source_intake? }`
- `state`: `missing_fields`, `needs_confirmation`, `invalid_source_url`, or `forbidden`
- **Behavior:** validates a stricter assistant-only job schema, optionally enriches missing fields from an HTTPS source URL, and creates a pending confirmation record when the draft is complete
- **Write safety:** never writes a job directly; completed drafts emit `pending_action` SSE and require a separate confirm route call before `job_postings` is mutated

### `prepare_discussion_thread`

- **Purpose:** Validate a top-level discussion-thread draft, collect missing title/body fields, and create a pending confirmation action when complete.
- **Outputs:** `{ state, missing_fields?, pending_action?, draft }`
- **Write safety:** never writes a thread directly; completed drafts emit `pending_action` SSE and require a separate confirm route call before `discussion_threads` is mutated

### `suggest_connections`

- **Inputs:** either `person_query` for chat-driven name/email lookups, or `person_type` plus `person_id`; optional `limit` (default 10, max 25)
- **Outputs:** `{ state, source_person, suggestions, disambiguation_options?, mode, freshness, fallback_reason }`
- `state`: `resolved`, `ambiguous`, `not_found`, or `no_suggestions`
- `mode`: `"falkor"` when the graph path succeeds, `"sql_fallback"` when Falkor is disabled or query execution fails
- `freshness`: `{ state: "fresh" | "stale" | "degraded" | "unknown", as_of, lag_seconds?, reason? }`
- `source_person`: display-ready source identity used by pass 2
- `suggestions[]`: ranked same-org member/alumni suggestions in final display order with deterministic `score`, compact `subtitle`, normalized `reasons[]`, and preview fields
- `disambiguation_options[]`: display-ready candidate people when `person_query` matched multiple org people
- **Ranking contract:** shared industry `40`, shared company `30`, shared city `15`, graduation proximity `10` (within 3 years)
- **Grounding contract:** pass-2 connection prose may only render the fixed connection template, may name only returned `source_person` / `suggestions`, must preserve ranked order, and may claim only returned normalized reason codes for each suggestion

### Write Actions Today

- The shipped write paths are `prepare_job_posting` and `prepare_discussion_thread`, both backed by the same pending-action confirm/cancel routes.
- Broader write tools like event creation or announcement publishing are still deferred.
- The confirmation UI depends on `pending_action` SSE handling in the assistant panel rather than parsing free-form "yes" replies in chat.

### Pending Actions

- SSE now includes a `pending_action` event carrying `actionId`, `actionType`, `summary`, `payload`, and `expiresAt`
- The panel renders a structured review card from this payload and does not rely on the model's prose for confirmation UI
- Confirm/cancel requests resolve through dedicated pending-action routes, which verify org, user, thread, status, and expiry before mutating any data

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
