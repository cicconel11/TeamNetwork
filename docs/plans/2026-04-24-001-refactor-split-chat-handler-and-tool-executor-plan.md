---
title: "refactor: split chat handler + tool executor into cohesive modules"
type: refactor
status: active
date: 2026-04-24
intended_repo_path: docs/plans/2026-04-24-001-refactor-split-chat-handler-and-tool-executor-plan.md
---

> **Note on file location.** Plan-mode only permitted writes to `~/.claude/plans/`. Before implementation, move this file to the repo-relative path in `intended_repo_path` per the project's `docs/plans/YYYY-MM-DD-NNN-…` convention.

# Split Chat Handler + Tool Executor

## Overview

Two god-files own the AI chat request path and carry most of its change-risk:

- `src/app/api/ai/[orgId]/chat/handler.ts` — **6439 LOC**. Owns rate limit, auth, validation, safety gates, thread/idempotency, cache, RAG, prompt build, pass-1 tool selection, draft-session inference/merge, pending-event revision, SSE/model execution loop, deterministic formatters, grounding verify wiring, persistence, audit.
- `src/lib/ai/tools/executor.ts` — **3490 LOC**. A single switch dispatches 34 tools; each case pulls from a shared soup of local Zod schemas, auth rechecks, DB queries, schedule parsing, and pending-action prep.

Extract cohesive modules out of `handler.ts`, and collapse `executor.ts` + `tools/definitions.ts` (1106 LOC) into a per-tool registry. Pure refactor — no behavior change, no new capabilities, no new abstractions beyond what the current files already do implicitly.

---

## Problem Frame

Adding or changing one tool today touches: executor switch, executor local Zod schema, executor helpers, `tools/definitions.ts`, handler deterministic formatter, handler pass-1 tool-selection, grounding (`src/lib/ai/tool-grounding/claim-coverage.ts`), status text, and tests. The cross-cutting edit path is the bug. `docs/agent/assistant.md` §10 explicitly flags that handler.ts, tool definitions, and panel state "move quickly" and codemaps must be resynced — i.e., this split is already anticipated.

---

## Requirements Trace

- R1. `handler.ts` reduced to an orchestrator ≤ 800 LOC (target ~600, ceiling 800) whose sole job is sequencing already-defined collaborators.
- R2. Each extracted concern lives in one module with a single responsibility and no back-edge into `handler/index.ts`.
- R3. Every tool is defined by a single self-contained module: definition, args schema, access policy, execute, status label, deterministic formatter.
- R4. `tools/definitions.ts` becomes derived from the registry — no "add a tool, forget to register" failure mode. Registry produces exactly **34 tools** (matches current `AI_TOOLS.length` asserted by `tests/routes/ai/tool-definitions.test.ts`).
- R5. All existing tests pass unchanged, and all currently-exported handler/executor symbols (public surface) are preserved or re-exported.
- R6. Zero behavior change observable via SSE (stream shape, tool_status events, pending_action payloads, grounding fallbacks, audit rows). Measured indirectly via existing route test suites — no separate SSE-snapshot harness added.

### Tool inventory (R4 target set — 34 total)

- **Reads (22):** list_members, list_events, list_announcements, list_discussions, list_job_postings, list_chat_groups, list_alumni, list_enterprise_alumni, list_donations, list_parents, list_philanthropy_events, list_managed_orgs, list_enterprise_audit_events, list_available_mentors, get_org_stats, get_donation_analytics, get_enterprise_stats, get_enterprise_quota, get_enterprise_org_capacity, suggest_connections, suggest_mentors, find_navigation_targets.
- **Prepares / writes (10):** prepare_announcement, prepare_job_posting, prepare_chat_message, prepare_group_message, prepare_discussion_thread, prepare_discussion_reply, prepare_event, prepare_events_batch, prepare_enterprise_invite, revoke_enterprise_invite.
- **Schedule ingest (2):** scrape_schedule_website, extract_schedule_pdf.

U8 migrates 3 reads (pattern-setters). U9 migrates the remaining 19 reads. U10 migrates all 10 prepares. U11 migrates both schedule tools. 3 + 19 + 10 + 2 = 34.

---

## Scope Boundaries

- Not rewriting SSE protocol or `response-composer.ts`.
- Not changing grounding policy, safety-gate logic, or prompt templates.
- Not changing the set of tools or their argument schemas.
- Not migrating write-tools away from the pending-action pattern.
- Not touching `src/lib/ai/turn-execution-policy.ts` internals.
- Not introducing dependency injection frameworks or event buses — sub-modules stay plain functions taking explicit args.

### Deferred to Follow-Up Work

- Further reduction of `handler/index.ts` below ~600 LOC (likely possible but not required here).
- Splitting `prepare_*` writes into real write endpoints (unrelated architectural question).
- Generating `tools/definitions.ts` tool-description strings from JSDoc or similar (cosmetic improvement).

---

## Context & Research

### Relevant Code and Patterns

