---
title: "fix: AI confirm handler race condition, error handling, and pipeline correctness"
type: fix
status: active
date: 2026-03-27
---

# Fix: AI Confirm Handler Race Condition, Error Handling, and Pipeline Correctness

## Overview

The AI assistant's confirmation-gated write flow has a TOCTOU race condition that can create duplicate entities, an exception path that permanently strands actions, and several secondary pipeline bugs. This plan fixes the confirm handler's data integrity issues first, then addresses smaller correctness bugs in the intent router and chat handler.

Findings were adversarially reviewed by 3 Codex reviewers (Skeptic, Architect, Minimalist). Several original findings were invalidated; new ones were surfaced. Only verified bugs remain.

## Problem Statement

### P1. Double-submit race creates duplicate entities (CRITICAL)

`confirm/handler.ts:54-68` reads `status === "pending"`, then writes `"confirmed"` via a blind `.update().eq("id")`. Two concurrent POSTs both pass the guard and both execute `createJobPostingFn` or `createDiscussionThreadFn`, producing duplicate entities. `updatePendingActionStatus` in `pending-actions.ts:119` has no compare-and-swap — it returns `void` and ignores whether the update matched any rows.

Trigger: double-click, network retry, flaky mobile connection.

### P2. Exception strands action permanently (CRITICAL)

`confirm/handler.ts:68` sets status to `"confirmed"` before execution. If `createJobPostingFn` throws (network error, Supabase timeout), status stays `"confirmed"` forever. The guard at line 59 rejects all non-`"pending"` statuses, so the user can never retry. The `!result.ok` rollback at line 82 only covers graceful failures.

### P3. Post-write persistence failure silently swallowed (HIGH)

`confirm/handler.ts:105,154`: After entity creation succeeds, `ai_messages.insert` result is never checked. If it fails, API returns 200 but no confirmation appears in chat history.

### P4. Cancel handler can overwrite "executed" status (HIGH)

`cancel/handler.ts` allows cancellation when `status === "confirmed"`. If a cancel arrives while a confirm is executing (between the "confirmed" write and the "executed" write), cancel can overwrite the status. The entity exists but the pending action shows "cancelled".

### P5. Dead ternary in intent router (MEDIUM)

`intent-router.ts:190`: `effectiveSurface: hasGeneralContent ? "general" : "general"` always returns `"general"`. Breaks `rerouted` analytics. Low traffic branch (only fires when no keywords match on a non-general surface).

### P6. Pass2 receives tool error results with no instruction (MEDIUM)

`chat/handler.ts`: After `toolPassBreakerOpen`, the timed-out tool's error result is pushed to `toolResults`. Pass2 LLM receives mixed success/error results with no guidance, may hallucinate success.

### P7. Idempotency replay returns wrong message (MEDIUM)

`chat/handler.ts:790`: Replay fetches the most recent complete assistant message in the thread, not the one tied to the idempotent request. If another turn completed later, replay returns wrong content.

## Proposed Solution

### Phase 1: Confirm/Cancel Handler Hardening (C1 + C2 + P3 + P4)

#### 1a. Conditional update in `updatePendingActionStatus`

Modify `pending-actions.ts` to accept an optional `expectedStatus` parameter. When provided, the update chain becomes `.update(payload).eq("id", actionId).eq("status", expectedStatus).select()` and returns the updated rows. If 0 rows returned, the caller knows the CAS failed.

```ts
// pending-actions.ts — new signature
export async function updatePendingActionStatus(
  supabase: PendingActionSupabase,
  actionId: string,
  input: {
    status: PendingActionStatus;
    expectedStatus?: PendingActionStatus; // NEW — compare-and-swap
    resultEntityType?: string | null;
    resultEntityId?: string | null;
    executedAt?: string | null;
  }
): Promise<{ updated: boolean }>
```

The `PendingActionQueryBuilder` interface needs updating to include `.select()` in the chain and return `{ data: unknown[] | null; error: unknown }`.

#### 1b. Try/catch + rollback in confirm handler

Wrap the switch/case body in try/catch. On catch, attempt rollback to `"pending"` using the conditional update (`.eq("status", "confirmed")`). If the rollback also fails, log a structured error with full context (actionId, orgId, userId, action_type, error) for operator recovery. Do not silently swallow.

#### 1c. Re-read after zero-row update

When the conditional update returns 0 rows, re-read the action to distinguish:
- `status === "executed"` → return 200 with existing result (idempotent retry)
- `status === "cancelled"` → return 409 with `{ reason: "cancelled" }`
- `status === "expired"` → return 410
- Row not found → return 404

#### 1d. Cancel handler conditional update

Change cancel handler to use `.eq("status", "pending")` only (remove the `"confirmed"` allowance). If an action is in `"confirmed"` state, it's being actively executed — cancel should return 409 with `{ reason: "in_progress" }`.

#### 1e. Check ai_messages insert result

