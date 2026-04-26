---
title: "AI Handler Refactor — Deferred Seam: model+tools loop"
category: patterns
tags: [refactoring, ai, architecture, seams, sse, byte-parity, deferred-work]
components: [ai-chat-handler]
problem_type: refactoring-decision
date: 2026-04-25
related_prs: []
repo_area: src/app/api/ai/[orgId]/chat
---

# AI Handler Refactor — Deferred Seam: model+tools loop (U4c)

Plan A (`~/.claude/plans/synchronous-plotting-flask.md`) decomposes the 2308-LOC `src/app/api/ai/[orgId]/chat/handler.ts` into stage modules under `handler/stages/`. Units U1, U2, U3a, U3b, U4a, U4b are landed (handler now ~1767 LOC, SSE snapshot suite byte-identical 3/3). **U4c — extracting the pass1+tools+pass2+grounding loop — was deliberately deferred.** Full deferral plan with seam design lives at `~/.claude/plans/u4c-deferred-model-tools-loop.md`.

## Why this seam is hard

The model+tools loop (~600 LOC, handler.ts L1019-1611) is not a clean stage. It is an interleaved control loop with five distinct coupling vectors that cannot be passed down as plain inputs without leaking orchestration concerns:

1. **SSE `enqueue` closure** captured by `createSSEStream`. Pass1 buffer release, tool-result events, pass2 chunk stream, error events, and grounding fallback all flush through the same closure. Reordering any of these breaks byte-identical SSE replay (which the snapshot suite enforces).
2. **`runtimeState` mutation across branches** — `auditErrorMessage`, `toolCallMade`, `toolCallSucceeded`, `streamCompletedSuccessfully`, `contextMetadata`, `usage` are written from inside pass1, tool execution, pass2, AND grounding. The final audit row reads several of these post-loop.
3. **Audit-error coupling** — pass1/pass2 model errors set `runtimeState.auditErrorMessage`, which the finalize-audit stage (U5) reads. Grounding failure also writes it. The audit row is the merge point.
4. **Grounding mid-flight mutation** — `verifyToolBackedResponseFn` failure swaps `pass2BufferedContent` for a fallback string, writes `runtimeState.auditErrorMessage`, fires `trackOpsEventServerFn`, logs. This is a side-effect cluster, not a pure check.
5. **Dep-closure over `runModelStage`** — itself a closure over `client`, `composeResponseFn`, `recordUsage`, `enqueue`, `stageTimings`. Naive parameter-passing produces a 30+ argument signature.

## Pattern: when to defer a refactor unit

The unit was deferred under three preconditions that should generalize:

- **Block size > one focused session** (~600 LOC of interlocking logic).
- **Hard byte-parity requirement** with no parity test for the worst-case branches yet (the snapshot suite covers cache-miss-no-tools, cache-hit, scope-refusal — but no multi-tool-call or tool-error fixture exists yet).
- **No clean seam exists** — every input/output is shared mutable state or a captured closure. This is a smell that the right intermediate is an event/callback abstraction, not direct decomposition.

When all three hold, the right move is to **land the easy units first, then design the seam**. Don't extract under context-window pressure when SSE byte parity is at stake.

## Seam design (locked-in for U4c next session)

**Use callback-style stage, not direct decomposition:**

```ts
runModelToolsLoop({
  // pure inputs
  client, systemPrompt, contextMessages, pass1Tools, pass1ToolChoice,
  executionPolicy, hideDonorNames, ...,
  // callbacks the orchestrator owns
  onSseEvent: (event) => enqueue(event),
  onAuditError: (msg) => { runtimeState.auditErrorMessage = msg; },
  onUsage: recordUsage,
  onToolCallStarted/Succeeded/Failed: ...,
}) => Promise<{ fullContent, pass2BufferedContent, ... }>
```

The stage emits side-effects via callbacks supplied by the orchestrator. No `runtimeState` reference leaks into the stage; no SSE infrastructure leaks either. The stage becomes testable in isolation.

Rejected: AsyncIterable-of-stage-events (preserving exact flush ordering across pass1 buffer release → tool result events → pass2 chunks → grounding swap is fragile when the consumer drives iteration). Rejected: returning a `RuntimeStateUpdate` patch (mutations need to flush mid-loop, not at end).

## Pre-work required before resuming U4c

Before the first edit:

1. Re-read `~/.claude/plans/synchronous-plotting-flask.md` U4 + U5 + U8 sections (U8 is the parallelization phase that depends on U4c's seams).
2. Re-read `handler.ts` L1019-1611 in one pass.
3. Map every `runtimeState` field mutation site inside the loop.
4. Map every `enqueue(...)` call inside the loop and what triggers it.
5. Map every `stageTimings` / `setStageStatus` / `skipStage` call inside the loop.
6. **Add snapshot fixtures before touching code:**
   - multi-tool-call (sequential tool execution, currently uncovered by snapshot suite)
   - tool-error (failed tool call → pass2 acknowledges failure honestly)
7. **Phase the work** — six small PRs (extract `runModelStage` helper, then pass1, then tools, then pass2, then grounding, then compose). Snapshot suite must be green between every phase.

## Lessons that generalize

- **Snapshot fixtures are the parity contract.** When extracting any SSE-emitting code path, the cheapest guarantee against silent breakage is byte-identical SSE event replay. Add the fixture for the worst-case branch BEFORE touching the code.
- **Callbacks beat parameters when the seam crosses a closure boundary.** If the candidate seam captures `enqueue` or any other long-lived closure, lift it out as a callback and let the orchestrator wire it back in. Don't pass the closure down.
- **Defer cleanly, document the seam design, leave fixtures as pre-work.** The cost of a written seam plan + fixture-prep checklist is one document. The cost of a half-extracted stage with broken byte parity is a session-long debug.
- **Stage extraction order matters.** Easy stages first (auth, validate-policy, thread-idempotency, init-rpc, init-history). Stages with shared mutable state last. The orchestrator's coupling surface shrinks as you go.

## References

- Plan: `~/.claude/plans/synchronous-plotting-flask.md`
- Deferral plan: `~/.claude/plans/u4c-deferred-model-tools-loop.md`
- Snapshot harness: `tests/handler-sse-snapshot.test.ts`
- Fixtures: `tests/fixtures/handler-sse/{cache-miss-no-tools,cache-hit,scope-refusal}.snap`
- Current handler: `src/app/api/ai/[orgId]/chat/handler.ts` (1767 LOC, target ~400 LOC after U5)