- `src/app/api/ai/[orgId]/chat/handler.ts` — target of Phase 1 split. Line-range map captured in implementation units below.
- `src/app/api/ai/[orgId]/chat/route.ts` — 6 LOC; delegates to `createChatPostHandler`. Only in-repo importer of handler.ts besides tests.
- `src/lib/ai/tools/executor.ts` — target of Phase 2 split.
- `src/lib/ai/tools/definitions.ts` — 1106 LOC of tool schemas; becomes derived.
- `src/lib/ai/tool-grounding.ts` — **already a 26-LOC barrel** over `tool-grounding/{verifier,claim-coverage,claim-extraction}`. Per-tool coverage already co-located by tool. Registry refactor inherits that shape; grounding stays verifier-driven, not per-tool-module-driven.
- `src/lib/ai/turn-execution-policy.ts` (535 LOC) — already centralizes cache/retrieval/context/tool decisions. Keep; do not re-derive.
- `src/lib/ai/response-composer.ts` (205 LOC) — owns SSE generator; keep.
- `src/lib/ai/{sse,pending-actions,safety-gate,audit,chat-telemetry,timeout,route-entity,context-builder,message-safety}.ts` — each already owns one concern. Handler sub-modules call them; do not fold them.
- `ChatRouteDeps` / `createChatPostHandler` factory pattern — existing IO-decoupling seam. Preserve as the single injection point.
- `ToolExecutionResult` discriminated union (`executor.ts` L130) — contract that formatters and grounding depend on. Preserve shape exactly.

### Institutional Learnings

- `docs/agent/chat-pipeline-codemap.md` and `docs/agent/assistant.md` describe the intended split: thin `route.ts` → testable `handler.ts` factory → concern-owning side-files. Plan aligns with documented direction.
- `CLAUDE.md` "Refactoring Discipline": phases ≤ ~12 files; wait for explicit approval between phases.

---

## Key Technical Decisions

- **Mechanical-move commits separate from any edit that changes logic.** "Mechanical move" here means: text relocated, imports repointed, function signatures preserved — no parameter sets reshaped, no logic rewritten. Judgment calls (which functions cluster in which file) are allowed inside a mechanical-move commit; any *shape improvement* (changing a signature, extracting a helper) lands in a follow-up commit. Review load stays flat.
- **Barrel-and-shim strategy for import stability.** During extraction, the original `handler.ts` and `executor.ts` file paths re-export new symbols so `route.ts` and test files keep working unmodified. Shims deleted in a final cleanup commit per phase.
- **One-way dep graph inside `handler/`.** `handler/index.ts` imports sub-modules; sub-modules never import from `handler/index.ts` or from each other except through `handler/shared.ts` for types.
- **Sub-module parameter convention.** Handler sub-modules (`cache-rag.ts`, `sse-runtime.ts`, etc.) accept a small `ChatRouteDeps` subset (only the fields they use) as an explicit object arg, *not* the full `ChatRouteDeps`. Keeps each sub-module's inputs grep-able and testable without a full deps fixture. No new "deps interface" type per sub-module — just structural subsets.
- **Registry shape stays narrow.** `ToolModule` carries `name | definition | argsSchema | access | execute | statusLabel | formatter?`. No `groundingPolicy` field — grounding is already owned by `tool-grounding/claim-coverage.ts` keyed on tool name; no reason to duplicate.
- **`definitions.ts` derived from registry.** `export const toolDefinitions = Object.values(registry).map(m => m.definition)` eliminates the dual-source failure mode.
- **Formatters move twice — accepted cost.** Phase 1 lands 22+10+2 formatters in `handler/formatters/{reads,prepares,schedules,connections}.ts` (one mechanical move from handler.ts). Phase 2 moves each into its owning tool module (34 micro-moves over U8–U11). The alternative — deferring all formatter extraction to Phase 2 — forces every U8–U11 commit to also touch handler.ts, making each migration larger. Two small moves beat one that drags handler.ts into every Phase 2 commit.
- **Pending-action builder ownership.** `tools/registry/shared/pending-action.ts` is the canonical home in the final shape. During Phase 1 the builders stay in `handler/pending-event-revision.ts` (U4). U10 moves them to registry/shared/; `handler/pending-event-revision.ts` imports from there after U10. No bidirectional edge at any point.
- **Dispatcher ≠ DI framework.** §Scope Boundaries rules out DI frameworks/event buses. The registry `dispatch(ctx, call)` helper is a plain function over a `Map<name, ToolModule>` — same shape as the current switch, different surface.
- **`ChatRouteDeps` stays the one injection seam.** Sub-modules receive structural subsets of it (see parameter convention above); no new deps interfaces.

---

## Open Questions — Deferred to Implementation

- Exact signature of per-sub-module context objects (`SseRuntimeContext`, `CacheRagContext`, etc.) — settle when the first sub-module lands and the parameter set becomes concrete. Per §Key Technical Decisions "Sub-module parameter convention": structural subsets of `ChatRouteDeps`, no new interfaces.
- Whether `tools/registry/shared/schedule.ts` should keep lazy `require` loaders or move to static imports — inspect bundle impact at extraction time in U11.

(Previously open questions — formatter location, grounding-policy field, route/UI touch — resolved inline in §Key Technical Decisions.)

---

