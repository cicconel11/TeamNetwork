# AI Agent Improvements — Ideation (2026-04-23)

**Focus:** Incremental improvements to existing TeamNetwork AI agent (`src/lib/ai/`, `src/app/api/ai/`, `src/app/[orgSlug]/chat/`). Raised bar, top 3, no moonshots. Stay within current architecture.

**Mode:** Repo-grounded.

## Grounding

- 35+ files in `src/lib/ai/`. 22 tools (list_*, get_*, prepare_* HITL, schedule scrape/pdf).
- pgvector RAG, tool-grounding verifier, Falkor people-graph, semantic cache (exact-match v1, 12h).
- Intent router + 2-axis taxonomy. Pending-action HITL pipeline is the moat.
- Admin-only today (~2% of user base).

## Top 3 Survivors (incremental, in-house)

### 1. Confidence Ribbon + Source Chips
Visible per-claim confidence + citation chips inline with agent responses. Wires existing tool-grounding verifier output into the chat UI. No new tools, no new infra — surface what's already computed.
- **Files:** `src/lib/ai/response-composer.ts`, `src/app/[orgSlug]/chat/` message component.
- **Confidence:** 85%, **Complexity:** Low.
- **Status:** Queued.

### 2. Inline Pending-Action Diff *(recommended to ship first)*
Replace modal pending-action review in AIPanel with inline diff card in conversation thread. Card shows: what will be written, what it replaces, target recipient/audience, source draft, Approve / Revise-via-chat / Discard buttons. "Revise via chat" re-runs the same `prepare_*` tool without leaving the turn.
- **Files:** `src/lib/ai/pending-actions.ts`, `src/lib/ai/response-composer.ts`, `src/app/[orgSlug]/chat/` AIPanel component.
- **Downsides:** Tall complex edits need collapse; cap revise loops at 3; SSE reconnect must recover pending state.
- **Confidence:** 88%, **Complexity:** Medium-Low.
- **Status:** Explored.

### 3. Self-Healing Verifier Loop
When tool-grounding verifier flags a response as ungrounded, auto-retry with tighter context + tool re-selection instead of silently passing to the user. One bounded retry; surface final confidence either way.
- **Files:** `src/lib/ai/verifier.ts`, `src/lib/ai/turn-execution-policy.ts`.
- **Confidence:** 75%, **Complexity:** Medium.
- **Status:** Queued.

## Rejection Summary

21 ideas cut from v2 raw candidates. Main cuts:
- **Ahead-of-audience:** B5 Agent-as-API/MCP, C2 Pit-Wall strategy tray.
- **Platform-scale (not incremental):** B7 Proactive Agent, A8 Alumni-Facing Agent, B6 Cross-Org Fan-Out, A6 Enterprise Multi-Org.
- **Infra-only without product surface:** B1 Signal Bus standalone, B8 Cache v2, B2 Memory Graph, B3 Workflow DSL.
- **UX polish too thin:** A7 generic card redesigns, C3 Ponder pre-fetch, C4 Dispatcher narration, C5 Radar badges, C8 DM recap.
- **Narrow fixes:** A4 Clarify-before-retrieve (absorbed into #1 via confidence chips).
- **Absorbed into survivors:** A2 (→ #1), A3 persistent memory (→ future), A5 digest (→ future once proactive lands), C1 classification board, C6 recovery advisor, C7 daylist.

See `/var/folders/wg/nh3kswgs62939jm9spr7fy0m0000gn/T/compound-engineering/ce-ideate/394e7c67/raw-candidates-v2.md` and `survivors-v2.md` for the v2 ideation pass this narrowed down from.
