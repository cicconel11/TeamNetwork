---
title: Inline Pending-Action Diff
type: feat
status: active
date: 2026-04-23
origin: docs/brainstorms/2026-04-23-inline-pending-action-diff-requirements.md
---

# Inline Pending-Action Diff

## Overview

Enhance the existing inline `PendingActionCard` in AIPanel with four capabilities: (1) a **diff view** for edit-type actions that shows previous content alongside the new draft, (2) a **Revise via chat** flow that re-runs the same `prepare_*` tool with the prior draft + user instruction as context, (3) **tall-draft collapse** with expand affordance, and (4) a **rehydration endpoint** so a reconnecting SSE client can recover pending-action state after a mid-turn stream drop.

The brainstorm's framing ("replace modal with inline card") is superseded by a codebase finding: there is no modal today. `PendingActionCard` already renders inline in the AIPanel message list. The real work is the four capabilities above, not the surface change.

---

## Problem Frame

The pending-action HITL pipeline is TeamNetwork's category moat. Today:

- The card shows the new draft but **never shows what it replaces** on edit-type actions (discussion replies, profile edits, etc. that modify existing content). Admins have to trust the agent that the replacement is correct.
- **Revise means re-prompting from scratch.** The agent re-runs the tool cold, without the prior draft in context. The only exception is an event-specific bespoke path at `src/app/api/ai/[orgId]/chat/handler.ts:5460-5499` (cancel-and-re-enqueue). The general case has no revise affordance.
- **Tall drafts flood the thread.** A 30-line announcement body pushes earlier messages off-screen.
- **SSE drop loses the card.** `ai_pending_actions` rows persist, but no endpoint exposes them to a reconnecting client, and the idempotency replay path (`handler.ts:4475-4528`) replays `chunk` + `done` only — not `pending_action` events. Reconnect after mid-turn drop = card gone, user stranded.

See origin: `docs/brainstorms/2026-04-23-inline-pending-action-diff-requirements.md`.

---

## Requirements Trace

- **R1.** Pending actions render inline at the turn boundary. *(Already true — `PendingActionCard` via `MessageList.tsx:249-285`. No work.)*
- **R2.** Card surfaces four fields: draft, replaces (edit-type only), target audience, source tool + optional confidence chip.
- **R3.** Card actions: Approve, Revise via chat, Discard.
- **R4.** Revise re-invokes the same `prepare_*` tool with prior draft + user instruction as context; pending-action row updates in place.
- **R5.** Revise loop cap = 3. After 3 revises, Revise disables with a hint.
- **R6.** Drafts > ~12 lines collapse by default with expand affordance; replaces-section collapses independently.
- **R7.** SSE reconnect rehydrates pending state from server.
- **R8.** One interactive pending action per turn (stack visibly, do not silently overlay). *(Partially true — batch handling exists via `pending_actions_batch` and Confirm-All/Cancel-All bar at `MessageList.tsx:249-285`. Need to verify revise targets the right row in batch mode.)*
- **R9.** Keyboard parity with existing Approve/Cancel affordances. *(Already true for current card. Revise unlocks chat input; no new shortcut needed.)*

