---
title: "AI FAQ/RAG System Hardening: Security, Correctness & Performance"
category: security-issues
date: 2026-03-22
tags:
  - race-condition
  - multi-tenant-security
  - transaction-atomicity
  - database-locking
  - concurrency-control
  - fail-closed-design
  - idempotency
  - rls-hardening
  - n-plus-1-query
  - stream-cancellation
  - embedding-worker
  - rag-system
severity: high
component: ai-rag-system
subsystem:
  - embedding-worker
  - chat-handler
  - database-schema
  - sse-streaming
commit: 010f7b41
issues_addressed: 15
---

# AI FAQ/RAG System Hardening

A Codex code review surfaced 15 issues (6 high, 7 medium, 2 low) across the AI FAQ/RAG assistant system spanning security, correctness, and performance. All were fixed in a single commit with a new migration, 4 new RPCs, and comprehensive test coverage.

## Problem

The RAG system had systemic gaps:

- **Security**: RLS policies on `ai_threads` only checked `user_id = auth.uid()` with no org membership verification. Idempotency keys were globally unique (cross-tenant collision risk). Exclusion lookup failures silently proceeded (fail-open).
- **Correctness**: Queue dequeue had no row-level locking (concurrent cron workers double-processed). Chunk replacement was non-atomic (partial failure = data loss). Retry increment used read-modify-write (race-prone). Chat init was 3 separate writes (orphaned records on failure).
- **Performance**: Per-item chunk-hash lookups (N+1 queries). Every row UPDATE triggered embedding enqueue regardless of content change. Exact counts on hot-path queries.

## Root Cause Analysis

The issues fell into 5 anti-pattern categories:

1. **Fail-open security defaults** -- When exclusion fetch failed, the worker assumed "nothing excluded" and indexed everything. RLS checked identity but not org membership.
2. **Application-level coordination instead of database-native** -- Multi-step operations (chunk replace, chat init, retry increment) relied on sequential client calls instead of transactional RPCs.
3. **Missing concurrency control** -- Plain `SELECT WHERE processed_at IS NULL` for queue dequeue allowed duplicate processing by concurrent workers.
4. **Loop-per-item queries** -- Each queue item triggered its own hash lookup query, scaling linearly with batch size.
5. **Over-eager triggers** -- Every UPDATE fired the embedding trigger, even for non-content field changes.

## Solution

### Core Pattern: Shift to Database-Native Coordination

The fix replaces application-level coordination with atomic RPCs, database constraints, and row-level locking throughout.

**Migration**: `supabase/migrations/20260712000000_ai_rag_hardening.sql`

### Security Fixes (HIGH)

**1. RLS: Org membership check on `ai_threads`**

Added `EXISTS` subquery to INSERT/UPDATE policies verifying `user_organization_roles` membership:

```sql
CREATE POLICY "Users can insert own threads"
  ON public.ai_threads FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_organization_roles
      WHERE user_id = auth.uid()
        AND organization_id = ai_threads.org_id
        AND deleted_at IS NULL
    )
  );
```

**2. Scoped idempotency key uniqueness**

Replaced global unique index with `(org_id, user_id, idempotency_key)` scoped partial index.

**3. Fail-closed exclusion handling**

`fetchExclusions()` returns `null` on error. Caller skips entire org when `null`:

```typescript
async function fetchExclusions(supabase, orgId): Promise<Set<string> | null> {
  const { data, error } = await supabase.from("ai_indexing_exclusions")...;
  if (error || !data) return null; // fail-closed
  // build and return Set
}
// Caller:
if (!exclusions) {
  await incrementAttempts(supabase, item.id, "exclusion_fetch_failed");
  continue; // skip this org entirely
}
```

### Correctness Fixes (HIGH)

**4. Queue dequeue with `FOR UPDATE SKIP LOCKED`**

New RPC `dequeue_ai_embeddings()` atomically claims items:

```sql
CREATE OR REPLACE FUNCTION public.dequeue_ai_embeddings(p_batch_size int DEFAULT 50)
RETURNS SETOF public.ai_embedding_queue
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.ai_embedding_queue
  SET processed_at = now()
  WHERE id IN (
    SELECT id FROM public.ai_embedding_queue
    WHERE processed_at IS NULL AND attempts < 3
    ORDER BY created_at ASC LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ) RETURNING *;
$$;
```

**5. Atomic chunk replacement**

New RPC `replace_ai_chunks()` soft-deletes old + inserts new in one transaction:

```sql
CREATE OR REPLACE FUNCTION public.replace_ai_chunks(
  p_org_id uuid, p_source_table text, p_source_id uuid, p_chunks jsonb
) RETURNS void LANGUAGE plpgsql ...
AS $$
BEGIN
  UPDATE public.ai_document_chunks SET deleted_at = now()
  WHERE org_id = p_org_id AND source_table = p_source_table
    AND source_id = p_source_id AND deleted_at IS NULL;

  INSERT INTO public.ai_document_chunks (...)
  SELECT ... FROM jsonb_array_elements(p_chunks) AS c;
END; $$;
```

**6. Atomic retry increment**

New RPC `increment_ai_queue_attempts()` replaces read-modify-write:

```sql
UPDATE public.ai_embedding_queue
SET attempts = attempts + 1, error = left(p_error, 500), processed_at = NULL
WHERE id = p_id;
```

