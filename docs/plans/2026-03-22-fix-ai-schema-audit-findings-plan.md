---
title: "fix: AI schema audit findings — error handling, migration ordering, pagination, updated_at"
type: fix
status: active
date: 2026-03-22
---

# Fix: AI Schema Audit Findings

## Overview

Address 5 validated findings from an adversarial-reviewed AI schema audit. Three Codex reviewers (Skeptic, Architect, Minimalist) confirmed these as real issues. Fixes are ordered by impact and dependency.

## Problem Statement

The AI assistant feature has several correctness and hygiene issues discovered during a schema audit:

1. **Silent error swallowing** in chat route — violates the project's "fail closed" convention (documented in MEMORY.md)
2. **Migration timestamp collision** — two migrations share `20260321100000`, causing stale type generation
3. **Broken cursor pagination** — sorts by `updated_at` but cursors by `id`
4. **`updated_at` never maintained** on `ai_threads` — thread list recency is meaningless
5. **Cross-org idempotency key** — global unique index, consistent with payment system but worth documenting

## Implementation Phases

### Phase 1: Error Handling in `chat/route.ts` (No dependencies)

**Files:** `src/app/api/ai/[orgId]/chat/route.ts`

#### 1a. Idempotency check (line ~118)

**Current:**
```typescript
const { data: existingMsg } = await ctx.supabase
  .from("ai_messages")
  .select("id, status, thread_id")
  .eq("idempotency_key", idempotencyKey)
  .maybeSingle();
```

**Fix:** Destructure `error`, return 500 on failure.
```typescript
const { data: existingMsg, error: idempError } = await ctx.supabase
  .from("ai_messages")
  .select("id, status, thread_id")
  .eq("idempotency_key", idempotencyKey)
  .maybeSingle();

if (idempError) {
  console.error("[ai-chat] idempotency check failed:", idempError);
  return NextResponse.json({ error: "Failed to check message idempotency" }, { status: 500 });
}
```

**Why not service client:** The auth-bound client is correct here — RLS scoping prevents a user from seeing another user's messages. Using `serviceSupabase` would leak cross-user state. The soft-deleted thread edge case (where RLS hides a message in a deleted thread) is acceptable — replaying into a deleted thread is a no-op.

#### 1b. History fetch (line ~332)

**Critical context:** This code runs inside `createSSEStream(async (enqueue) => {...})`. You **cannot** return `NextResponse.json(...)` from inside the stream callback — it's a void async function.

**Fix:** Destructure `error`, enqueue an error SSE event, and return early (triggering the `finally` block which updates the assistant message to `error` status).

```typescript
const [{ systemPrompt, orgContextMessage }, { data: history, error: historyError }] =
  await Promise.all([...]);

if (historyError) {
  console.error("[ai-chat] history fetch failed:", historyError);
  enqueue({ type: "error", message: "Failed to load conversation history", retryable: true });
  return;
}
```

#### 1c. Abandoned-stream cleanup (line ~108)

**Fix:** Log the error, treat as non-fatal.
```typescript
const { error: cleanupError } = await ctx.supabase
  .from("ai_messages")
  .update({ status: "error" })
  ...;

if (cleanupError) {
  console.error("[ai-chat] abandoned stream cleanup failed:", cleanupError);
}
```

#### Tests

- Update `tests/routes/ai/chat.test.ts` to add cases for:
  - Idempotency query returning error → expect 500
  - History fetch returning error → expect SSE error event
  - Verify abandoned-stream cleanup error is non-fatal

---

### Phase 2: Migration Timestamp Fix + Type Regeneration (No dependencies)

**Decision:** Rename `ai_semantic_cache.sql` from `100000` to `100001`. `architecture_fixes.sql` stays at `100000` because `fix_ai_messages_rls_integrity.sql` (at `110000`) depends on it running first. The two `100000` migrations are independent of each other, but giving `architecture_fixes` the earlier slot is safer since it has a downstream dependency.

**Pre-check required:** Run `supabase migration list` to verify whether the migration has been applied remotely.

**If NOT applied remotely:**
```bash
mv supabase/migrations/20260321100000_ai_semantic_cache.sql \
   supabase/migrations/20260321100001_ai_semantic_cache.sql
```

**If ALREADY applied remotely:**
Do NOT rename. Instead, document the collision as a known issue in `docs/db/schema-audit.md` and proceed with type regeneration only. The collision is benign in practice (no ordering dependency between the two files).

