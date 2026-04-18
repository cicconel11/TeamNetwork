---
title: "feat: Mentorship Matching Phase 3 — AI Assistant suggest_mentors Tool"
type: feat
status: pending
date: 2026-04-17
origin: /Users/mleonard/.claude/plans/this-is-an-email-virtual-crystal.md
depends_on: "docs/plans/2026-04-17-002-feat-mentorship-phase-2-mentee-admin-flow-plan.md"
---

# feat: Mentorship Matching Phase 3 — AI Assistant suggest_mentors Tool

## Context

Phase 3 of a 3-phase mentorship matching build. Phase 1 shipped schema + matching library. Phase 2 shipped mentee intake + admin match queue + directory CTAs. Phase 3 adds AI assistant integration so admin or mentee can ask "who should mentor Jane?" in natural language and get scored, auditable matches.

**Differentiator vs PeopleGrove/Chronus**: no competing mentor platform has a natural-language AI assistant. Demoing the AIPanel returning ranked mentors with reason-code signals ("shared topics: finance, career-pivot · 6 yrs ahead") directly answers prospect's "weak algorithm" skepticism — it's auditable, not black-box.

**Current AI state** (documented via codebase exploration):
- 30 tools registered at `src/lib/ai/tools/definitions.ts:963-995` — **no `suggest_mentors` tool today**
- Closest: `suggest_connections` (career-affinity only)
- `CONNECTION_PROMPT_PATTERN` at `src/app/api/ai/[orgId]/chat/handler.ts:137` does NOT match `mentor|mentee`
- Intent router `src/lib/ai/intent-router.ts:38` only has `"mentorship"` keyword
- **Active hallucination guard** at `src/lib/ai/tool-grounding.ts:422-448` emits synthetic `unsupported_mentorship` code → rejects responses that claim mentorship semantics
- System prompt `src/lib/ai/context-builder.ts:575-629` never mentions mentor/mentee
- RAG embedding worker `src/lib/ai/embedding-worker.ts:37-45` ignores `mentor_profiles`, `mentorship_logs`, `form_submissions`
- Tool status label `src/components/ai-assistant/tool-status.ts:33` = `"Finding connections…"` (no mentor variant)
- AIPanel starter prompts `src/components/ai-assistant/AIPanel.tsx:166-171` — zero mentor prompts

**Note on `tool-grounding.ts:422-448`**: that block is `extractSuggestConnectionReasonCodes` — a *reason-code extractor* that synthesizes an `unsupported_mentorship` marker when mentorship language leaks into a `suggest_connections` response. The actual *rejection* lives in the availableCodes membership check at `src/lib/ai/tool-grounding.ts:583-593`. Phase 3 adds a sibling `verifySuggestMentors` that does not rely on that synthetic marker — `suggest_mentors` responses *are allowed* to mention mentorship semantics.

**Current user-visible behavior for "find me a mentor"**: AI returns a nav link to `/mentorship`. Nothing more.

**Design principle**: do NOT overload `suggest_connections`. Build a sibling tool. Keeps grounding verifier crisp, lets mentor scorer diverge from networking scorer, preserves clear separation in telemetry.

## Scope

~10 files modified/created. Estimated 3–4 days.

## Locked Decision — Amendment D: AI Auth Model

**Chosen: Option 1 — Admin-only v1.** Phase 3.5 (mentee-callable) deferred until `preverified_self_or_admin` executor scope exists.

- `suggest_mentors` runs only under existing `preverified_admin` check; admin queries for any mentee in their org.
- Mentees use Phase 2 directory + `MentorRequestDialog` (same scored signals via non-AI `/suggestions` API).
- §3.4 asserts `ctx.role === 'admin'` else returns `{state:"unauthorized"}`.
- §3.9 removes mentee-facing starter prompts and the mentee "Ask AI for a match" CTA.
- §3.10 telemetry still logs `caller_role, caller_user_id, auth_decision` for future 3.5 readiness.

## § 0 Reuse Audit (complete before §3.1 begins)

