---
date: 2026-04-23
topic: inline-pending-action-diff
---

# Inline Pending-Action Diff

## Problem Frame
The AI agent's pending-action HITL pipeline (the `prepare_*` family — announcements, jobs, discussion threads/replies, chat messages, group messages, events, events_batch) currently surfaces drafts through a **modal review** in the AIPanel. The modal breaks turn flow: admin composes in chat, gets yanked out to approve/reject in isolation, lands back in chat with a state gap. Revisions require re-prompting from scratch — the grounding the agent just assembled is lost, and the next draft is produced cold.

The pending-action pipeline is TeamNetwork's category moat. The review surface should compound trust per turn, not interrupt it.

## Requirements

- **R1.** Pending actions render as an **inline diff card** in the conversation thread instead of a modal. The card sits at the turn boundary where the `prepare_*` tool fired.
- **R2.** Card surfaces the four fields admins need to decide on: **what will be written** (the draft), **what it replaces** (if edit/reply; empty section if new), **target audience/recipient** (org, channel, thread, event attendees, etc.), **source** (which `prepare_*` tool produced it, with confidence/grounding chip if available from the verifier).
- **R3.** Card actions: **Approve**, **Revise via chat**, **Discard**. Approve commits via the existing pending-action commit path. Discard removes the pending state and posts a short system line ("Draft discarded"). Revise via chat is a no-op on the card itself — it unlocks the chat input with a hint like "Tell the agent how to revise this draft."
- **R4.** When the user types a revision instruction after clicking Revise, the next turn re-invokes the **same `prepare_*` tool** with the prior draft + user instruction as context. The pending-action row is updated in place (not appended) so the card in the thread refreshes.
- **R5.** **Revise loop cap: 3.** After 3 revise cycles on the same pending action, the card disables Revise and surfaces a hint: "Revision limit reached — approve, discard, or start over." This prevents runaway token cost and infinite loops on ungroundable drafts.
- **R6.** **Tall drafts collapse by default.** Cards over ~12 lines of draft body render collapsed with an expand affordance. Replaces-section follows the same rule independently.
- **R7.** **SSE reconnect recovers pending state.** If the SSE stream drops and reconnects mid-turn while a pending action is open, the card must re-hydrate from server state (not be lost or duplicated). The pending-action row in the DB is the source of truth; the card re-renders from it on reconnect.
- **R8.** **One pending action per turn.** If the agent produces a second `prepare_*` call before the first is resolved, either block the second or queue it visibly — do not stack two interactive cards silently.
- **R9.** **Keyboard parity with the modal.** Existing modal shortcuts (Approve, Discard) continue to work when a card is focused. Revise requires switching to the chat input, so no keyboard shortcut is needed for it.

## Success Criteria
- Admin can Approve / Revise / Discard a pending action without leaving the conversation thread.
- "Revise via chat" produces a new draft in ≤ one additional turn, with the prior draft visible on the card for comparison until the new draft replaces it.
- SSE drop + reconnect during a pending turn preserves the card and its state.
- No regression in the Approve commit path — every existing `prepare_*` tool still commits identically.
- Revise loop hard-stops at 3 attempts per pending action.

## Scope Boundaries

### In scope
- AIPanel conversation thread component (`src/app/[orgSlug]/chat/`).
- Pending-action state + row lifecycle (`src/lib/ai/pending-actions.ts`).
- Response composer SSE emission shape for pending actions (`src/lib/ai/response-composer.ts`).
- Revise-turn context assembly (prior draft + user instruction → same `prepare_*` tool).

### Out of scope (defer)
- Structured revision chips (Shorter / Change audience / etc.) — decided: free-form chat only for v1.
- Bulk pending actions (approve/discard N at once).
- Non-`prepare_*` tool cards (list_* / get_* responses stay as normal message bubbles).
- Confidence ribbon + source chips — separate ideation item #1 in `docs/ideation/2026-04-23-ai-agent-improvements-ideation.md`.
- Alumni / non-admin exposure — agent is still admin-only; inline card ships to admins only.

### Outside this feature's identity
- Not a general-purpose diff viewer.
- Not a message editor — Revise goes through the tool, not through direct card editing.
- Not a replacement for the full pending-action commit path — same downstream writes.

## Key Decisions

- **Free-form revise (not chips).** Matches existing chat mental model. Zero new UI on the card. Cost: revise instructions vary in quality; mitigated by the 3-loop cap.
- **Same-tool re-invocation for revise.** Reuses grounding and tool contract instead of hand-rolling a "modify draft" path. Prior draft rides in the tool context as a reference, not as a new tool.
- **Server state is source of truth.** Card re-hydrates from the pending-action row on SSE reconnect; no client-only pending state.
- **Update-in-place on revise.** The pending-action row is updated, not replaced, so the card stays at its thread position and the revise count increments on the row.
- **3-loop cap.** Hard ceiling, surfaced in UI. Token cost containment + forces a decision.
- **Modal stays for fallback.** If the thread is unavailable (e.g., action fired from a non-chat surface), the modal path remains as a fallback. Inline is the new default; modal is not deleted in v1.

## Dependencies / Assumptions
- Existing pending-action DB row already stores enough shape to render the card (draft body, target, source tool). **Verify in planning** — if the row lacks "what it replaces" for edit-type actions, the planner adds a column or derives it.
- Existing tool-grounding verifier emits a confidence signal the card can surface. **Verify in planning** — if not, card omits the chip for v1 and picks it up when ideation item #1 lands.
- SSE reconnect already re-reads server state on reconnect for other in-flight data. **Verify in planning.**

## Risks
- **Revise drift:** agent revises in a direction the user didn't want. Mitigation: prior draft stays visible until replaced; 3-loop cap.
- **Card clutter on long threads:** 10+ pending actions in a session could make the thread noisy. Mitigation: collapsed-by-default for tall drafts; approved/discarded cards collapse to a one-line summary.
- **Double-commit on reconnect race:** reconnect fires Approve twice. Mitigation: Approve path is already idempotent via the pending-action row state machine (verify in planning).

## Next Steps
→ `/ce:plan` for structured implementation planning.