## Output Structure

    src/app/api/ai/[orgId]/chat/
      handler.ts                         # shim re-exporting from ./handler (deleted end of Phase 1)
      route.ts                           # unchanged
      handler/
        index.ts                         # createChatPostHandler orchestrator (target ~600 LOC; ceiling 800)
        shared.ts                        # shared types (SseRuntimeContext, etc.)
        formatters/
          index.ts                       # formatDeterministicToolResponse dispatcher
          reads.ts                       # list_* formatters
          prepares.ts                    # prepare_* formatters
          schedules.ts                   # schedule extraction formatters
          connections.ts                 # suggest_connections (exported for tests)
        pass1-tools.ts                   # getPass1Tools, getForcedPass1ToolChoice, isToolFirstEligible
        pending-event-revision.ts
        draft-session.ts
        discussion-reply.ts
        sse-runtime.ts                   # buildSseResponse + runModelPass + model exec loop
        cache-rag.ts                     # cache lookup/write + RAG retrieval

    src/lib/ai/tools/
      executor.ts                        # thin dispatcher after Phase 2
      definitions.ts                     # derived from registry
      registry/
        index.ts                         # registry map + dispatch helpers
        types.ts                         # ToolModule<A, R> interface
        shared/
          db.ts                          # safeToolQuery, safeToolCount, truncateBody
          pending-action.ts              # buildPendingActionField + pending-event builders
          schedule.ts                    # cheerio/pdf loaders, MIME validation, normalize
          member-names.ts
        list-members.ts
        list-events.ts
        list-announcements.ts
        …                                # one file per tool (34 total)

---

## `ToolModule` Contract

```ts
interface ToolModule<A, R extends ToolExecutionResult> {
  name: string                              // matches definitions.ts
  definition: ToolDefinition                // moved from definitions.ts
  argsSchema: z.ZodType<A>                  // was executor.ts L151–441
  access: {
    surface: 'any' | 'enterprise' | 'org'
    billingOnly?: boolean                   // was ENTERPRISE_TOOL_NAMES / BILLING_ONLY
    inviteGate?: boolean                    // was ENTERPRISE_INVITE_TOOLS
    authorizationMode: 'user' | 'admin'     // was getToolAuthorizationMode
  }
  execute(args: A, ctx: ToolExecutionContext): Promise<R>
  statusLabel(args: A): string              // tool_status SSE text
  formatter?: DeterministicFormatter<R>     // moved from handler formatters in Phase 2
}
```

`dispatch(ctx, call)`: `mod = registry[call.name]` → `guard(ctx, mod.access)` → `mod.argsSchema.parse(call.args)` → `mod.execute(args, ctx)`. Single location for auth + billing + invite checks.

---

## Implementation Units

### Phase 1 — Handler split (6439 LOC → orchestrator target ~600, ceiling 800)

- [ ] U1. **Extract deterministic formatters**

**Goal:** Move `handler.ts` L438–2778 into `handler/formatters/` while preserving all exported symbols tests depend on.

**Requirements:** R1, R2, R5, R6

**Dependencies:** none

**Files:**
- Create: `src/app/api/ai/[orgId]/chat/handler/formatters/index.ts` (hosts `formatDeterministicToolResponse`, `formatDeterministicToolErrorResponse`, `resolveHideDonorNamesPreference`)
- Create: `src/app/api/ai/[orgId]/chat/handler/formatters/reads.ts`
- Create: `src/app/api/ai/[orgId]/chat/handler/formatters/prepares.ts`
- Create: `src/app/api/ai/[orgId]/chat/handler/formatters/schedules.ts`
- Create: `src/app/api/ai/[orgId]/chat/handler/formatters/connections.ts` (re-exports `formatSuggestConnectionsResponse`, `CONNECTION_PASS2_TEMPLATE`, `collectPhoneNumberFields`)
- Modify: `src/app/api/ai/[orgId]/chat/handler.ts` (re-exports from new location)
- Test: `tests/ai-suggest-connections-format.test.ts`, `tests/ai-safety-gate.test.ts` (unchanged — validate via barrel)

**Approach:**
- Relocate L438–2778 to `handler/formatters/`. Function bodies unchanged; only `import` statements and (for two functions that referenced handler-file-locals) narrow argument lists added.
- Cluster by tool-name prefix: `list_*` + `get_*` → `reads.ts`; `prepare_*` → `prepares.ts`; `scrape_schedule_website` + `extract_schedule_pdf` → `schedules.ts`; `suggest_connections` + `CONNECTION_PASS2_TEMPLATE` + `collectPhoneNumberFields` → `connections.ts` (kept separate for test-import stability).
- `handler/formatters/index.ts` owns the `formatDeterministicToolResponse` dispatcher + shared helpers (`resolveHideDonorNamesPreference`, `formatDeterministicToolErrorResponse`).
- `handler.ts` keeps `export { … } from "./handler/formatters"` for test compatibility until U7.

**Execution note:** Run formatter test suites before and after the move — they are the primary regression signal for this unit.

**Patterns to follow:** Existing split in `src/lib/ai/tool-grounding.ts` (barrel → submodules).

**Test scenarios:**
- Happy path: `tests/ai-suggest-connections-format.test.ts` passes unchanged.
- Happy path: `tests/ai-safety-gate.test.ts` passes unchanged (`collectPhoneNumberFields` still exported from `handler.ts`).
- Integration: `tests/routes/ai/chat-handler-tools.test.ts` passes — deterministic formatter path end-to-end.

**Verification:** `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run test:routes` all green. `handler.ts` shrinks by ~2340 LOC.

---

- [ ] U2. **Extract pass-1 tool selection**

**Goal:** Move `getPass1Tools`, `getForcedPass1ToolChoice`, `isToolFirstEligible` (L1925–2218) into `handler/pass1-tools.ts`.

**Requirements:** R1, R2, R5

**Dependencies:** U1