Single source of truth for `runSuggestMentors`. Inventory every export under `src/lib/mentorship/` and mark which are reused vs reimplemented. Reimplementing any of these is a plan violation.

| Module | Export | Reuse in `runSuggestMentors` |
| --- | --- | --- |
| `matching.ts` | `scoreMentorForMentee` | **YES** — per-mentor scoring |
| `matching.ts` | `rankMentorsForMentee` | **YES** — batch ranking |
| `matching.ts` | `MentorInput`, `MenteeInput` types | **YES** |
| `matching-signals.ts` | `loadMenteeIntakeInput` | **YES** — build MenteeInput from intake |
| `matching-weights.ts` | weight constants + reason code list | **YES** — import codes into grounding allow-list |
| `queries.ts` | mentor profile + alumni loaders | **YES** — candidate hydration |
| `presentation.ts` | signal-label helpers | **YES** — render `"Shared topics: finance, …"` labels |
| `schemas.ts` | Zod schemas for mentee intake shape | **YES** |
| `view-state.ts` | mentor/proposal view-state mappers | Re-use if card rendering shares shape |
| `calendar.ts` | schedule helpers | Out of scope for Phase 3 |

No new scoring, no new signal rendering, no new hard-filter logic. If a needed helper is missing, add it to `src/lib/mentorship/` (not to the AI layer).

## Tasks

### 3.1 RAG coverage — `src/lib/ai/embedding-worker.ts:37-45`

Extend `SOURCE_SELECTS`:
- `mentor_profiles` — index concat(`bio || ' ' || array_to_string(topics, ' ') || ' ' || COALESCE(industry, '')`); scoped by `organization_id`
- `mentorship_logs` — index `notes`, scoped by org via pair join
- `form_submissions` — index mentee intake responses. **MUST** scope by `organization_id` in the SELECT (the table holds cross-org rows). Filter by `form_id` matching the canonical mentee intake form seeded in Phase 2.

**Before coding**, grep `embedding-worker.ts:37-45` for the enqueue-helper name actually used by existing source rows (do NOT invent a trigger-based pattern). Mirror that helper exactly — no new enqueue mechanism.

Backfill via existing cron `src/app/api/cron/ai-embed-process/route.ts` — no code change to the cron itself; just new source rows queued.

### 3.2 Backend — new `src/lib/mentorship/ai-suggestions.ts`

**Location**: `src/lib/mentorship/ai-suggestions.ts` (SQL-based, reuses Phase 1 mentorship library — NOT under `src/lib/falkordb/` since this path has no graph dependency).

`suggestMentors(orgId, menteeUserId, opts)` — mirrors return shape of `src/lib/falkordb/suggestions.ts:721` `suggestConnections()`:

```ts
{
  state: "resolved" | "ambiguous" | "not_found" | "no_suggestions",
  mentee: DisplayReadyConnectionPerson | null,
  suggestions: DisplayReadyMentorSuggestion[],
  mode: "falkor" | "sql_fallback",
  freshness: { state, as_of, lag_seconds? },
  fallback_reason: GraphFallbackReason | null
}
```

**Scoring**: delegate to **`scoreMentorForMentee` at `src/lib/mentorship/matching.ts:80`** (per-mentor) and **`rankMentorsForMentee` at `:202`** (batch). Single source of truth for weights.

**Reuse (per § 0 audit)**: `matching-signals.ts` (`loadMenteeIntakeInput`), `matching-weights.ts` (reason codes), `queries.ts` (mentor/alumni hydration), `presentation.ts` (signal labels), `schemas.ts` (Zod).

**Hard filters**: already enforced inside `scoreMentorForMentee`. Do NOT restate or duplicate.

**Signal labels**: call `presentation.ts` helpers. Do NOT inline a signal-label example in this module.

### 3.3 Tool registration — `src/lib/ai/tools/definitions.ts`

Before `AI_TOOLS` array at line 995, add:

