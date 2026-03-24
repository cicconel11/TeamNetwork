# Semantic Cache — Code Map

## Overview

The AI semantic cache is a conservative v1 exact-match cache for a narrow subset of **standalone first-turn `general` prompts only**. Pure cache eligibility still evaluates prompt safety, but the chat handler now applies an internal execution-policy layer before lookup/write. That means some prompts that are technically safe to hash, such as casual acknowledgements, are intentionally treated as non-cacheable low-value turns. Cache lookups that remain eligible use `shared_static` context and skip RAG retrieval entirely so cached responses stay derived from stable org overview data. Entries use a 12-hour active TTL on the only live cached surface (`general`), soft-invalidate expired conflicts at write time, and are later hard-deleted by an hourly cron route that drains multiple 500-row purge batches up to 5,000 rows per run.

## File Map

### Source

| File | Purpose | Key Exports (line) |
|---|---|---|
| `src/lib/ai/semantic-cache-utils.ts` | Pure functions + centralized cache-key contract | `normalizePrompt`, `hashPrompt`, `buildPermissionScopeKey`, `buildSemanticCacheKeyParts`, `checkCacheEligibility`, `getCacheExpiresAt`, `CACHE_CONTRACT_VERSION`, `CACHE_KEY_SALT`, `CACHE_TTL_HOURS` |
| `src/lib/ai/turn-execution-policy.ts` | Internal policy gate deciding whether cache lookup/write is allowed at all | `buildTurnExecutionPolicy`, `TurnExecutionPolicy` |
| `src/lib/ai/semantic-cache.ts` | DB lookup/write via Supabase service client | `lookupSemanticCache`, `writeCacheEntry`, `CacheHit`, `CacheLookupResult`, `CacheWriteResult` |
| `src/lib/ai/sse.ts` | SSE encoding, stream factory, `CacheStatus` type | `CacheStatus` type (L1), `SSEEvent` type (L10), `encodeSSE` (L32), `createSSEStream` (L36), `SSE_HEADERS` (L25) |
| `src/lib/ai/audit.ts` | Audit logging with cache columns | `logAiRequest` (L34) — writes `cache_status`, `cache_entry_id`, `cache_bypass_reason` to `ai_audit_log` |
| `src/lib/ai/context-builder.ts` | Prompt context assembly, including `shared_static` mode for cacheable misses | `buildPromptContext` (L265), `buildSystemPrompt` (L253), `buildUntrustedOrgContextMessage` (L258) |
| `src/lib/schemas/ai-assistant.ts` | Request validation and cache alias normalization | `sendMessageSchema` (L25), `cacheEligibilitySchema` (L54) |
| `src/app/api/ai/[orgId]/chat/route.ts` | Orchestration — the POST handler wires everything together | `POST` (L25) — eligibility check, cache lookup, SSE stream, cache write on miss |
| `src/app/api/cron/ai-cache-purge/route.ts` | Hourly cron endpoint | `GET` — loops `purge_expired_ai_semantic_cache()` until a partial batch or the 5,000-row cap |

### Schema / Types

| File | Purpose |
|---|---|
| `supabase/migrations/20260321100001_ai_semantic_cache.sql` | DDL: table, indexes, purge function, RLS, audit columns |
| `src/types/database.ts` | Generated Supabase types (includes `ai_semantic_cache` row type) |

### Tests

| File | Cases | Purpose |
|---|---|---|
| `tests/ai-semantic-cache.test.ts` | expanded | Unit tests: cache-key helper, salted hashing, eligibility, TTLs, lookup, typed write results |
| `tests/ai-cache-migration-contract.test.ts` | expanded | Contract tests: migration DDL assertions, audit columns, vector extension, hourly cron schedule |
| `tests/ai-context-builder.test.ts` | 9 | Context tests: `shared_static` excludes user and mutable org data while preserving organization overview |
| `tests/routes/ai/chat.test.ts` | 11 (cache) | Route simulation: cache hit/miss/bypass flow, `DISABLE_AI_CACHE`, schema alias validation |
| `tests/routes/ai/chat-handler.test.ts` | targeted cache coverage | Casual turns skip cache entirely, cacheable static explainers still use `shared_static`, governance-document asks bypass cache as out-of-scope, miss-path writes record `cache_entry_id`, oversized miss-path writes surface skip reasons |

## Dependency Graph

```
src/app/api/ai/[orgId]/chat/route.ts  (orchestrator)
  ├── src/lib/ai/semantic-cache-utils.ts  (pure functions)
  │     └── node:crypto
  ├── src/lib/ai/semantic-cache.ts        (DB read/write)
  │     └── src/lib/ai/semantic-cache-utils.ts  (buildSemanticCacheKeyParts, getCacheExpiresAt, CacheSurface)
  ├── src/lib/ai/context-builder.ts       (shared_static vs full prompt context)
  ├── src/lib/schemas/ai-assistant.ts     (bypassCache / bypass_cache request parsing)
  ├── src/lib/ai/sse.ts                   (CacheStatus type, SSE stream)
  └── src/lib/ai/audit.ts                 (audit log with cache columns)
        └── src/lib/ai/sse.ts             (CacheStatus type)

src/app/api/cron/ai-cache-purge/route.ts  (cron)
  ├── src/lib/supabase/service.ts         (createServiceClient)
  └── src/lib/security/cron-auth.ts       (validateCronAuth)
```