After entity creation and status update to "executed", check the `ai_messages.insert` error. On failure, log the error with actionId and threadId. Still return 200 — the entity was created. The message will appear on next thread load via the pending action's `resultEntityId`.

### Phase 2: Intent Router Fix (P5)

One-line fix in `intent-router.ts:190`:
```ts
effectiveSurface: hasGeneralContent ? "general" : requestedSurface,
```

### Phase 3: Chat Handler Fixes (P6 + P7)

#### 3a. Pass2 tool error instruction

Add to the pass2 system prompt when `toolResults` contains any error entries:
```
"Some tool calls failed. Only cite data from successful tool results. Acknowledge any failures honestly — do not fabricate data."
```

#### 3b. Idempotency replay scoping

Change the replay query to filter by the user message's `idempotency_key` rather than fetching the latest assistant message in the thread. Query: find the user message row by idempotency_key, then find the assistant message that was inserted for that same turn (by ordering `created_at` immediately after the user message within the same thread).

### Phase 4: PendingActionCard UI Hardening

Disable both Confirm and Cancel buttons immediately on click (optimistic state). Show a loading indicator. Re-enable only on retryable error responses. This prevents the double-click scenario from reaching the server at all.

### Phase 5: Regression Tests

Write targeted tests for each fix using existing conventions (`node:test`, dependency injection, spy arrays):

- **C1 race**: Mock two concurrent confirm calls. First should succeed, second should get `{ updated: false }` from the conditional update.
- **C2 exception**: Mock `createJobPostingFn` to throw. Verify status rolls back to `"pending"`.
- **C2 rollback failure**: Mock both the write and rollback to fail. Verify structured error is logged.
- **P3 message insert failure**: Mock `ai_messages.insert` to fail. Verify 200 returned, error logged.
- **P4 cancel after confirm**: Mock cancel arriving when status is `"confirmed"`. Verify 409 with reason.
- **P5 intent router**: Test with `requestedSurface !== "general"` and no keyword matches. Verify `effectiveSurface` preserves requested surface.
- **Idempotency replay**: Test with multiple completed turns in thread. Verify correct message returned.

## Technical Considerations

### Status Transition State Machine

Valid transitions (enforced by conditional updates):
```
pending → confirmed   (confirm handler claims row)
confirmed → executed  (write succeeded)
confirmed → pending   (write failed, rollback)
pending → cancelled   (cancel handler)
pending → expired     (expiry check in confirm or cancel)
```

Invalid transitions (blocked by CAS):
```
confirmed → cancelled  (cancel cannot interrupt in-flight execution)
executed → anything    (terminal state)
cancelled → anything   (terminal state)
expired → anything     (terminal state)
```

### Authorization Check Ordering

Auth (`getAiOrgContext`) already runs before any status mutation (line 51 in confirm, before the conditional update). No change needed — just verify this ordering is preserved.

### Supabase CAS Atomicity

`.update().eq("id", x).eq("status", y)` compiles to `UPDATE ... WHERE id = $1 AND status = $2` — a single atomic SQL statement. Row-level locking in PostgreSQL prevents two concurrent UPDATEs from both matching.

## Acceptance Criteria

- [ ] Two concurrent confirm POSTs produce exactly one entity, not two
- [ ] A thrown exception during write execution rolls back to `"pending"` and the user can retry
- [ ] Rollback failure logs a structured error with actionId, orgId, error context
- [ ] Confirm retry after successful execution returns 200 with the existing result
- [ ] Cancel on an in-progress action returns 409 with `{ reason: "in_progress" }`
- [ ] Failed `ai_messages.insert` is logged, does not block 200 response
- [ ] Intent router preserves `requestedSurface` when no keywords match
- [ ] Pass2 acknowledges failed tools instead of hallucinating success
- [ ] Idempotency replay returns the correct assistant message for the given key
- [ ] PendingActionCard disables buttons on click, shows loading state
- [ ] All regression tests pass

## Key Files

- `src/lib/ai/pending-actions.ts` — conditional update (Phase 1a)
- `src/app/api/ai/[orgId]/pending-actions/[actionId]/confirm/handler.ts` — try/catch, re-read, message check (Phase 1b-e)
- `src/app/api/ai/[orgId]/pending-actions/[actionId]/cancel/handler.ts` — conditional update (Phase 1d)
- `src/lib/ai/intent-router.ts` — dead ternary fix (Phase 2)
- `src/app/api/ai/[orgId]/chat/handler.ts` — pass2 instruction, replay fix (Phase 3)
- `src/components/ai-assistant/PendingActionCard.tsx` — button disabling (Phase 4)
- `tests/routes/ai/pending-actions-handler.test.ts` — new test cases (Phase 5)

## Sources

- Adversarial review by 3 Codex reviewers (Skeptic, Architect, Minimalist) — 2026-03-27
- SpecFlow analysis identifying cancel handler race and retry idempotency gaps
- Existing test conventions from `tests/routes/ai/pending-actions-handler.test.ts`