Confidence chip (part of R2) is **deferred** to a separate ideation item (`docs/ideation/2026-04-23-ai-agent-improvements-ideation.md` #1 Confidence Ribbon). Codebase finding: the tool-grounding verifier at `src/lib/ai/tool-grounding/verifier.ts` emits `{grounded: boolean, failures: string[]}` only — no confidence number to surface. The card will leave space for it; item #1 will wire it.

---

## Scope Boundaries

- No structured revision chips (Shorter / Change audience / etc.). Free-form chat only.
- No bulk Approve/Discard UI beyond what already exists (`Confirm-All` / `Cancel-All` batch bar stays unchanged).
- No non-`prepare_*` tool cards (list_*, get_* responses remain plain message bubbles).
- No alumni / non-admin exposure. Agent is admin-only today; this feature ships to admins.
- No confidence chip wiring — deferred to Confidence Ribbon ideation item.
- No changes to the downstream commit path for any `prepare_*` action. Approve behavior is unchanged.

### Deferred to Follow-Up Work

- **Confidence chip wiring** — will be added when Confidence Ribbon (ideation item #1) lands and the verifier begins emitting a scalar confidence.
- **Event-specific revise path consolidation** — the bespoke event revise at `handler.ts:5460-5499` should fold into the generalized revise flow in a follow-up PR once the generalized flow has soaked. Leaving it intact for this plan reduces blast radius.

---

## Context & Research

### Relevant Code and Patterns

- `src/lib/ai/pending-actions.ts` — row CRUD, state machine (`pending | confirmed | executed | failed | cancelled | expired`), `updatePendingActionStatus` CAS helper at lines 188-235. Payload union `PendingActionPayloadByType` at lines 10-104.
- `supabase/migrations/20260727000000_ai_pending_actions.sql` — base schema.
- `supabase/migrations/20260330000000_ai_pending_actions_failed_status.sql` — status enum widening precedent.
- `src/components/ai-assistant/PendingActionCard.tsx` — existing inline card. Props shape at lines 5-11. Renders fields from `payload` via `actionType` switch; no diff view.
- `src/components/ai-assistant/MessageList.tsx:249-285` — card mount point in the message list + batch bar.
- `src/components/ai-assistant/AIPanel.tsx:442-447, 599-669` — stream-to-state plumbing; confirm/cancel fetch calls.
- `src/hooks/useAIStream.ts:139-146, 263-289` — `pending_action` / `pending_actions_batch` SSE event handling and state accumulation.
- `src/lib/ai/sse.ts:10-45` — SSE event type schema. Add a `pending_action_updated` event type here for revise-in-place.
- `src/app/api/ai/[orgId]/chat/handler.ts:4475-4528` — idempotency replay path that currently misses `pending_action` events (R7 requires extending this).
- `src/app/api/ai/[orgId]/chat/handler.ts:5460-5499` — event-specific cancel-and-re-enqueue precedent for revise.
- `src/app/api/ai/[orgId]/chat/handler.ts:5469-5483, 5930-5948` — pending-action emission sites.
- `src/app/api/ai/[orgId]/pending-actions/[actionId]/confirm/handler.ts:126-134, 152-180` — CAS-based idempotency precedent for Approve.
- `src/lib/ai/tools/definitions.ts` — all nine `prepare_*` tool schemas (lines 278, 310, 353, 373, 397, 442, 467, 505, 919).
- `src/lib/ai/tools/executor.ts` — tool execution path.
- `src/lib/ai/draft-sessions.ts` — `ai_draft_sessions` table with existing `pending_action_id` pointer; useful pattern for linking revision lineage.

### Institutional Learnings

- `src/app/api/ai/[orgId]/pending-actions/[actionId]/confirm/handler.ts` — confirm handler previously had a race fix (see `2026-03-27-fix-ai-confirm-handler-race-and-error-handling-plan.md`). Same CAS approach applies to the new `revise` state transition.

### External References

None — work is internal to the AI agent surface.

---

## Key Technical Decisions

- **Revise as "update-in-place on the same row", not "cancel + new row."** The existing event-specific path cancels and re-enqueues; the generalized revise updates `ai_pending_actions` in place (new payload, `revise_count + 1`, `previous_payload` stashed). Benefits: (a) card stays at its thread position, (b) revise count is trivially enforced, (c) lineage is preserved on one row. The existing event path is not consolidated here — it keeps working; folded into the generalized flow in a follow-up.
- **`previous_payload jsonb` column on `ai_pending_actions`.** Added for both diff-of-edit (R2) and revise lineage (R4). Single column serves both purposes. Populated from the pre-existing entity (for edits) or from the prior payload (for revise).
- **`revise_count int default 0 not null`.** Explicit counter on the row. Enforced server-side in the revise handler (rejects at 3). UI reads this to disable the button.
- **New SSE event: `pending_action_updated`.** Existing `pending_action` remains for first-render. The updated event carries `{action_id, payload, revise_count, previous_payload}` so the client swaps the card in place without remounting.
- **Rehydration endpoint: `GET /api/ai/[orgId]/pending-actions?thread_id=...&status=pending`.** Scoped by thread, pending-status only. Wired into the reconnect path in `useAIStream`. No broader pending-action list UI is introduced.
- **Idempotency replay extension.** The replay path at `handler.ts:4475-4528` also re-emits any `pending_action` rows on the replayed assistant message (one query on `ai_pending_actions` keyed by `thread_id + created_at`). Avoids the "reconnect loses card" class of bug even outside the rehydration endpoint.
- **Collapse threshold: 12 lines of rendered draft body.** Measured on the rendered text, not raw characters. Threshold lives in `PendingActionCard`; not configurable.
- **Revise unlocks the chat input with a hint; no card-local textarea.** Matches decision in brainstorm. Zero new UI surface on the card.
- **Revise tool call carries `prior_payload` and `revision_instruction` as a synthetic system-context preamble, not as new tool schema parameters.** Keeps the nine `prepare_*` tool schemas stable. Implementation detail in the turn-execution policy: when the agent's next turn starts with a `revise_pending_action` intent, the turn-execution-policy injects the prior payload as a system message before the user instruction.
- **Discard becomes `cancelled` via existing status CAS.** No new state. Short system line ("Draft discarded") is appended as a client-side UI marker, not a persisted message.

---

## Open Questions

### Resolved During Planning

- *Does pending-action row shape need extension?* Yes — `previous_payload`, `revise_count`. New migration.
- *Does any `prepare_*` tool need a new parameter?* No — revise context is injected at the turn-execution layer, not at the tool schema.
- *Is Approve idempotent today?* Yes — status CAS at `confirm/handler.ts:126-180` returns `{ok: true, replayed: true}` on already-executed rows. No work.
- *Is there a rehydration endpoint today?* No — net-new `GET /api/ai/[orgId]/pending-actions`.
- *Does the verifier emit a confidence scalar?* No — `{grounded, failures}` only. Confidence chip deferred.
- *Does SSE reconnect re-emit pending actions?* No — both the rehydration endpoint and the idempotency-replay extension are needed for R7.

### Deferred to Implementation

- Exact diff rendering: unified vs side-by-side. Prototype both in U3; pick by readability on a 30-line announcement edit.
- Hint copy for Revise unlock ("Tell the agent how to revise this draft" vs similar). Finalize during U4.
- Whether `previous_payload` is fetched lazily on card render or populated on pending-action creation. Prefer populate-on-creation to keep the card simple, but verify perf on edit-type actions that require a DB lookup of the original entity.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

Revise state machine (one row in `ai_pending_actions`):

```
             ┌──────────────┐
             │ pending      │ ← first prepare_* tool call
             │ revise_count │
             │  = 0         │
             └──────┬───────┘
                    │
       ┌────────────┼────────────┬──────────────────┐
       │            │            │                  │
   Approve      Revise       Revise…up to 3     Discard
       │            │            │                  │
       ▼            ▼            ▼                  ▼
  confirmed   pending      pending           cancelled
  (CAS)       (update in   (revise_count
              place;       capped at 3;
              revise_count new payload;
              += 1;        previous_payload
              previous_    preserves lineage
              payload      across revises —
              = old        stores most-recent
              payload)     prior, not a chain)
       │
       ▼
   executed
   (CAS)
```

SSE sequence for revise:

```
client: types revision instruction in chat
   │
   ▼
POST /api/ai/[orgId]/chat  (existing chat endpoint; turn-execution-policy
   │                       detects the open pending-action in thread and
   │                       injects prior_payload + instruction into system
   │                       context before tool-call selection)
   ▼
agent: re-invokes same prepare_* tool
   │
   ▼
server: updates ai_pending_actions row in place (revise_count += 1)
   │
   ▼
server: emits `pending_action_updated` SSE event
   │
   ▼
client: swaps card in place, keeps thread position, shows revise count
```

---

## Implementation Units

- [ ] **U1. Extend `ai_pending_actions` schema for diff + revise lineage**

**Goal:** Add `previous_payload jsonb` and `revise_count int default 0 not null` columns so the card can render a diff and the server can enforce the 3-revise cap.

**Requirements:** R2 (replaces-section), R4 (revise re-invokes tool), R5 (3-loop cap).

**Dependencies:** None.

**Files:**
- Create: `supabase/migrations/20260423000000_ai_pending_actions_revise_columns.sql`
- Modify: `src/lib/ai/pending-actions.ts` (extend `AiPendingActionRow` type, payload helpers)
- Test: `tests/ai/pending-actions-schema.test.ts`

**Approach:**
- Migration adds two nullable-until-populated columns (default null for `previous_payload`, default 0 for `revise_count`).
- No index on `revise_count` (never queried standalone).
- Existing rows backfill to `revise_count = 0` via the column default.

**Patterns to follow:**
- `supabase/migrations/20260330000000_ai_pending_actions_failed_status.sql` — additive schema change on the same table.

**Test scenarios:**
- Happy path: inserting a pending-action row without supplying `previous_payload` / `revise_count` succeeds with defaults.
- Happy path: `revise_count` increments via update and reads back correctly.
- Edge case: `previous_payload` accepts arbitrary `jsonb` shape matching any `PendingActionPayloadByType` variant.

**Verification:**
- Migration applies cleanly on a fresh DB and on a DB with existing pending-action rows.
- `ai_pending_actions` TS type in `src/types/database.ts` regenerates via `npm run gen:types` and includes both columns.

---

- [ ] **U2. Server-side revise handler + state transition**

**Goal:** Add a server path that (a) accepts a revise intent on the next turn, (b) injects prior payload as system context, (c) on tool-call result, updates the pending row in place with `revise_count += 1` and `previous_payload = old_payload`, (d) rejects at `revise_count >= 3`.

**Requirements:** R4, R5, R8.

**Dependencies:** U1.

**Files:**
- Modify: `src/lib/ai/turn-execution-policy.ts` — detect open pending-action in thread on turn start; if present and user input reads as revision, inject `prior_payload + revision_instruction` into system context for the tool-selection LLM call.
- Modify: `src/app/api/ai/[orgId]/chat/handler.ts` — hook into the existing `prepare_*` tool result emission (around lines 5469-5483 and 5930-5948) to branch: new row vs update-in-place. Emit `pending_action_updated` on update.
- Modify: `src/lib/ai/pending-actions.ts` — add `updatePendingActionPayload({action_id, new_payload, previous_payload})` helper with CAS on `status = 'pending'` and `revise_count < 3`.
- Modify: `src/lib/ai/sse.ts:10-45` — add `pending_action_updated` to the SSE event type union.
- Test: `tests/ai/pending-action-revise.test.ts`

**Approach:**
- Revise detection lives in `turn-execution-policy.ts` — if the thread has a `pending` row with status=pending, treat the next user turn as a candidate revise, and annotate the turn with `pending_action_id` for downstream branching.
- Tool result handler branches: (a) if `turn.pending_action_id` is set and a `prepare_*` tool fired, call `updatePendingActionPayload` and emit `pending_action_updated`; (b) otherwise, existing create-new-row path.
- At `revise_count >= 3`, the update CAS returns `{updated: false, reason: 'revise_limit'}` and the server emits a turn-level error chunk ("Revision limit reached. Approve, discard, or start a new draft."). The card reads `revise_count = 3` from the next rehydrate and disables the button independently.
- Do not consolidate the bespoke event revise at `handler.ts:5460-5499` in this unit; leave it intact.

**Execution note:** Start with a failing integration test for the revise CAS at `revise_count = 3`. The limit is the security-adjacent invariant (prevents runaway token spend); get it tight first.

**Patterns to follow:**
- `src/app/api/ai/[orgId]/pending-actions/[actionId]/confirm/handler.ts:152-180` — CAS pattern with `{updated, replayed}` return shape.
- `src/app/api/ai/[orgId]/chat/handler.ts:5460-5499` — existing precedent for mid-turn pending-action mutation (reference only; do not generalize away this path in this unit).

**Test scenarios:**
- Happy path: first revise on `revise_count = 0` → row updates to `revise_count = 1`, `previous_payload` = old payload, `pending_action_updated` event emitted.
- Happy path: second revise → `revise_count = 2`.
- Happy path: third revise → `revise_count = 3`.
- Edge case: fourth revise request → CAS returns `{updated: false, reason: 'revise_limit'}`, row unchanged, no `pending_action_updated` event.
- Edge case: revise attempted on `cancelled` row → CAS fails, row unchanged.
- Edge case: revise attempted on `executed` row (user approved while agent was composing) → CAS fails, clear error to client.
- Error path: tool result for a different `prepare_*` family than the original row (e.g., row is `create_announcement`, tool is `prepare_job_posting`) → reject as invalid revise, leave the original row pending.
- Integration: turn-execution-policy correctly annotates the turn with `pending_action_id` when an open pending action exists in the thread; no annotation when none exists.

**Verification:**
- Revising 3× works; 4th attempt is rejected at the CAS layer.
- `previous_payload` reflects the payload from the most recent revise, not the very first draft.
- No new rows created on revise — single row, updated in place.

---

- [ ] **U3. Diff rendering in `PendingActionCard`**

**Goal:** When `previous_payload` is present, render a diff section above the draft section. Section label: "Replaces" (or action-type-specific label, e.g., "Previous announcement"). Collapse independently of the draft section.

**Requirements:** R2, R6.

**Dependencies:** U1.

**Files:**
- Modify: `src/components/ai-assistant/PendingActionCard.tsx` — add diff section per `actionType`, plumb `previous_payload` from `PendingActionState`.
- Modify: `src/components/ai-assistant/panel-state.ts` — extend `PendingActionState` with `previousPayload?: Record<string, unknown>` and `reviseCount: number`.
- Modify: `src/hooks/useAIStream.ts` — pass `previous_payload` and `revise_count` through from SSE events into state.
- Test: `tests/components/pending-action-card.test.tsx`

**Approach:**
- Per-action-type renderer maps `previous_payload` → diff content. Announcement: show prior title + body. Discussion reply: show prior body. Chat message: show prior body.
- Diff rendering is **visual** not algorithmic for v1 — two labeled blocks ("Replaces" / "New draft"), not a character-level diff. Revisit after soak.
- Collapse at 12 rendered lines. Click expands. Two collapse states (replaces + draft) managed independently.
- If `previous_payload` is null, the replaces section is omitted entirely.

**Patterns to follow:**
- Existing `actionType` switch inside `PendingActionCard` (lines ~20-100 range).

**Test scenarios:**
- Happy path: announcement with `previous_payload` renders Replaces + New sections.
- Happy path: announcement without `previous_payload` renders only the New section (no empty Replaces block).
- Happy path: discussion reply renders prior body correctly.
- Edge case: 30-line draft collapses to ~12 visible lines with expand affordance.
- Edge case: tall replaces + short draft — each section's collapse state is independent.
- Edge case: unknown `actionType` with `previous_payload` set → falls through to a generic JSON display, does not crash.
- Integration: card renders correctly when `pending_action_updated` swaps the payload while a section is expanded — preserves expansion state.

**Verification:**
- A 30-line announcement edit renders with both sections collapsed by default, each expandable independently.
- Non-edit-type actions (e.g., new chat message) render unchanged from today.

---

- [ ] **U4. Revise via chat — UI flow**

**Goal:** Add a Revise button to `PendingActionCard`. When clicked, the card enters "awaiting revision" state and the chat input is focused with a hint. The next user turn is interpreted as a revision instruction by the server. When `pending_action_updated` arrives, swap the card in place.

**Requirements:** R3, R4, R5, R8.

**Dependencies:** U2, U3.

**Files:**
- Modify: `src/components/ai-assistant/PendingActionCard.tsx` — add Revise button; disable at `reviseCount >= 3`; show "Awaiting revision…" state between click and `pending_action_updated`.
- Modify: `src/components/ai-assistant/AIPanel.tsx` — on Revise click: set active revise target (action_id), focus the chat input, show hint. Consume `pending_action_updated` from the stream to clear the awaiting state.
- Modify: `src/hooks/useAIStream.ts:263-289` — handle `pending_action_updated` by replacing the matching row in `state.pendingActions` (match on `action_id`).
- Test: `tests/components/pending-action-card-revise.test.tsx`

**Approach:**
- Revise button does not fetch anything. It only updates client state to flag "next user message is a revision for action_id X."
- The next submitted chat message travels the normal `/api/ai/[orgId]/chat` path; the server-side revise detection in U2 handles the rest.
- If the user submits an unrelated message instead, the server-side heuristic in `turn-execution-policy.ts` still detects the open pending action and may annotate the turn — but the annotated prior-payload context is optional; the agent can choose not to call `prepare_*`. In that case the pending row stays pending, no update fires, the card exits "Awaiting revision" after the turn completes.
- Hint copy: "Tell the agent how to revise this draft." (Finalize copy during implementation.)

**Test scenarios:**
- Happy path: click Revise → input focused, hint visible, card shows "Awaiting revision."
- Happy path: on `pending_action_updated`, awaiting state clears, new payload renders, revise count increments in UI.
- Edge case: `reviseCount = 3` → Revise button disabled, tooltip shows "Revision limit reached."
- Edge case: user clicks Revise, then clicks Discard instead of typing → awaiting state clears, row cancels via existing path.
- Edge case: user clicks Revise, types an unrelated message, server does not re-invoke `prepare_*` → awaiting state clears on turn completion, card unchanged.
- Edge case: keyboard — Approve / Cancel / Revise are all reachable via existing card keyboard model.
- Integration: Revise during a `pending_actions_batch` with multiple cards — only the clicked card enters awaiting state; others unchanged.

**Verification:**
- Three successful revises land correctly; fourth click is impossible from the UI.
- Thread position of the card is preserved across revises.
- `Confirm-All` / `Cancel-All` batch bar continues to work unchanged.

---

- [ ] **U5. SSE rehydration endpoint + reconnect integration**

**Goal:** Add `GET /api/ai/[orgId]/pending-actions?thread_id=...&status=pending` and wire it into the client's reconnect path. Also extend the idempotency replay at `handler.ts:4475-4528` to re-emit `pending_action` events for any pending rows on the replayed message.

**Requirements:** R7.

**Dependencies:** U1 (previous_payload + revise_count must be in the row so rehydration returns complete card state).

**Files:**
- Create: `src/app/api/ai/[orgId]/pending-actions/list/handler.ts` — list endpoint.
- Create: `src/app/api/ai/[orgId]/pending-actions/list/route.ts` — route wrapper.
- Modify: `src/app/api/ai/[orgId]/chat/handler.ts:4475-4528` — idempotency replay: after replaying `chunk` + `done`, query `ai_pending_actions` for `thread_id + assistant_message_id` and emit a `pending_action` event per row.
- Modify: `src/hooks/useAIStream.ts` — on SSE stream error or unexpected close mid-turn, fetch the list endpoint scoped to the current thread and merge results into `state.pendingActions`.
- Test: `tests/ai/pending-actions-rehydration.test.ts`, `tests/routes/pending-actions-list.test.ts`

**Approach:**
- Endpoint is admin-scoped (reuse existing auth middleware from other `/api/ai/[orgId]/pending-actions/` routes). Filter by `organization_id`, `thread_id`, `status = 'pending'`, `deleted_at is null`. Cap at 50 rows — if a thread has more pending actions than that, something is wrong upstream.
- Client rehydration fires on `onerror` / `onclose` while `streamState === 'streaming'`. De-dupe against actions already in `state.pendingActions` by `action_id`.
- Idempotency replay extension is the belt-and-suspenders path for R7: the list endpoint handles reconnect-from-scratch; the replay extension handles the same-idempotency-key retry case.

**Patterns to follow:**
- `src/app/api/ai/[orgId]/pending-actions/[actionId]/confirm/handler.ts` — existing auth + scoping pattern.
- `src/app/api/ai/[orgId]/threads/[threadId]/messages/handler.ts:59-76` — existing thread-scoped list pattern.

**Test scenarios:**
- Happy path: list endpoint returns only pending rows for the specified thread.
- Happy path: reconnecting client fetches pending actions and renders them.
- Edge case: no pending rows → empty array, 200 status.
- Edge case: thread_id not owned by the requesting org → 403.
- Edge case: 50+ pending rows in a single thread → caps at 50, logs warning.
- Error path: auth missing → 401.
- Error path: org admin check fails → 403.
- Integration: SSE drop mid-turn + reconnect → card re-appears from list endpoint within one request.
- Integration: idempotency replay (same request_id + idempotency_key) → pending-action events are re-emitted in the replay.

**Verification:**
- Killing the SSE connection mid-turn and reloading the panel recovers the card.
- Re-submitting the same chat request with the same idempotency key re-emits the pending-action event.

---

- [ ] **U6. Discard system line + documentation**

**Goal:** On Discard, emit a short system line ("Draft discarded") in the thread. Update `docs/agent/` docs to reflect the revise flow and new SSE event type.

**Requirements:** R3.

**Dependencies:** U2, U4.

**Files:**
- Modify: `src/components/ai-assistant/MessageList.tsx` — render a "Draft discarded" system line below the cancelled card (client-side marker; not persisted).
- Modify: `docs/agent/pending-actions.md` (or create if absent) — document the revise state machine, `previous_payload`, `revise_count`, the rehydration endpoint, and `pending_action_updated` SSE event.

**Approach:**
- System line is client-only. Persisting it would require a new message type; the transient UI marker is enough for v1.
- Doc update is required per repo convention: "When modifying AI agent code, update the relevant doc in `docs/agent/` to reflect structural changes, new features, or revised taxonomy." (CLAUDE.md.)

**Test scenarios:**
- Happy path: Discard click → card disappears, "Draft discarded" line appears, row status = cancelled via existing `/cancel` endpoint.
- Edge case: Discard on a card that has already been auto-cancelled (expired) → row is already cancelled, UI shows system line without double-API call.

**Verification:**
- `docs/agent/pending-actions.md` lists the two new columns, the new SSE event, the rehydration endpoint, and the 3-revise cap.

---

## System-Wide Impact

- **Interaction graph:** turn-execution-policy detects open pending-action → tool-call result handler branches create vs update → pending-actions row update CAS → SSE emits `pending_action_updated` → client state swap. Two new decision points (policy-side detection, handler-side branching).
- **Error propagation:** revise-limit rejection surfaces as a client-visible turn-level error chunk, not a silent no-op. Rehydration failures leave `state.pendingActions` empty until next successful turn.
- **State lifecycle risks:** race between Approve and Revise — if both fire concurrently, whichever CAS wins first locks the row. Approve wins over Revise (status `pending → confirmed` is the priority path). The losing Revise returns `{updated: false}` and surfaces "Already approved" in the UI.
- **API surface parity:** rehydration endpoint follows existing `/api/ai/[orgId]/pending-actions/…` pattern. No change to other callers of the pending-actions row.
- **Integration coverage:** the `prepare_events_batch` case (multiple pending rows from a single tool call, `handler.ts:5930-5948`) must continue to work — revise targets the batch as a whole or a single row? Decision: single-row revise only for v1; revising a batch falls back to "cancel and ask again" as it does today via `handler.ts:5460-5499`.
- **Unchanged invariants:** no change to (a) the nine `prepare_*` tool schemas, (b) the Approve commit path, (c) the existing `pending_action` / `pending_actions_batch` SSE events, (d) non-admin authorization (still admin-only), (e) the existing event-specific revise path at `handler.ts:5460-5499`.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Revise heuristic in turn-execution-policy misfires (treats unrelated user message as a revision). | Heuristic only *annotates* the turn with `pending_action_id`; the agent still decides whether to call `prepare_*`. Non-revise turns leave the row pending. U4 tests cover this. |
| `previous_payload` lookup slows pending-action creation for edit-type actions. | Populate-on-creation; if the source entity lookup adds > 200ms, defer to lazy fetch on card render. Deferred decision in Open Questions. |
| Diff UI for long-body announcements becomes unreadable. | 12-line collapse on both sections. Revisit after first soak; algorithmic diff is deferred. |
| Rehydration endpoint leaks pending actions across orgs or users. | Reuses existing `/api/ai/[orgId]/pending-actions/…` auth + org-scoping middleware. Tested in U5. |
| Idempotency replay re-emits a pending-action that's already been approved in another tab. | The replay re-emits whatever is currently `status = 'pending'` — if the action was approved between the first and second request, no `pending_action` is replayed (status changed). Client-side de-dupe on `action_id` handles the edge case where the client already has the row. |
| Event-specific revise at `handler.ts:5460-5499` conflicts with generalized revise. | Out-of-scope for this plan. Both paths coexist; event path consolidation is a deferred follow-up. |

---

## Documentation / Operational Notes

- Update `docs/agent/` (specifically a `pending-actions.md` doc, create if absent) — see U6.
- No monitoring changes required; existing `aiLog` calls around pending-action CRUD cover the new paths.
- No feature flag for v1. The capability is additive (no Approve behavior change; no `prepare_*` schema change). If a revise regression surfaces, disable via a client-side kill switch on the Revise button — deferred unless rollout surfaces a concern.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-23-inline-pending-action-diff-requirements.md](../brainstorms/2026-04-23-inline-pending-action-diff-requirements.md)
- Related code (codebase findings):
  - `src/lib/ai/pending-actions.ts`
  - `src/components/ai-assistant/PendingActionCard.tsx`
  - `src/components/ai-assistant/AIPanel.tsx:442-447, 599-669`
  - `src/hooks/useAIStream.ts:139-146, 263-289`
  - `src/lib/ai/sse.ts:10-45`
  - `src/app/api/ai/[orgId]/chat/handler.ts:4475-4528, 5460-5499, 5469-5483, 5930-5948`
  - `src/app/api/ai/[orgId]/pending-actions/[actionId]/confirm/handler.ts:126-180`
  - `src/lib/ai/tools/definitions.ts` (lines 278, 310, 353, 373, 397, 442, 467, 505, 919)
- Related plans:
  - `docs/plans/2026-03-27-fix-ai-confirm-handler-race-and-error-handling-plan.md` — CAS race fix precedent for U2.
- Related ideation: `docs/ideation/2026-04-23-ai-agent-improvements-ideation.md`
