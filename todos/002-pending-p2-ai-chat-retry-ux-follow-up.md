---
status: pending
priority: p2
issue_id: "002"
tags: [ai, chat, ux, retries, sse]
dependencies: []
---

# Investigate AI chat retry / in-flight UX after timeouts

## Problem Statement

AI chat retries can still surface confusing UX after a slow or timed-out request. Manual QA saw `The response timed out. Please try again.`, followed by `Request already in progress`, interrupted-copy, or generic failure copy even when the original request may still be running or may have completed later.

## Findings

- The reply-by-thread-name fix intentionally did not change retry behavior.
- `src/hooks/useAIStream.ts` already treats 409 responses as `{ inFlight: true }`, so the remaining bug is not simply “client treats 409 as an error.”
- The likely remaining causes are:
  - client abort behavior on rapid resend,
  - panel/message rendering ignoring `inFlight`,
  - or server timeout / late-completion persistence producing stale error copy.

## Proposed Solutions

### Option 1: Reproduce and patch the exact bad path

**Approach:** Instrument and reproduce the timeout/retry flow, then fix the specific client or server path that is producing the misleading state.

**Pros:**
- Fixes the real bug rather than a guessed one.
- Keeps the patch narrow.

**Cons:**
- Requires deeper repro work first.

**Effort:** 1-3 hours

**Risk:** Low

---

### Option 2: Broad retry-state refactor without a confirmed repro

**Approach:** Refactor `useAIStream`, panel state, and server replay behavior together to unify all retry/in-flight handling.

**Pros:**
- Could clean up multiple code paths at once.

**Cons:**
- High chance of touching the wrong layer.
- Higher regression risk than the evidence supports.

**Effort:** 0.5-1 day

**Risk:** Medium

---

### Option 3: Do nothing

**Approach:** Leave the current retry behavior in place.

**Pros:**
- No immediate work.

**Cons:**
- QA confusion remains.
- Makes timeouts look like capability failures.

**Effort:** None

**Risk:** Medium

## Recommended Action

Prefer Option 1. Reproduce the exact timeout → retry flow first, identify whether the bug is client abort, in-flight rendering, or late server completion, and then fix only that path.

## Technical Details

- Likely files:
  - `src/hooks/useAIStream.ts`
  - `src/components/ai-assistant/AIPanel.tsx`
  - `src/components/ai-assistant/MessageList.tsx`
  - `src/app/api/ai/[orgId]/chat/handler.ts`

## Acceptance Criteria

- [ ] Timeout/retry behavior is reproduced with a concrete failing test or a documented manual repro.
- [ ] The panel does not show misleading generic failure copy for an in-flight retryable request.
- [ ] The resolved fix passes targeted AI chat tests plus normal quality gates.

## Work Log

### 2026-04-08 - Follow-up captured during reply-by-thread-name work

**By:** Codex

**Actions:**
- Deferred retry UX changes while implementing named-thread discussion replies.
- Captured the follow-up so the unresolved timeout / in-flight behavior remains tracked.

**Learnings:**
- The existing 409 handling is already partly correct, so the remaining bug needs a repro-grounded investigation rather than a speculative refactor.