```ts
{
  name: "suggest_mentors",
  description: "Suggest mentors for a mentee within the organization. Use for mentor matching, pairing requests, or 'who could mentor X' questions. Filters to mentors accepting new mentees. Returns auditable signals for every match — never invent reasons beyond tool output.",
  parameters: {
    type: "object",
    properties: {
      mentee_id:     { type: "string", description: "User UUID of the mentee" },
      mentee_query:  { type: "string", description: "Name or identifier of the mentee if ID unknown" },
      focus_areas:   { type: "array", items: { type: "string" }, description: "Optional topic overrides (falls back to mentee intake)" },
      limit:         { type: "number", default: 5 }
    }
  }
}
```

Register in `AI_TOOLS` array.

### 3.4 Executor — `src/lib/ai/tools/executor.ts`

- Add `suggestMentorsSchema` Zod schema near line 383 (where `suggestConnectionsSchema` lives)
- Add `runSuggestMentors(args, ctx)` modeled on `runSuggestConnections:2842`:
  - **Auth gate (Amendment D Option 1)**:
    ```ts
    if (ctx.role !== 'admin') {
      return { state: "unauthorized", message: "suggest_mentors is admin-only in v1" };
    }
    ```
  - Resolves `mentee_id` from `mentee_query` via name/email lookup in `members` table (scoped to org)
  - Returns `{state: "ambiguous", disambiguation_options}` if multiple matches
  - Calls `suggestMentors()` from §3.2
- Add dispatch `case "suggest_mentors": return runSuggestMentors(args, ctx);` near line 3142

**"Request intro" CTA**: the UI renderer in §3.9 POSTs to Phase 2's `/api/organizations/[organizationId]/mentorship/requests` endpoint — which (post-Part-A.2) calls the `admin_propose_pair` RPC internally. The AI layer must NEVER re-implement the insert path. All proposal creation funnels through that RPC.

### 3.5 Handler wiring — `src/app/api/ai/[orgId]/chat/handler.ts`

- Line 130 (general surface pass-1 tools), line 132 (members surface pass-1 tools) — add `"suggest_mentors"` to both
- Near line 137 — new regex constant:
  ```ts
  const MENTOR_PROMPT_PATTERN = /(?<!\w)(?:mentor|mentors|mentee|mentees|pair\s+with|match\s+(?:me|us|them)\s+with)(?!\w)/i;
  ```
- Near line 251 — new `MENTOR_PASS2_TEMPLATE`:
  ```
  "Top mentors for [mentee name]:" + "\n" + per-mentor lines:
    "1. [Mentor Name] — [headline] · [topic tags] · grad [year] · [capacity]/[max] mentees"
    "   Why: [signals rendered as prose]"
  ```
- Near line 1611 — force-tool branch: `if (surface === 'members' && MENTOR_PROMPT_PATTERN.test(prompt)) { forcedPass1Tools = ['suggest_mentors']; }`
- Near line 422 (peer location of `formatSuggestConnectionsResponse`, a deterministic formatter — NOT a grounding guard) — new `formatSuggestMentorsResponse(data)` deterministic renderer; states `not_found | ambiguous | no_suggestions | resolved | unauthorized`
- Near line 2386 — add `case "suggest_mentors": return formatSuggestMentorsResponse(data);` to `formatDeterministicToolResponse`

### 3.6 Grounding verifier — `src/lib/ai/tool-grounding.ts`

- Near line 451 (where `verifySuggestConnections` lives) — add `verifySuggestMentors(line, toolData)`:
  - **Import reason codes from `src/lib/mentorship/matching-weights.ts`** — do NOT hard-list codes in this file; they must stay in lockstep with the scorer.
  - Scans pass-2 response for reason-code claims; rejects if LLM invents codes not in tool output. Actual rejection pattern mirrors `availableCodes` membership check at `src/lib/ai/tool-grounding.ts:583-593`.
  - Does NOT emit `unsupported_mentorship` — mentorship IS now supported via this tool.
- Wire into `verifyToolBackedResponse` at line 599 (add case for `suggest_mentors`).
- **Keep existing `suggest_connections` guard untouched** — it correctly rejects mentorship claims for the networking tool; regression risk if modified.
- **Canary test**: force the LLM to invent `"shared_alma_mater"` (not in allow-list) → grounding rejects + telemetry logs `grounding_rejected=true`.