**Type regeneration:**
```bash
npm run gen:types
```

**Prerequisite:** The AI migrations (including `architecture_fixes`) must be applied to the remote Supabase project before `gen:types` will produce correct output. If the migrations haven't been pushed yet, run `supabase db push` first.

This will add `user_id` and `org_id` to the `ai_messages` Row/Insert/Update types and update the FK relationship name from `ai_messages_thread_id_fkey` to `ai_messages_thread_owner_fkey`.

**Validation:** After regeneration, verify the AI route files still compile:
```bash
npx tsc --noEmit src/app/api/ai/[orgId]/chat/route.ts
```

Note: The AI context module (`src/lib/ai/context.ts`) currently uses `any` typed clients. This is a pre-existing issue and out of scope for this fix — but once types are regenerated, the `any` casts will no longer be necessary for the `user_id`/`org_id` fields.

---

### Phase 3: `updated_at` Trigger on `ai_threads` (Must run before Phase 4)

**New migration:** `supabase/migrations/20260322000000_ai_threads_updated_at_trigger.sql`

```sql
-- Attach the existing updated_at trigger to ai_threads
-- The function update_updated_at_column() is defined in 20251215000000_embeds_fix_and_approvals.sql
DROP TRIGGER IF EXISTS ai_threads_updated_at ON public.ai_threads;
CREATE TRIGGER ai_threads_updated_at
  BEFORE UPDATE ON public.ai_threads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
```

**Application code change:** Add an explicit `UPDATE` to `ai_threads` in `chat/route.ts` after inserting the user message, so the trigger fires:

```typescript
// After user message insert succeeds (line ~185)
// Bump thread updated_at (trigger handles the timestamp)
await ctx.supabase
  .from("ai_threads")
  .update({ updated_at: new Date().toISOString() })
  .eq("id", threadId);
```

**Why explicit UPDATE + trigger?** The trigger only fires on `UPDATE` to `ai_threads`. Since inserting a message is an `INSERT` on `ai_messages`, the thread is not automatically touched. The explicit UPDATE ensures the trigger fires. The trigger overrides the passed `updated_at` with `now()` — the explicit value is just a TypeScript requirement (you must pass at least one field to `.update()`).

**Assumption:** One extra UPDATE per message send is negligible latency. This is a single-row primary-key lookup — sub-millisecond.

**Why not an INSERT trigger on `ai_messages`?** That would couple the tables at the database level. The application-level update is more explicit and testable.

**Error handling:** This update is non-critical — if it fails, the message was still sent. Log the error but don't fail the request:
```typescript
const { error: touchError } = await ctx.supabase...
if (touchError) {
  console.error("[ai-chat] failed to touch thread updated_at:", touchError);
}
```

#### Tests

- Add a test verifying that sending a message updates the thread's `updated_at`
- Add a test verifying that the trigger fires on any `ai_threads` UPDATE

---

### Phase 4: Fix Cursor Pagination in Threads Route (Depends on Phase 3)

**Files:**
- `src/app/api/ai/[orgId]/threads/route.ts`
- `src/lib/schemas/ai-assistant.ts`

#### 4a. Schema change

**Current:** `cursor: z.string().uuid().optional()`
**New:** `cursor: z.string().optional()` (base64url-encoded composite cursor, not a UUID)

#### 4b. Sort field change

Switch from `updated_at` to `created_at` ordering. This aligns with the `cursor.ts` helper which hardcodes `created_at` in its filter.

**Open decision — `created_at` vs `updated_at` sort:**

Phase 3 makes `updated_at` meaningful, but this phase switches the sort to `created_at`. These work against each other. Two options:

- **Option A (recommended): Sort by `created_at`.** Reuse existing `cursor.ts` helper as-is. Thread creation order is stable and predictable. `updated_at` remains useful for future features (e.g., "recently active" filter) but doesn't drive the default list. Simpler.

- **Option B: Sort by `updated_at`.** Build a custom composite cursor for `(updated_at, id)` — either extend `cursor.ts` to accept a configurable sort field, or write a one-off OR filter. Shows most-recently-active threads first. More useful UX, but adds cursor complexity and a covering index (`user_id, org_id, updated_at DESC WHERE deleted_at IS NULL`).

**Current choice: Option A.** If the user prefers recency-sorted threads, switch to Option B — the trigger from Phase 3 ensures `updated_at` is always fresh.

#### 4c. Route implementation