**Files:**
- Create: `src/app/api/ai/[orgId]/chat/handler/pass1-tools.ts`
- Modify: `src/app/api/ai/[orgId]/chat/handler.ts` (import + call site only)

**Approach:** Pure move. These three functions already take explicit args (surface, intent, attachments, enterprise flags); no closure over handler state.

**Patterns to follow:** Existing pure helpers in `src/lib/ai/context-builder.ts`.

**Test scenarios:**
- Integration: `tests/routes/ai/chat-handler.test.ts` — pass-1 tool selection still narrows correctly per surface and attachment.
- Edge case: enterprise surface omits non-enterprise tools (assert existing suite still passes).

**Verification:** Same commands as U1. `handler.ts` drops another ~290 LOC.

---

- [ ] U3. **Extract draft-session + discussion-reply helpers**

**Goal:** Move L2953–3776 (draft session) and L3777–4032 (discussion reply) into their own modules.

**Requirements:** R1, R2, R5

**Dependencies:** U1

**Files:**
- Create: `src/app/api/ai/[orgId]/chat/handler/draft-session.ts`
- Create: `src/app/api/ai/[orgId]/chat/handler/discussion-reply.ts`
- Modify: `src/app/api/ai/[orgId]/chat/handler.ts`

**Approach:** Pure move. All functions here are pure over `messages` + `currentMessage` inputs.

**Test scenarios:**
- Integration: `tests/routes/ai/chat-handler.test.ts` — draft continuation and discussion-reply clarification paths unchanged.
- Edge case: `inferDraftSessionFromHistory` returns null for empty history (existing suite).

**Verification:** Same commands. `handler.ts` drops ~1080 LOC.

---

- [ ] U4. **Extract pending-event revision helpers**

**Goal:** Consolidate two non-contiguous ranges (L2219–2317 + L3121–3319) into one `handler/pending-event-revision.ts` module. Both ranges describe the same concern (pending-event revise state machine); merging them in the new file is an intentional outcome, not a side effect.

**Requirements:** R1, R2, R5, R6

**Dependencies:** U1, U3

**Files:**
- Create: `src/app/api/ai/[orgId]/chat/handler/pending-event-revision.ts`
- Modify: `src/app/api/ai/[orgId]/chat/handler.ts`

**Approach:** Move `getPendingActionFromToolData`, `getBatchPendingActionsFromToolData`, `extractPendingEventRevisionOverrides`, `resolvePendingEventRevisionAnalysis`, `buildPrepareEventArgsFromPendingAction`, plus const tables `PENDING_EVENT_SINGLE_SCOPE_PATTERNS` and `SUPPORTED_EVENT_TYPE_LABELS`. `buildPrepareEventArgsFromPendingAction` stays here through U9; U10 flips its owner to `tools/registry/shared/pending-action.ts` and leaves this file re-importing from there (see §Key Technical Decisions — Pending-action builder ownership).

**Test scenarios:**
- Integration: pending-event revise flow in `tests/routes/ai/chat-handler.test.ts` — `pending_action_updated` SSE still fires; clarify/unsupported/apply branches unchanged.
- Edge case: unsupported event type → clarification payload.

**Verification:** Same commands. `handler.ts` drops ~300 LOC.

---

- [ ] U5. **Extract cache/RAG orchestration**

**Goal:** Move L4795–5012 (cache + RAG) and L6334–6396 (cache write) into `handler/cache-rag.ts`.

**Requirements:** R1, R2, R5, R6

**Dependencies:** U1

**Files:**
- Create: `src/app/api/ai/[orgId]/chat/handler/cache-rag.ts`
- Modify: `src/app/api/ai/[orgId]/chat/handler.ts`

**Approach:** Expose three functions: `checkCache(args) → CacheResult`, `retrieveRag(args) → RagResult`, `writeCache(args) → void`. Each takes an explicit object whose fields are a structural subset of `ChatRouteDeps` (only what that function uses) — per §Key Technical Decisions "Sub-module parameter convention". No new `CacheRagDeps` interface.

**Test scenarios:**
- Happy path: cache hit short-circuit returns cached SSE (existing suite).
- Happy path: cache miss → RAG retrieval → verify-ground (existing suite).
- Edge case: cache-bypass reason propagation.

**Verification:** Same commands. `handler.ts` drops ~280 LOC.

---

- [ ] U6. **Extract SSE/model execution loop**

**Goal:** Move L315–437 (SSE builder) + L5013–6333 (model exec loop) into `handler/sse-runtime.ts`. Largest extraction; highest review value.

**Requirements:** R1, R2, R5, R6

**Dependencies:** U1, U2, U4, U5

**Files:**
- Create: `src/app/api/ai/[orgId]/chat/handler/sse-runtime.ts`
- Modify: `src/app/api/ai/[orgId]/chat/handler.ts`

**Approach:**
- Export `buildSseResponse` and `runTurn(ctx) → { assistantMessage, groundingResult, toolResults }`.
- `runTurn` owns: stream boot, prompt-context build (delegates to `context-builder.ts`), pass-1 dispatch, deterministic fast-path render, pass-2 call, deterministic tool response render, grounding verify, fallback emission.
- Inputs: resolved `TurnExecutionPolicy`, thread/history, draft session, pending-event analysis, cache/RAG result, pass-1 tools, plus the `ChatRouteDeps` subset the loop actually calls (model client, SSE writer, audit logger, grounding verifier) — per §Key Technical Decisions "Sub-module parameter convention".
- Keep `runModelPass` as an inner adapter (not exported).