### 3.7 Intent router — `src/lib/ai/intent-router.ts:30`

Add to `SURFACE_KEYWORDS.members` list: `mentor, mentors, mentee, mentees, coach, coaching, advisor, pair, pairing, match`

Verify: `action_request` classification still fires (the word `"suggest"` + these keywords) so handler's force-tool branch engages.

### 3.8 System prompt — `src/lib/ai/context-builder.ts`

- Line 604-608 (in-scope domains) — add mentorship as supported domain
- Line 619 (networking instruction) — add sibling line:
  ```
  "For mentor matching, mentee pairing, or 'who should mentor X' questions, call suggest_mentors directly. Do not invent matches — render only signals from tool output."
  ```

### 3.9 UI

**Reuse audit before building new surfaces** — AI results should deep-link into existing Phase 2 pages (`/admin/queue`, `/pairs/[pairId]`, `/tasks`, `/meetings`, `cron/mentor-match-expire`) rather than duplicate UI. Only the result card + CTA are new.

- `src/components/ai-assistant/tool-status.ts:33` — add `case "suggest_mentors": return "Finding mentors…";`
- `src/components/ai-assistant/AIPanel.tsx:166-171` — add admin-only starter prompts (Amendment D Option 1 → mentee prompts removed):
  - `"Suggest a mentor for [name]"`
  - `"Who could mentor new grads in finance?"`
- New renderer component `src/components/ai-assistant/SuggestMentorsResultCard.tsx`:
  - Card list: photo, name, topic tags, grad_year, capacity indicator, score, signals chips
  - `"Request intro"` CTA → opens a confirmation dialog (matches Phase 2 `MentorRequestDialog` UX per Open Q1) → on confirm POSTs to Phase 2's `/api/organizations/[organizationId]/mentorship/requests` with `{mentor_user_id}` → that endpoint calls `admin_propose_pair` RPC → writes `mentorship_pairs (status='proposed', match_score, match_signals)` atomically.
  - Inline state on success: `"Request sent — check your Proposals tab"`.
- `src/app/[orgSlug]/mentorship/page.tsx` — **mentee "Ask AI for a match" CTA removed in v1** (Amendment D Option 1). Admin surface already has AIPanel.

### 3.10 Telemetry

**`src/lib/ai/telemetry.ts` does NOT exist.** Choose ONE:
- Inline log in `runSuggestMentors` via existing `console.*` + structured JSON (match pattern used by other executor runners), OR
- Extend `src/lib/falkordb/telemetry.ts` with a `recordSuggestMentors(...)` helper.

Fields:
- `mentee_id`
- `candidate_count`
- `top_reason_codes` (array from top result)
- `grounding_rejected_bool`
- `tool_duration_ms`
- `caller_role` (admin, per Amendment D)
- `caller_user_id`
- `auth_decision` (`allowed` | `unauthorized`)
- `proposal_creation_outcome` (optional — `created` | `reused` | `blocked`, emitted from `/mentorship/requests` response to detect A.1/A.2-style regressions in production)

For later quality loop — lets us measure whether AI-suggested matches get admin-approved at similar rate to match-round-generated ones.

## Verification

1. `npx tsc --noEmit` + `npm run lint` — clean
2. `npm run test` — all existing tests pass
3. Start dev server — `npm run dev`
4. Manual E2E (AIPanel open on `/members` or `/mentorship`):
   - [ ] Type `"suggest a mentor for Jane Doe"` (using a Phase 2 test mentee)
   - [ ] Verify logs: intent router hit `mentor` keyword, MENTOR_PROMPT_PATTERN matched, `suggest_mentors` forced as pass-1 tool
   - [ ] Backend returned scored list; inspect tool response in network tab
   - [ ] Pass-2 rendered `"Top mentors for Jane Doe"` with per-mentor signal lines
   - [ ] Grounding verifier passed (no `unsupported_mentorship` emitted; no rejection)
   - [ ] Card renderer shows photo/topics/capacity/signals/CTA
   - [ ] Click `"Request intro"` → Phase 2 proposal inserted in DB → admin queue at `/mentorship/admin/matches` shows it
