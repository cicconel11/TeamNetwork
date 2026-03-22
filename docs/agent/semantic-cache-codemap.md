# Semantic Cache — Code Map

## Overview

The AI semantic cache deduplicates identical AI responses by normalizing user prompts, hashing them (SHA-256), and storing the assistant's response keyed by `(org_id, surface, permission_scope_key, cache_version, prompt_hash)`. On subsequent requests with the same key, the cached response is replayed as an SSE stream without calling the LLM. Entries have surface-specific TTLs, expired conflicts are soft-invalidated at write time, and old expired/invalidated rows are later hard-deleted by a daily cron purge.

## File Map

### Source

| File | Purpose | Key Exports (line) |
|---|---|---|
| `src/lib/ai/semantic-cache-utils.ts` | Pure functions — normalize, hash, eligibility checks, TTL | `normalizePrompt` (L128), `hashPrompt` (L140), `buildPermissionScopeKey` (L152), `checkCacheEligibility` (L159), `getCacheExpiresAt` (L207), `CACHE_SURFACES` (L7), `CACHE_VERSION` (L10), `CACHE_TTL_HOURS` (L13) |
| `src/lib/ai/semantic-cache.ts` | DB read/write via Supabase service client | `lookupSemanticCache` (L30), `writeCacheEntry` (L78), `CacheHit` type (L15), `CacheLookupResult` type (L22) |
| `src/lib/ai/sse.ts` | SSE encoding, stream factory, `CacheStatus` type | `CacheStatus` type (L1), `SSEEvent` type (L10), `encodeSSE` (L32), `createSSEStream` (L36), `SSE_HEADERS` (L25) |
| `src/lib/ai/audit.ts` | Audit logging with cache columns | `logAiRequest` (L34) — writes `cache_status`, `cache_entry_id`, `cache_bypass_reason` to `ai_audit_log` |
| `src/lib/ai/context-builder.ts` | Prompt context assembly, including `shared_static` mode for cacheable misses | `buildPromptContext` (L265), `buildSystemPrompt` (L253), `buildUntrustedOrgContextMessage` (L258) |
| `src/lib/schemas/ai-assistant.ts` | Request validation and cache alias normalization | `sendMessageSchema` (L25), `cacheEligibilitySchema` (L54) |
| `src/app/api/ai/[orgId]/chat/route.ts` | Orchestration — the POST handler wires everything together | `POST` (L25) — eligibility check, cache lookup, SSE stream, cache write on miss |
| `src/app/api/cron/ai-cache-purge/route.ts` | Daily cron endpoint | `GET` (L11) — calls `purge_expired_ai_semantic_cache()` RPC |

### Schema / Types

| File | Purpose |
|---|---|
| `supabase/migrations/20260321100001_ai_semantic_cache.sql` | DDL: table, indexes, purge function, RLS, audit columns |
| `src/types/database.ts` | Generated Supabase types (includes `ai_semantic_cache` row type) |

### Tests

| File | Cases | Purpose |
|---|---|---|
| `tests/ai-semantic-cache.test.ts` | 43 | Unit tests: `normalizePrompt`, `hashPrompt`, `buildPermissionScopeKey`, `checkCacheEligibility`, `getCacheExpiresAt`, `lookupSemanticCache`, `writeCacheEntry` |
| `tests/ai-cache-migration-contract.test.ts` | 15 | Contract tests: migration DDL assertions (RLS, indexes, purge fn, audit columns, vector extension, cron schedule) |
| `tests/ai-context-builder.test.ts` | 9 | Context tests: `shared_static` excludes user and mutable org data while preserving organization overview |
| `tests/routes/ai/chat.test.ts` | 11 (cache) | Route simulation: cache hit/miss/bypass flow, `DISABLE_AI_CACHE`, schema alias validation |

## Dependency Graph