**7. Transactional chat init**

New RPC `init_ai_chat()` creates/reuses thread + inserts user message atomically. Replaces 3 separate writes in `handler.ts`.

**8. Full answer replay on idempotency hit**

When duplicate request arrives, fetches assistant message content and re-streams via SSE (previously only sent `done` event without content).

**9. Stale chunk cleanup + orphan detection**

When `chunks.length === 0` (content too short), soft-deletes existing chunks. When chunk count shrinks, detects orphaned indexes not present in new render.

### Correctness Fixes (MEDIUM)

**10. Queue dedupe index**: Partial unique `(org_id, source_table, source_id) WHERE processed_at IS NULL` with `ON CONFLICT DO NOTHING` in triggers.

**11. Smart triggers**: `enqueue_ai_embedding()` checks `IS NOT DISTINCT FROM` on `title`, `body`, `description`, `audience` before enqueuing.

**12. SSE cancellation**: `createSSEStream()` accepts `AbortSignal`, propagates to generator via `cancel()` callback. Handler passes `request.signal`.

### Performance Fixes (MEDIUM)

**13. Batch chunk-hash lookups**: `batchFetchExistingHashes()` fetches all hashes per (org, table) in one query instead of per-item.

**14. Estimated counts**: Context builder uses `count: "estimated"` instead of `count: "exact"` for member/alumni/parent counts.

### Low Severity

**15. Broader audit redaction**: Added patterns for Gemini keys (`AIza*`), Supabase keys (`sbp_*`), JWTs (`eyJ*`).

## Files Changed

| File | Changes |
|------|---------|
| `supabase/migrations/20260712000000_ai_rag_hardening.sql` | **NEW** -- 6 RPCs, 2 RLS policies, 2 indexes |
| `src/lib/ai/embedding-worker.ts` | Fail-closed exclusions, dequeue RPC, batch hashes, atomic replace |
| `src/app/api/ai/[orgId]/chat/handler.ts` | Full replay, transactional init, SSE abort |
| `src/lib/ai/sse.ts` | AbortSignal support |
| `src/lib/ai/audit.ts` | Broader redaction |
| `src/lib/ai/context-builder.ts` | Estimated counts |
| `tests/ai-embedding-worker-integration.test.ts` | **NEW** -- 10 tests |
| `tests/ai-sse-cancellation.test.ts` | **NEW** -- 8 tests |
| `tests/ai-cron-routes.test.ts` | **NEW** -- 10 tests |

## Prevention Strategies

### Checklist for Future AI/RAG Features

**Before writing code:**
- [ ] Map all multi-step DB operations -- wrap in PL/pgSQL RPC
- [ ] Scope all unique constraints to `(org_id, ...)`
- [ ] Plan exclusion/deny-list mechanism upfront
- [ ] Identify shared queues -- design with `FOR UPDATE SKIP LOCKED`

**During implementation:**
- [ ] All queue dequeueing via RPC with row-level locking
- [ ] All multi-write operations wrapped in transactional RPC
- [ ] Trigger functions check content-column changes only
- [ ] Batch fetches grouped by (org, table) to avoid N+1
- [ ] Error messages truncated; no content/secrets logged
- [ ] Exclusions checked fail-closed (`null` = skip, not continue)
- [ ] RLS enforces org membership + user ownership (both)
- [ ] Content hash computed for deduplication

**Testing:**
- [ ] Verify fail-closed: exclusion errors skip org, not fail-open
- [ ] Verify dequeue uses RPC (spy on `rpcCalls`)
- [ ] Verify retry uses atomic increment RPC
- [ ] Verify orphaned chunks detected on content shrink
- [ ] Verify content hash deterministic across renders
- [ ] Verify SSE cancellation propagates AbortSignal

### Key Test Patterns Established

1. **Chainable Supabase mock** (`createChainableMock()`) -- fully fluent `.from().select().eq().in()` chain with `rpcCalls` spy array
2. **Fail-closed assertion** -- `assert.equal(stats.failed, 1)` when exclusions fail
3. **RPC call spy** -- `mock.rpcCalls.find(c => c.fn === "dequeue_ai_embeddings")`
4. **Orphan detection** -- compare `existingHashes.keys()` against `newChunkIndexes`
5. **SSE abort test** -- `reader.cancel()` then verify `signal.aborted`
6. **Loop termination** -- verify cron stops after first empty batch

### Anti-Pattern Summary

| Anti-Pattern | Fix Pattern |
|-------------|-------------|
| Fail-open security | Return `null` on error, caller skips |
| Read-modify-write | Atomic SQL: `SET x = x + 1` |
| Sequential client writes | Transactional RPC |
| Plain SELECT for dequeue | `FOR UPDATE SKIP LOCKED` |
| Per-item hash lookup | Batch fetch per (org, table) |
| Trigger on every UPDATE | `IS NOT DISTINCT FROM` checks |
| Global unique constraint | Scope to `(org_id, user_id, ...)` |

## RPC Conventions (auto memory [claude])

All new RPCs follow established project conventions:
- `SECURITY DEFINER` with `SET search_path = ''`
- Permissions: `REVOKE FROM PUBLIC, anon, authenticated; GRANT TO service_role`
- Return `jsonb` for structured results, `void` for side-effect-only
- Error truncation: `left(p_error, 500)`