## Data Flow: Request Path

```
Client POST /api/ai/{orgId}/chat
  │  { message, surface, threadId?, idempotencyKey, bypassCache?, bypass_cache? }
  │
  ├─ 1. Rate limit check (per-IP / per-user)
  ├─ 2. Auth — getAiOrgContext (validates admin role)
  ├─ 3. Validate body (sendMessageSchema normalizes bypass_cache → bypassCache)
  ├─ 4. Thread ownership check (if threadId provided)
  ├─ 5. Abandoned stream cleanup (5-min threshold)
  ├─ 6. Idempotency check (by idempotencyKey)
  ├─ 7. Upsert thread (if new conversation)
  ├─ 8. Insert user message
  │
  ├─ 8.5  BUILD EXECUTION POLICY
  │    │
  │    ├─ `static_general`  ─→ allow exact cache lookup
  │    ├─ `casual`          ─→ skip cache entirely (`casual_turn`)
  │    ├─ `follow_up`       ─→ skip cache entirely (`has_thread_context`)
  │    ├─ `live_lookup`     ─→ skip cache entirely (live-context reasons)
  │    └─ `out_of_scope`    ─→ skip cache entirely (`out_of_scope_request`)
  │
  ├─ 8.6  CACHE CHECK (if enabled + policy allows lookup_exact)
  │    │
  │    ├─ a. buildSemanticCacheKeyParts({ message, orgId, role })
  │    ├─ b. lookupSemanticCache({ cacheKey, orgId, surface })
  │    │
  │    ├─ HIT ──→ Insert assistant message (status: complete)
  │    │          Stream cached content via SSE
  │    │          Log audit (cache_status: hit_exact)
  │    │          RETURN early
  │    │
  │    ├─ MISS ─→ Set cacheStatus = "miss", continue to live path
  │    │          Set contextMode = "shared_static" (no user-specific or mutable org context)
  │    │
  │    └─ ERROR ─→ Set cacheStatus = "error", bypassReason = "cache_lookup_failed"
  │                Continue to live path with full context
  │
  ├─ 8.7  RAG RETRIEVAL
  │    │
  │    ├─ casual / static_general / out_of_scope skip retrieval
  │    └─ follow_up / live_lookup may retrieve additive chunks (non-blocking)
  │
  ├─ 9. Insert assistant placeholder (status: pending)
  ├─ 10. Build prompt context + fetch history (parallel)
  ├─ 11. Stream LLM response via SSE
  │      └─ SSE done event always includes `cache` metadata
  ├─ 12. Finalize assistant message
  │      └─ If stream or finalize fails, assistant row ends as `error` and no cache write occurs
  │
  └─ 12.5  CACHE WRITE (if miss + stream succeeded + finalize succeeded)
       │
       ├─ a. Invalidate expired conflicting rows (invalidation_reason: replaced_after_expiry)
       ├─ b. Insert new cache row with surface-specific TTL
       ├─ c. Return `inserted`, `duplicate`, `skipped_too_large`, or `error`
       └─ d. If inserted, audit log stores the new `cache_entry_id`
```

## Data Flow: Purge Path

```
Vercel Cron (hourly)
  │
  ├─ 1. GET /api/cron/ai-cache-purge
  ├─ 2. validateCronAuth(request) — CRON_SECRET header check
  ├─ 3. createServiceClient() — service_role Supabase client
  ├─ 4. Loop: supabase.rpc("purge_expired_ai_semantic_cache")
  │       │
  │       ├─ Each RPC deletes up to 500 rows where:
  │       │   expires_at < now() - 1 day
  │       │   OR (invalidated_at IS NOT NULL AND invalidated_at < now() - 1 day)
  │       ├─ Stop when a batch deletes < 500 rows
  │       └─ Hard cap the route at 5,000 rows per invocation
  │
  └─ 5. Returns { ok: true, deletedCount, batches, capped }
```

## Schema

### Table: `ai_semantic_cache`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `org_id` | `uuid` | NOT NULL, FK → `organizations(id)` ON DELETE CASCADE |
| `surface` | `text` | NOT NULL, CHECK IN (`general`, `members`, `analytics`, `events`) |
| `permission_scope_key` | `text` | NOT NULL |
| `cache_version` | `integer` | NOT NULL |
| `prompt_normalized` | `text` | NOT NULL |
| `prompt_hash` | `text` | NOT NULL |
| `response_content` | `text` | NOT NULL, CHECK `char_length <= 16000` |
| `source_message_id` | `uuid` | FK → `ai_messages(id)` ON DELETE SET NULL |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT `now()` |
| `expires_at` | `timestamptz` | NOT NULL |
| `invalidated_at` | `timestamptz` | nullable |
| `invalidation_reason` | `text` | CHECK `char_length <= 500` |

### Indexes