```
src/app/api/ai/[orgId]/chat/route.ts  (orchestrator)
  ├── src/lib/ai/semantic-cache-utils.ts  (pure functions)
  │     └── node:crypto
  ├── src/lib/ai/semantic-cache.ts        (DB read/write)
  │     └── src/lib/ai/semantic-cache-utils.ts  (CACHE_VERSION, getCacheExpiresAt, CacheSurface)
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
  ├─ 8.5  CACHE CHECK (if enabled + eligible)
  │    │
  │    ├─ a. normalizePrompt(message)
  │    ├─ b. hashPrompt(normalized) → promptHash
  │    ├─ c. buildPermissionScopeKey(orgId, role)
  │    ├─ d. lookupSemanticCache({ promptHash, orgId, surface, permissionScopeKey })
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
       └─ c. Unique constraint (23505) silently ignored on concurrent writes
```

## Data Flow: Purge Path

```
Vercel Cron (daily at 05:00 UTC)
  │
  ├─ 1. GET /api/cron/ai-cache-purge
  ├─ 2. validateCronAuth(request) — CRON_SECRET header check
  ├─ 3. createServiceClient() — service_role Supabase client
  ├─ 4. supabase.rpc("purge_expired_ai_semantic_cache")
  │       │
  │       ├─ Deletes rows where:
  │       │   expires_at < now() - 1 day
  │       │   OR (invalidated_at IS NOT NULL AND invalidated_at < now() - 1 day)
  │       ├─ Ordered by COALESCE(invalidated_at, expires_at)
  │       └─ LIMIT 500 per invocation (bounded work)
  │
  └─ 5. Returns { ok: true, deletedCount: N }
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
| `general` | 24 hours |
| `members` | 4 hours |
| `analytics` | 2 hours |
| `events` | 4 hours |

### Cache Version

`CACHE_VERSION = 1` — incrementing this value effectively invalidates all existing entries (they won't match on lookup).

### Ineligibility Markers

Prompts containing these word-boundary patterns are excluded from caching:

- **Temporal**: today, latest, current, upcoming, recent, this week, this month, right now, new, recently, last, yesterday, tomorrow, now
- **Personalization**: my, mine, i am, i'm, me, myself
- **Live org context**: member(s), alumni, parent(s), event(s), announcement(s), donation(s), stat(s), count(s), total(s), roster, attendance
- **Write/tool**: create, delete, remove, update, edit, change, add, send, post, submit, pay, donate, schedule, cancel

Additional ineligibility: non-`general` surfaces, messages with `threadId`, messages < 5 or > 2000 chars, explicit `bypassCache: true` or `bypass_cache: true`.

## Test Coverage

| Test File | What It Covers |
|---|---|
| `tests/ai-semantic-cache.test.ts` (43 cases) | `normalizePrompt` (7): lowercasing, whitespace collapse, zero-width strip, NFC, trim. `hashPrompt` (3): determinism, uniqueness, SHA-256 format. `buildPermissionScopeKey` (4): determinism, org/role isolation, format. `checkCacheEligibility` (14): cacheable, bypass, unsupported surface, threadId, short/long, boundary length, temporal, latest, personalization, live context, write markers (create/delete/send), word boundary (renew, historical). `getCacheExpiresAt` (4): ISO validity, general/analytics/members TTL accuracy. `lookupSemanticCache` (3): hit, miss, error. `writeCacheEntry` (6): correct row, invalidation, oversize skip, unique violation, other errors, boundary 16000. |
| `tests/ai-cache-migration-contract.test.ts` (15 cases) | RLS enabled, no user-facing policies, unique index columns, expiry index, invalidated_at index, purge function exists, search_path lock, role grants, batch limit, audit columns (3), vector extension, response_content constraint, vercel.json cron schedule. |
| `tests/ai-context-builder.test.ts` (9 cases) | Context construction coverage, including `shared_static` mode omitting current user, counts, events, announcements, and donation sections while preserving organization overview. |
| `tests/routes/ai/chat.test.ts` (11 cache cases) | End-to-end simulation: cache hit returns cached content, miss falls through to live path + write, bypass-request handling, threadId bypass, temporal marker bypass, non-general surface ineligible, `DISABLE_AI_CACHE=true` disablement, write-after-miss-then-hit round-trip, `bypass_cache` schema alias normalization, mismatched alias rejection. |