**Execution note:** Land behind aggressive test coverage — run `tests/routes/ai/chat-handler-tools.test.ts` after the move as canonical regression check.

**Test scenarios:**
- Integration: deterministic read-tool end-to-end → SSE shape matches snapshot.
- Integration: prepare-tool → `pending_action` event fires.
- Integration: grounding fallback triggers when model output unverified.
- Integration: pending-event revise clarify/apply branches produce correct SSE.
- Error path: tool execution error → `tool_status` error + deterministic error formatter.

**Verification:** Same commands + manual smoke (`npm run dev`, run one read + one prepare in chat UI). `handler.ts` drops ~1440 LOC; now near 600 LOC target.

---

- [x] U7. **Collapse handler barrel; update route + tests** — **N/A (premise invalid)**

**Resolution:** `handler.ts` was never a shim. It is the full implementation file (2441 LOC after Codex U6 conservative extraction). The `handler/` directory holds extracted helper modules (`cache-rag.ts`, `sse-runtime.ts`, `formatters/`, `pass1-tools.ts`, `discussion-reply.ts`, `draft-session.ts`, `pending-event-revision.ts`, `shared.ts`) that `handler.ts` imports from. `route.ts` imports `./handler` → resolves cleanly to `handler.ts`. Test files import `./handler.ts` directly. No shim window, no module-resolution ambiguity, nothing to collapse.

The plan assumed Phase 1 would land a `handler/index.ts` re-export shim during U1–U6 with `handler.ts` collapsing to it at U7. In practice U6 (Codex) deliberately left the runTurn loop in `handler.ts` rather than extract to `handler/index.ts`, so the prerequisite for U7 never materialized. Marking U7 N/A and proceeding to Phase 2 decision.

---

### Phase 2 — Tool registry (executor 3490 → thin dispatcher)

- [ ] U8. **Scaffold registry + migrate 3 read tools as pattern**

**Goal:** Establish `ToolModule` contract and registry dispatch, then migrate `list_members`, `list_events`, `list_announcements` end-to-end. These set the pattern others copy.

**Requirements:** R3, R4, R5, R6

**Dependencies:** U7 (clean handler baseline)

**Files:**
- Create: `src/lib/ai/tools/registry/types.ts`
- Create: `src/lib/ai/tools/registry/index.ts` (registry map + `dispatch(ctx, call)` helper)
- Create: `src/lib/ai/tools/registry/shared/db.ts`, `shared/pending-action.ts`, `shared/schedule.ts`, `shared/member-names.ts`
- Create: `src/lib/ai/tools/registry/list-members.ts`, `list-events.ts`, `list-announcements.ts`
- Modify: `src/lib/ai/tools/executor.ts` (switch delegates these three cases to `dispatch`; legacy cases untouched)
- Modify: `src/lib/ai/tools/definitions.ts` (remove the three migrated tools; append `...Object.values(registry).map(m => m.definition)`)
- Modify: `src/app/api/ai/[orgId]/chat/handler/formatters/reads.ts` (move three formatters into tool modules; re-export from handler formatters for test compatibility)

**Approach:**
- `ToolModule` interface matches High-Level Technical Design above.
- `dispatch` handles: access guard (`verifyExecutorAccess` + access-policy flags), `argsSchema.parse`, `execute`, error mapping to `ToolExecutionResult`.
- `handler/formatters/` routes through `registry[name].formatter` when present, falling back to legacy formatter for not-yet-migrated tools.

**Test scenarios:**
- Happy path: `tests/routes/ai/tool-executor.test.ts` exercises `list_members` through dispatch path.
- Integration: `tests/routes/ai/chat-handler-tools.test.ts` — deterministic formatter output byte-identical for the three migrated tools.
- Access: `tests/routes/ai/tool-executor-access-policy.test.ts` — non-admin forbidden still returns `forbidden` code.

**Verification:** All existing tests green. `executor.ts` unchanged for non-migrated tools.

---

- [ ] U9. **Migrate remaining read tools**

**Goal:** Migrate `list_discussions`, `list_job_postings`, `list_chat_groups`, `list_alumni`, `list_enterprise_alumni`, `list_donations`, `list_parents`, `list_philanthropy_events`, `list_managed_orgs`, `list_enterprise_audit_events`, `get_org_stats`, `get_donation_analytics`, `get_enterprise_stats`, `get_enterprise_quota`, `get_enterprise_org_capacity`, `suggest_connections`, `suggest_mentors`, `list_available_mentors`, `find_navigation_targets`.

**Requirements:** R3, R4, R5, R6

**Dependencies:** U8

**Files:** one per tool under `src/lib/ai/tools/registry/`; incremental edits to `executor.ts`, `definitions.ts`, handler formatters.

**Approach:** Land in 2-tool-per-commit batches (≤~12 files per batch per CLAUDE.md). No behavior change per tool.

**Test scenarios:** Existing executor + handler-tools suites cover each tool.

**Verification:** After each batch: `npm run test:routes`, `npm run test:unit`.

---

- [ ] U10. **Migrate prepare-\* tools**

**Goal:** Migrate `prepare_announcement`, `prepare_job_posting`, `prepare_chat_message`, `prepare_group_message`, `prepare_discussion_thread`, `prepare_discussion_reply`, `prepare_event`, `prepare_events_batch`, `prepare_enterprise_invite`, `revoke_enterprise_invite`.

