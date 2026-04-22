---
title: "`return` vs `return await` Inside try/catch — Silent Rollback Swallowing"
category: patterns
tags:
  - javascript
  - typescript
  - async
  - try-catch
  - return-await
  - dispatcher
  - rollback
  - ai-confirm-handler
  - cas-transitions
components:
  - ai-confirm-handler
  - pending-action-dispatchers
problem_type: silent-error-swallowing
severity: high
date: 2026-04-22
related_prs: [125, 126, 127, 130]
repo_area: ai-agent
---

# `return` vs `return await` Inside try/catch — Silent Rollback Swallowing

## Problem

During Phase 0.5 of the Tier 1 edit/delete plan (per-domain split of `src/app/api/ai/[orgId]/pending-actions/[actionId]/confirm/handler.ts`), extracting inline `case` branches into per-domain dispatcher modules silently introduced a bug where the outer `try/catch` stopped observing rejections from the dispatcher. The CAS rollback from `confirmed → pending` never ran when a domain primitive threw — rows stranded in `confirmed` until the 15-min reaper swept them to `failed`, and the caller received a 5xx with no dispatched error path.

## Symptoms

- After extractions #125 and #126, any domain primitive that threw (DB timeout, unreachable Supabase, network failure) left `ai_pending_actions` rows in `status = 'confirmed'` instead of rolling back to `pending`.
- No user-facing `aiLog("rollback failed …")` — the rollback code simply never fired.
- No immediate retry path; the row sat for 15 minutes until the stranded-confirmed reaper swept it to `failed`.
- Silently shipped in #125 and #126 because no test exercised the throw-path for those dispatchers. Caught by the existing `"exception during write rolls back to pending"` test for `create_job_posting` when #127 extracted that case.

## Investigation

The existing test `"exception during write rolls back to pending"` stubbed `createJobPosting` to throw `"Supabase timeout"` and asserted `updatePendingActionStatus` was called twice (CAS `confirmed` then rollback `pending`). On the `feat/ai-confirm-handler-split-jobs` branch the test started failing with `Cannot read properties of undefined (reading 'status')` — `updatedStatuses` was empty, meaning neither the CAS claim nor the rollback had fired.

The CAS claim definitely should have fired (it runs before the switch), so initial suspicion fell on the stub wiring. Rechecking the handler diff against the passing pre-extraction baseline revealed the only behavioral change: the inline `await createJobPostingFn(...)` had become `return handleCreateJobPosting(...)`. The exception from inside the dispatcher was never reaching the outer rollback path because the Promise was returned synchronously, not awaited.

## Root Cause

JavaScript semantics of `return` inside an async `try` block:

```ts
async function foo() {
  try {
    return somePromiseThatRejects();  // rejection ESCAPES the try
  } catch (e) {
    // never runs
  }
}
```

vs:

```ts
async function foo() {
  try {
    return await somePromiseThatRejects();  // rejection CAUGHT here
  } catch (e) {
    // runs
  }
}
```

In `return promise`, the async function returns that promise as-is. The rejection surfaces on the *outer* Promise — the one the caller awaits — and the `catch` inside `foo` is never evaluated. `return await promise` inserts an `await` point inside the try scope, so the rejection reaches the `catch`.

The inline code before extraction used `await` on the domain call directly, and `return` on the terminal `NextResponse.json(...)` (which is a value, not a Promise). After extraction, the whole dispatcher is a single Promise-returning call, and `return await` is what keeps its rejection inside the caller's try.

This is the exact scenario `no-return-await` ESLint rules *recommend against* — but that rule's guidance applies outside try/catch blocks, where the `await` is pure overhead. Inside a try, dropping the `await` changes semantics.

## Fix

Use `return await` for every dispatcher invocation in the confirm handler's switch:

```ts
case "create_announcement":
  // `return await` (not `return`) is required: the outer try/catch must
  // observe rejections from the dispatcher to run the rollback path.
  return await handleCreateAnnouncement(ctx, action, deps);
```

Comments on each case are annoying but the rule is subtle enough that a future engineer will want the explanation in-situ.

## Regression Coverage

`tests/routes/ai/pending-actions-handler.test.ts` has one regression test per dispatcher (nine total as of #130) shaped:

```ts
test("exception during write rolls back for <domain>", async () => {
  const updatedStatuses = [];
  const handler = createAiPendingActionConfirmHandler({
    ...buildBaseDeps(),
    getPendingAction: async () => buildPendingAction({ action_type: "<domain>", payload: {...} }),
    updatePendingActionStatus: async (_, __, payload) => {
      updatedStatuses.push(payload);
      return { updated: true };
    },
    <domainFn>: async () => { throw new Error("Supabase timeout"); },
  });
  await assert.rejects(handler(...), { message: "Supabase timeout" });
  assert.equal(updatedStatuses[0].status, "confirmed");    // CAS claim fired
  assert.equal(updatedStatuses[1].status, "pending");       // Rollback fired
  assert.equal(updatedStatuses[1].expectedStatus, "confirmed");
});
```

Reverting `return await` to `return` for any dispatcher causes the matching test to fail deterministically with `Cannot read properties of undefined (reading 'status')`. Verified manually across all nine cases.

## Related PRs

- **#125, #126** — Phase 0.5 extractions (announcements, events) that silently introduced the bug.
- **#127** — Extraction of `create_job_posting` that surfaced it via pre-existing test, plus the fix (`return await`) and the first two regression tests (announcements, events).
- **#128** — Extraction of remaining six dispatchers with the fix already in place.
- **#130** — Regression tests for the remaining six dispatchers so any future `no-return-await` autofix is caught immediately.

## Applicability

Any handler that satisfies all three:

1. Declares an outer `try/catch` intended to run compensating logic (rollback, logging, re-throw) on rejection.
2. Delegates to sub-functions that return Promises.
3. Uses `return subFn(...)` inside the try.

Common shapes in this repo:
- Route handlers that CAS-claim a row, call a domain primitive, and need to roll back on throw.
- Saga-style workflows with multi-step compensating actions.
- Middleware-style decorators where the inner callable can reject.

When in doubt, prefer `return await` inside any try block that has a meaningful `catch`. The performance cost is a single microtask tick; the correctness cost of getting it wrong is stranded state and silent error swallowing.

## Non-Applicable

- `return somePromise` **outside** any try/catch is fine and `no-return-await` rules correctly prefer it.
- `return somePromise` inside a try that only has a `finally` (no `catch`) does not change semantics — the `finally` fires regardless.
- `return` of a non-Promise value (e.g., `return NextResponse.json({...})`) is fine; the rejection class only applies to Promise-returning expressions.