```typescript
import { decodeCursor, applyCursorFilter, buildCursorResponse } from "@/lib/pagination/cursor";

// Parse cursor
const decoded = cursor ? decodeCursor(cursor) : null;
if (cursor && !decoded) {
  return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
}

// Build query
let query = supabase
  .from("ai_threads")
  .select("*")
  .eq("org_id", orgId)
  .order("created_at", { ascending: false })
  .order("id", { ascending: false })
  .limit(limit + 1);  // +1 for hasMore detection

if (surface) query = query.eq("surface", surface);
if (decoded) query = applyCursorFilter(query, decoded);

const { data, error } = await query;
// ... error handling ...

const result = buildCursorResponse(data ?? [], limit);
return NextResponse.json(result);
```

#### 4d. Response shape change

**Current:** `{ threads: [...] }`
**New:** `{ data: [...], nextCursor: string | null, hasMore: boolean }`

**Client update required:** `src/components/ai-assistant/AIPanel.tsx` line ~42 reads `response.threads`. Update to `response.data`.

#### Tests

- Update `tests/routes/ai/threads.test.ts`:
  - Test first page returns correct `hasMore` and `nextCursor`
  - Test second page with cursor returns correct results
  - Test invalid cursor returns 400
  - Test empty results returns `{ data: [], nextCursor: null, hasMore: false }`

---

### Phase 5: Document Cross-Org Idempotency Decision (No code change)

**Decision: No change.** The global unique index on `idempotency_key` is consistent with the payment system pattern. The theoretical UUID collision risk (two users generating the same UUIDv4) is ~1 in 2^122 — not worth a schema change.

**Acknowledgment:** If a collision occurs, User B gets a 500 on INSERT (unique violation), not data leakage. This is acceptable.

**Action:** Document in `docs/db/schema-audit.md` under the AI section's "Known Intentional Divergences" block. Do not modify the applied migration file.

---

## System-Wide Impact

- **Error propagation:** Fix 1 changes silent degradation to explicit failure for two query paths. No downstream retry logic exists — clients will see error SSE events and can retry.
- **API surface:** Fix 4 changes the threads list response shape from `{ threads }` to `{ data, nextCursor, hasMore }`. Only consumer is `AIPanel.tsx`.
- **State lifecycle:** Fix 3+5 make `updated_at` meaningful on `ai_threads`. No other code reads this field besides the thread list sort.
- **Migration safety:** Fix 2 is a file rename (if not yet applied remotely) or a documentation update (if already applied).

## Acceptance Criteria

- [ ] All Supabase queries in `chat/route.ts` destructure and handle `error`
- [ ] History fetch failure enqueues SSE error event (not HTTP 500)
- [ ] Migration timestamps are unique (or collision documented if already applied)
- [ ] `npm run gen:types` produces types with `user_id`/`org_id` on `ai_messages`
- [ ] `ai_threads.updated_at` is maintained by trigger on every UPDATE
- [ ] Sending a message bumps thread's `updated_at`
- [ ] Thread list uses composite cursor pagination with `created_at` sort
- [ ] Invalid cursor returns 400
- [ ] `AIPanel.tsx` reads `response.data` instead of `response.threads`
- [ ] Cross-org idempotency decision documented
- [ ] All existing tests pass
- [ ] New tests added for error paths and cursor pagination

## Dependencies & Risks

| Risk | Mitigation |
|------|-----------|
| Migration rename breaks remote DB | Pre-check with `supabase migration list`; skip rename if already applied |
| Response shape change breaks frontend | Only one consumer (`AIPanel.tsx`); update in same PR |
| `updated_at` trigger + manual update race | Trigger always wins (BEFORE UPDATE); manual value is overwritten — this is correct |
| `cursor.ts` helper hardcodes `created_at` | Switching sort to `created_at` avoids needing a custom helper |

## Sources & References

- **Adversarial review:** 3 Codex reviewers (Skeptic, Architect, Minimalist) validated findings
- **Error handling pattern:** `src/app/api/discussions/route.ts` — canonical `{ data, error }` destructuring
- **Cursor pagination:** `src/lib/pagination/cursor.ts` — existing composite cursor helper
- **updated_at trigger:** `supabase/migrations/20251215000000_embeds_fix_and_approvals.sql` — `update_updated_at_column()` function
- **Payment idempotency:** `src/lib/payments/idempotency.ts` — global unique key pattern
- **MEMORY.md:** "Silent Supabase errors" and "Always fail closed" learnings