**Requirements:** R3, R4, R5, R6

**Dependencies:** U9

**Files:** one per tool under `src/lib/ai/tools/registry/`; `registry/shared/pending-action.ts` hosts shared pending-action builders (`createEventPendingActionsFromDrafts`, `buildPendingEventBatchFromDrafts`, `normalizeAssistantDraft`, `mergeDrafts`, `buildPendingActionField`).

**Approach:** One tool per commit — prepare tools have highest review cost because of pending-action shape. Pending-event revise interplay checked after each.

**Test scenarios:**
- Integration: pending_action SSE payload byte-identical to pre-refactor for each prepare tool.
- Integration: pending-event revise (handler/pending-event-revision.ts × registry/prepare-event.ts) still emits `pending_action_updated`.
- Access: enterprise-only tools (`prepare_enterprise_invite`, `revoke_enterprise_invite`) still return `forbidden` for non-enterprise orgs.

**Verification:** After each prepare tool: full test suite + manual smoke of that tool's UI flow.

---

- [ ] U11. **Migrate schedule-ingest tools**

**Goal:** Migrate `scrape_schedule_website`, `extract_schedule_pdf`. Share the most helpers — do last.

**Requirements:** R3, R4, R5, R6

**Dependencies:** U10

**Files:**
- Create: `src/lib/ai/tools/registry/scrape-schedule-website.ts`, `extract-schedule-pdf.ts`
- Modify: `src/lib/ai/tools/registry/shared/schedule.ts` — cheerio/pdf lazy loaders, `extractScheduleTextFromPdfBuffer`, `normalizeScrapedScheduleText`, MIME validation, `createSignedScheduleUploadUrl`, `deleteScheduleUpload`.

**Test scenarios:**
- Happy path: PDF upload → text extracted → pending events built.
- Happy path: website scrape → normalized schedule text.
- Error path: unsupported MIME → deterministic error formatter.

**Verification:** Full suite + manual PDF upload smoke test.

---

- [ ] U12. **Collapse executor.ts to thin dispatcher; derive definitions.ts**

**Goal:** Delete the monolithic switch; `executor.ts` becomes `export { dispatch as executeToolCall } from "./registry"` plus verifier helpers. `definitions.ts` becomes a one-liner derivation.

**Requirements:** R3, R4, R5

**Dependencies:** U11

**Files:**
- Modify: `src/lib/ai/tools/executor.ts` (collapses to ~50 LOC)
- Modify: `src/lib/ai/tools/definitions.ts` (collapses to registry-derived export)
- Modify: `tests/ai-enterprise-tools.test.ts`, `tests/routes/ai/tool-executor.test.ts`, `tests/routes/ai/tool-executor-access-policy.test.ts` — update imports only.

**Test scenarios:** Existing suites are the check. Add one new test: `tests/routes/ai/tool-registry-parity.test.ts` asserts `definitions.ts` length equals registry size — guards against "add a tool, forget to register" regression.

**Verification:** `executor.ts` ≤ 100 LOC. `definitions.ts` ≤ 30 LOC. All suites green.

---

- [ ] U13. **Resync agent docs**

**Goal:** Update `docs/agent/chat-pipeline-codemap.md` and `docs/agent/assistant.md` per `assistant.md` §10 codemap-resync rule.

**Requirements:** R2, R3

**Dependencies:** U12

**Files:**
- Modify: `docs/agent/chat-pipeline-codemap.md`
- Modify: `docs/agent/assistant.md`

**Test scenarios:** none — doc update.

**Verification:** Manual review; paths in docs resolve to real files.

---

## Pre-existing Bugs — Fix Separately (Out of Scope for This Refactor)

Codex adversarial review (2026-04-24, branch `feat/ai-inline-pending-action-diff` vs `main`) surfaced two high-severity bugs in the pending-action revise feature that shipped on this branch *before* this refactor plan. They are **pre-existing** — the refactor preserves their behavior per R6 (zero behavior change) and must not fix them inline. Log here so they are not lost between phases.

### Bug A — Revise cap bypass in `createOrRevisePendingAction`

**Location:** `src/lib/ai/pending-actions.ts:318–372`

**Observed behavior:** When an active pending action is at the 3-revise cap, cancelled, executed, missing, mismatched by action type, or loses a CAS race, `createOrRevisePendingAction` falls through from the revise branch (L336–361) to `createPendingAction` at L363 unconditionally. A fourth revise silently creates a new row with `revise_count = 0`, defeating the cost/loop limit. Doc-comment at L318–322 acknowledges this as intentional ("always gets a draft") — so the bug is a specification-level disagreement with the cap invariant, not a slip.

**Scope of fix (estimate):**
- Change return type of `createOrRevisePendingAction` from `CreateOrReviseResult` to a union with an explicit failure arm: `| { record: null; revised: false; reason: "revise_limit" | "not_pending" | "not_found" | "conflict" | "action_type_mismatch" }`.
- When `input.activeActionId` is set and the precondition check (L339–344) fails, return the failure arm *without* falling through.
- When the precondition passes but `updatePendingActionPayload` returns `{ updated: false, reason }`, forward that reason as the failure arm.
- Only create a fresh row when `input.activeActionId` is *null/undefined* — i.e., no revise was attempted.
- Callers in `src/lib/ai/tools/executor.ts` (all `prepare_*` cases calling `createOrRevisePendingAction`) must handle the failure arm — most naturally by returning a `ToolExecutionResult` with `error.code = "revise_limit"` (or equivalent) and a deterministic error formatter surfacing "Maximum revisions reached — please confirm or start over" to the user.