5. Negative regression checks:
   - [ ] Ask `"find networking connections for Jane"` → `suggest_connections` still fires (not `suggest_mentors`); response passes existing grounding
   - [ ] Ask `"is mentorship direct or second-degree?"` → if LLM tries to claim mentorship semantics via `suggest_connections`, `unsupported_mentorship` guard still rejects (Phase 3 did NOT weaken it)
   - [ ] Ask `"find me a mentor"` without a name → `suggest_mentors` returns `state=ambiguous` or resolves to caller; UI shows disambiguation
6. Telemetry check: inspect logged events match schema in 3.10

## Files

**Create**:
- `src/lib/mentorship/ai-suggestions.ts` (renamed from `src/lib/falkordb/mentor-suggestions.ts` — SQL-based, reuses Phase 1 mentorship library)
- `src/components/ai-assistant/SuggestMentorsResultCard.tsx`

**Modify**:
- `src/lib/ai/embedding-worker.ts` — add source tables + triggers
- `src/lib/ai/tools/definitions.ts` — register `suggest_mentors`
- `src/lib/ai/tools/executor.ts` — schema + runner + dispatch
- `src/lib/ai/tool-grounding.ts` — add `verifySuggestMentors`
- `src/lib/ai/intent-router.ts` — keyword list
- `src/lib/ai/context-builder.ts` — system prompt
- `src/app/api/ai/[orgId]/chat/handler.ts` — pass-1 tool lists, prompt pattern, pass-2 template, force-tool branch, formatter
- `src/components/ai-assistant/tool-status.ts` — status label
- `src/components/ai-assistant/AIPanel.tsx` — starter prompts
- `src/app/[orgSlug]/mentorship/page.tsx` — AI CTA

## Exit Criteria (final — sales-ready)

- [ ] All manual E2E steps pass
- [ ] All negative regression checks pass (especially `suggest_connections` + `unsupported_mentorship` still rejects as designed)
- [ ] Telemetry emits
- [ ] Full sales demo script runs end-to-end:
  1. Seed 20 alumni + 10 mentees (Phase 2 flow)
  2. Admin runs match round → admin queue → approves top-8 (Phase 2)
  3. Mentee #9 opens AIPanel, asks "who could mentor me in finance?" → scored list with signals → clicks Request intro → mentor accepts (Phase 3)
  4. Mentee #10 browses directory, sorts by Relevance → requests → admin approves (Phase 2)
  5. Mentor schedules Google Meet (existing pre-Phase-1 functionality)
  6. Admin opens reports → 10 active pairs, avg score + acceptance rate
  7. CSV export with scores + signals → hand to Eryca: "same audit trail as your Excel, auto-generated"

## Open Questions (resolved)

1. **Confirmation dialog on "Request intro" CTA** — **YES**. Match Phase 2 `MentorRequestDialog` UX.
2. **Role gating** — **admin-only v1** (Amendment D Option 1).
3. **Rate limit** — **10/hr per user** via `checkRateLimit` + `buildRateLimitResponse` at `src/app/api/ai/[orgId]/threads/handler.ts:24-29` (existing pattern).

## Demo Hardening (new — pre-requisite for sales demo)

Phase 2 pre-flight fixes (Part A of this plan's companion doc) land before any Phase 3 code. After A.1–A.3:

- **Dress rehearsal**: run the full demo script (see Exit Criteria below) in dev with a fresh seed BEFORE any sales call. Confirm every proposed row has `match_score IS NOT NULL`.
- **Prod monitor**: daily query `SELECT count(*) FROM mentorship_pairs WHERE status='proposed' AND match_score IS NULL AND deleted_at IS NULL` — alert if &gt; 0. Catches A.2-style regressions.
- **Regression suite**: `tests/mentorship-state-transitions.test.ts` must pass in CI (covers A.1–A.3).