| Index | Columns | Condition | Purpose |
|---|---|---|---|
| `idx_ai_semantic_cache_unique_key` (UNIQUE) | `(org_id, surface, permission_scope_key, cache_version, prompt_hash)` | `WHERE invalidated_at IS NULL` | Exact lookup + concurrent-write dedup |
| `idx_ai_semantic_cache_expiry` | `(expires_at)` | `WHERE invalidated_at IS NULL` | TTL filtering on lookups |
| `idx_ai_semantic_cache_invalidated_at` | `(invalidated_at)` | `WHERE invalidated_at IS NOT NULL` | Purge scan optimization |

### RLS

RLS enabled, **no policies** — service-role only access. The `service_role` key bypasses RLS by design.

### RPC: `purge_expired_ai_semantic_cache()`

- `SECURITY DEFINER`, `search_path = public`
- Granted to `service_role` only (revoked from `PUBLIC`, `anon`, `authenticated`)
- Deletes up to 500 rows per call (expired > 1 day or invalidated > 1 day)
- The route may call it multiple times in one request, but the function itself remains a bounded 500-row unit of work

### Audit columns added to `ai_audit_log`

| Column | Type |
|---|---|
| `cache_status` | `text` |
| `cache_entry_id` | `uuid` |
| `cache_bypass_reason` | `text` |

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DISABLE_AI_CACHE` | `undefined` | Set to `"true"` to disable cache (kill switch). Checked in route handler (L31). |
| `ZAI_API_KEY` | (required) | LLM provider key — if unset, returns config-error message (no cache write attempted) |
| `CRON_SECRET` | (required) | Auth header for cron purge endpoint |

### TTLs (in `CACHE_TTL_HOURS`)

| Surface | TTL |
|---|---|
| `general` | 12 hours |
| `members` | 4 hours (future-facing; not cache-eligible in v1) |
| `analytics` | 2 hours (future-facing; not cache-eligible in v1) |
| `events` | 4 hours (future-facing; not cache-eligible in v1) |

### Cache Version

`CACHE_CONTRACT_VERSION = 3` is the single manual invalidation knob. It is applied via both `cache_version` and the salted prompt hash contract (`CACHE_KEY_SALT`). Bump it whenever prompt construction, cache-key derivation, or freshness semantics change enough that serving old rows would be unsafe.

### Ineligibility Markers

Prompts containing these word-boundary patterns are excluded from caching:

- **Temporal**: today, latest, current, current date, current time, upcoming, recent, this week, this month, right now, new, recently, last, yesterday, tomorrow, now, what date is it, what time is it, what day is it
- **Personalization**: my, mine, i am, i'm, me, myself
- **Live org context**: member(s), alumni, parent(s), event(s), announcement(s), donation(s), stat(s), count(s), total(s), roster, attendance
- **Write/tool**: create, delete, remove, update, edit, change, add, send, post, submit, pay, donate, schedule, cancel

Additional ineligibility from the pure helper: non-`general` surfaces, messages with `threadId`, messages < 5 or > 2000 chars, explicit `bypassCache: true` or `bypass_cache: true`.

## Freshness Rules

- Only a subset of `general` first-turn prompts are cache-looked-up in v1.
- Casual acknowledgements are intentionally non-cacheable via the execution policy even if they pass pure cache-safety checks.
- Narrow governance-document requests are intentionally non-cacheable via the execution policy (`out_of_scope_request`).
- Cache-eligible prompts **skip RAG retrieval entirely** to avoid caching responses derived from mutable retrieved chunks.
- Cache misses that remain eligible use `shared_static` context only: organization overview without current user or mutable org data.
- Write results do not change request-level `cache_status`; they enrich audit metadata via `cache_entry_id` on insert or `cache_bypass_reason` on duplicate / skip / error.

## Test Coverage

| Test File | What It Covers |
|---|---|
| `tests/ai-semantic-cache.test.ts` | Salted hashing, cache-key helper output, eligibility rules, 12h general TTL, lookup behavior, and typed write results (`inserted`, `duplicate`, `skipped_too_large`, `error`). |
| `tests/ai-cache-migration-contract.test.ts` | RLS enabled, no user-facing policies, unique index columns, expiry index, invalidated_at index, purge function exists, search_path lock, role grants, batch limit, audit columns (3), vector extension, response_content constraint, hourly `vercel.json` cron schedule. |
| `tests/ai-context-builder.test.ts` (9 cases) | Context construction coverage, including `shared_static` mode omitting current user, counts, events, announcements, and donation sections while preserving organization overview. |
| `tests/routes/ai/chat.test.ts` (11 cache cases) | End-to-end simulation: cache hit returns cached content, miss falls through to live path + write, bypass-request handling, threadId bypass, temporal marker bypass, non-general surface ineligible, `DISABLE_AI_CACHE=true` disablement, write-after-miss-then-hit round-trip, `bypass_cache` schema alias normalization, mismatched alias rejection. |
| `tests/routes/ai/chat-handler.test.ts` | Handler coverage for cache-eligible turns skipping RAG, miss-path inserted `cache_entry_id`, and oversize skip metadata. |