**Files touched:** `src/lib/ai/pending-actions.ts`; every `prepare_*` case in `src/lib/ai/tools/executor.ts` that calls `createOrRevisePendingAction` (confirmed at L1368–1510 and elsewhere); unit tests for `pending-actions.ts`; route tests asserting cap behavior.

**Interaction with this refactor:**
- If Bug A is fixed **before** Phase 2 starts, U10 (migrate `prepare_*` tools) inherits the corrected contract — no extra work.
- If Bug A is fixed **during** Phase 2, the `prepare_*` registry modules (U10) must be updated *after* the fix merges; otherwise the registry codifies the broken contract into 10 new files.
- If Bug A is fixed **after** the refactor ships, touch points multiply (10 registry files + shared helpers vs 1 helper + ~10 executor cases today). Strong preference: fix before or during Phase 1.

### Bug B — Client drops `pending_action_updated` SSE event

**Location:** `src/hooks/useAIStream.ts:85–154` (`consumeSSEStream`)

**Observed behavior:** Server emits `pending_action_updated` at `handler.ts:5953` when a revise succeeds. Type is defined in `sse.ts:26–37`. But `consumeSSEStream` has no dispatch branch for that event — it falls through the if-chain at L113–146 and is silently dropped by the generic catch at L147. The user revises a draft, the DB row updates, and the card in the panel shows the stale payload and old revise count.

**Scope of fix (estimate):**
- Add `onPendingActionUpdated?: (event: Extract<SSEEvent, { type: "pending_action_updated" }>) => void` to `StreamCallbacks` interface (`useAIStream.ts:51`).
- Add dispatch branch after the `pending_action` case at L142, mirroring its shape.
- In the `useAIStream` hook body (L263+), implement the callback: replace the matching `actionId` entry in `pendingActions` state with the updated payload/reviseCount; preserve list ordering; no-op if no match.
- Thread through `AssistantLayout.tsx` — the `streamPendingActions` consumer at L111 already reads the hook's state; no UI change needed as long as state updates in place.
- Add route-level integration test asserting: send revise, observe `pending_action_updated` SSE, verify the panel's payload/reviseCount updated for the matching `actionId`.

**Files touched:** `src/hooks/useAIStream.ts`; `src/components/assistant/AssistantLayout.tsx` (verify state shape compatible, likely no change); new test in `tests/routes/ai/` or a new `tests/ai-stream-consumer.test.ts`.

**Interaction with this refactor:** Zero code overlap — client hook is not in scope of either phase. Can be fixed in parallel at any time. Blocks the revise feature's correctness regardless of refactor state.

### Recommended sequencing

1. File both as separate GitHub issues (or a single "revise feature correctness" issue with two checkboxes).
2. Fix **Bug A first** before starting Phase 2 / U10 — avoids codifying the broken contract into 10 new registry files.
3. Fix **Bug B in parallel** with Phase 1 — independent files, no merge conflict with the handler split.
4. Neither fix modifies this plan's scope; this plan continues unchanged once the fixes land.

---

## System-Wide Impact

- **Interaction graph:** `route.ts` → `handler/index.ts` → {`handler/*`, `lib/ai/*`, `tools/registry`}. No back-edges. No in-repo callers exist outside these paths.
- **Error propagation:** Unchanged. `ToolExecutionResult` union preserved; deterministic error formatter path preserved.
- **State lifecycle risks:** Idempotency, thread upsert, assistant-placeholder insert ordering must match exactly — run `tests/routes/ai/chat-handler.test.ts` between every unit.
- **API surface parity:** SSE event shape (`tool_status`, `pending_action`, `pending_action_updated`, `grounding_fallback`, `assistant_delta`) must be byte-identical. No public TypeScript type signatures change.
- **Integration coverage:** Existing route tests already cover cross-layer behavior (handler ↔ executor ↔ grounding ↔ SSE). Add only the parity test in U12.
- **Unchanged invariants:**
  - `ChatRouteDeps` interface — same fields, same factory contract.
  - `ToolExecutionContext`, `ToolExecutionResult`, `ToolExecutionErrorCode`.
  - `verifyExecutorAccess` defense-in-depth check — still runs before every tool.
  - Write-tool pending-action pattern — no tool mutates DB on behalf of the model.
  - Grounding per-tool coverage keyed by name in `tool-grounding/claim-coverage.ts`.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Silent SSE shape drift during extraction (e.g., buffered-text boundary moves). | Between every unit: run `tests/routes/ai/chat-handler-tools.test.ts` (asserts SSE events) and manual chat UI smoke of one read + one prepare tool. |
| Test imports pointing at `handler.ts` barrel break mid-refactor. | Keep shim re-export until U7; delete only after all sub-modules land. Same pattern for executor/registry in Phase 2. |
| Pending-event revise breaks because its helper moved but the consumer in sse-runtime did not update. | U4 lands before U6; U6's test scenarios include revise clarify/apply branches explicitly. |
| Access-policy regression on enterprise-only tools during registry migration. | U8 establishes the `guard(ctx, access)` pattern with `tool-executor-access-policy.test.ts` passing; subsequent units inherit it. |
| `definitions.ts` derivation emits tool definitions in nondeterministic order, breaking snapshot tests. | Registry uses a `Map` preserving insertion order; U12 parity test also asserts set equality, not array equality. |
| Lazy schedule loaders (`cheerio`, `pdf-parse`) regress bundle behavior after module move. | U11 keeps lazy require pattern verbatim; no static import substitution in this plan. |
| **Module-resolution ambiguity during Phase 1 shim window.** `handler.ts` (shim) and `handler/index.ts` both exist; Node/Next resolves `./handler` → `handler.ts` first. If a caller accidentally imports `./handler/index` vs `./handler`, two module instances can be loaded, duplicating top-level state. | During shim window (U1–U6): every sub-module imports its siblings via explicit `./handler/<name>` paths; `route.ts` keeps `./handler` → resolves to shim. U7 deletes `handler.ts` atomically with `route.ts` switching to `./handler/index` (explicit, not dir-resolution). Add a one-off check in U7: `grep -rn "\"./handler\"\|'./handler'" src tests` must return only `route.ts` before delete. |
| **Registry `shared/pending-action.ts` dep direction.** Phase-1 pending-event revision lives in `handler/pending-event-revision.ts` and needs `buildPrepareEventArgsFromPendingAction`. Phase 2 moves pending-action builders into `tools/registry/shared/pending-action.ts`. If handler imports from registry/shared, handler → registry dep appears; if registry imports from handler, the opposite back-edge appears. | Enforce one direction: `tools/registry/shared/pending-action.ts` is the owner; `handler/pending-event-revision.ts` imports from it. Phase 1 leaves a temporary re-export in `handler/pending-event-revision.ts` until U10 lands; no new back-edge. |
| **Existing `tests/routes/ai/tool-definitions.test.ts` asserts `AI_TOOLS.length === 34` and enumerates names.** After U12, registry must produce exactly those 34 tools in the same name set. | U12 parity test asserts set equality against `TOOL_NAMES`; pre-existing test is not modified. Registry count validated continuously across U8–U11 as each tool migrates (legacy switch + registry coexist; total stays 34). |
| **Plan file location.** Plan currently lives at `~/.claude/plans/highest-priority-improvements-1-split-generic-rocket.md`; repo convention is `docs/plans/2026-04-24-001-refactor-split-chat-handler-and-tool-executor-plan.md`. | First act of implementation: `git mv` (or plain move for new file) plan into the repo-relative path before starting U1. Mentioned in `intended_repo_path` frontmatter; made explicit as U0 below. |

---

## Pre-Phase-1

- [ ] U0. **Relocate plan to repo + confirm numbering**

**Goal:** Move plan file from `~/.claude/plans/` to `docs/plans/2026-04-24-001-refactor-split-chat-handler-and-tool-executor-plan.md`. Confirm `001` is next unused number for 2026-04-24 (last repo plan is `2026-04-23-001`).

**Requirements:** project convention (CLAUDE.md "File Placement Rules").

**Files:**
- Create: `docs/plans/2026-04-24-001-refactor-split-chat-handler-and-tool-executor-plan.md` (copy of this file)
- Delete: `~/.claude/plans/highest-priority-improvements-1-split-generic-rocket.md` (after copy succeeds)

**Verification:** `ls docs/plans/ | grep 2026-04-24` returns exactly one file.

---

## Rollout / Rollback

Pure refactor: no migration, env var, feature flag, or staged rollout. Revert = `git revert` of affected commits. No user-facing change; no release-notes entry. Doc resync owned by U13.

### Commit / PR boundary

One unit = one commit. Phase 1 = 7 commits (U0–U7). Phase 2 = 4 structural commits (U8, U11, U12, U13) + ~2-tool batches inside U9 (~10 commits) + one-tool-per-commit inside U10 (10 commits) = ~27 commits total. Batch into 2 PRs: PR-A = Phase 1 (+U0), PR-B = Phase 2. PR-A merges only after all Phase 1 tests green + manual chat-UI smoke. Approval gate between phases per `CLAUDE.md` refactoring discipline.

---

## Sources & References

- Target files: `src/app/api/ai/[orgId]/chat/handler.ts`, `src/lib/ai/tools/executor.ts`, `src/lib/ai/tools/definitions.ts`.
- Collaborators preserved: `src/lib/ai/turn-execution-policy.ts`, `src/lib/ai/response-composer.ts`, `src/lib/ai/tool-grounding.ts` (barrel over `tool-grounding/{verifier,claim-coverage,claim-extraction}`), `src/lib/ai/{pending-actions,safety-gate,audit,sse,context-builder,route-entity,message-safety,chat-telemetry,timeout}.ts`.
- Test suites that guard the refactor: `tests/ai-suggest-connections-format.test.ts`, `tests/ai-safety-gate.test.ts`, `tests/ai-enterprise-tools.test.ts`, `tests/routes/ai/chat-handler.test.ts`, `tests/routes/ai/chat-handler-tools.test.ts`, `tests/routes/ai/tool-executor.test.ts`, `tests/routes/ai/tool-executor-access-policy.test.ts`.
- Codebase guidance: `CLAUDE.md` (Refactoring Discipline), `docs/agent/assistant.md` §10 (codemap resync requirement).
