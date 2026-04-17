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

**Current user-visible behavior for "find me a mentor"**: AI returns a nav link to `/mentorship`. Nothing more.

**Design principle**: do NOT overload `suggest_connections`. Build a sibling tool. Keeps grounding verifier crisp, lets mentor scorer diverge from networking scorer, preserves clear separation in telemetry.

## Scope

~10 files modified/created. Estimated 3–4 days.

## Locked Decision (pending choice before Phase 3 starts) — Amendment D: AI Auth Model

**Problem**: AI executor runs with `preverified_admin` authorization (`src/app/api/ai/[orgId]/chat/handler.ts`, `src/lib/ai/tools/executor.ts`). A mentee-callable `suggest_mentors` either ships unreachable to mentees OR creates a special case that could expose another user's intake-derived match data.

Pick ONE before implementation starts. Remove this block once resolved.

### Option 1 — Admin-only v1 (lower risk, faster)

- `suggest_mentors` runs only under existing `preverified_admin` check; admin can query for any mentee in their org.
- Mentees use Phase 2 directory + `MentorRequestDialog` (same scored signals via non-AI `/suggestions` API).
- Scope cut: defer "mentee asks AI for mentors" to Phase 3.5 once mentee-scoped executor path exists.
- In this plan: resolve Open Question #2 to "admin-only v1"; REMOVE mentee-facing starter prompts from §3.9.

### Option 2 — Self-or-admin scoped auth

- Extend executor authorization kinds with `preverified_self_or_admin`.
- `runSuggestMentors` validates `args.mentee_id === ctx.userId` OR `ctx.role === 'admin'` server-side (never trust arg alone).
- Authorization-failure tool result if mentee_query resolves to different user.
- Integration test: mentee passes another user's `mentee_id` → tool returns auth failure.
- Adds ~1 day.

**Regardless of choice**: §3.4 adds auth flow pseudocode; §3.10 telemetry logs `caller_role, caller_user_id, mentee_id, auth_decision`.

## Tasks

### 3.1 RAG coverage — `src/lib/ai/embedding-worker.ts:37-45`

Extend `SOURCE_SELECTS`:
- `mentor_profiles` — index concat(`bio || ' ' || array_to_string(topics, ' ') || ' ' || COALESCE(industry, '')`); scoped by `organization_id`
- `mentorship_logs` — index `notes`, scoped by org via pair join
- `form_submissions` — index mentee intake responses (filter by `form_id` matching canonical intake form seeded in Phase 2)

Add triggers on each source table (INSERT/UPDATE) to enqueue into `ai_document_embedding_queue` (existing pattern from other sources).

Backfill via existing cron `src/app/api/cron/ai-embed-process/route.ts` — no code change to the cron itself; just new source rows queued.

### 3.2 Backend — new `src/lib/falkordb/mentor-suggestions.ts`

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

Internally delegates scoring to **Phase 1's `scoreMenteeAgainstMentors`** — single source of truth for weights. Do NOT duplicate scoring logic.

Hard filters (already enforced in Phase 1 scorer): `is_accepting_mentees=true`, capacity available, no existing pair.

Adds display-ready signal labels (e.g. `{code: "shared_topics", weight: 30, value: "finance, career-pivot", label: "Shared topics: finance, career-pivot"}`).

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
- Add `runSuggestMentors(args, ctx)` function modeled on `runSuggestConnections:2842`:
  - Resolves `mentee_id` from `mentee_query` via name/email lookup in `members` table (scoped to org)
  - Returns `{state: "ambiguous", disambiguation_options}` if multiple matches
  - Calls `suggestMentors()` from 3.2
- Add dispatch `case "suggest_mentors": return runSuggestMentors(args, ctx);` near line 3142

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
- Near line 422 — new `formatSuggestMentorsResponse(data)` deterministic renderer; states `not_found | ambiguous | no_suggestions | resolved`
- Near line 2386 — add `case "suggest_mentors": return formatSuggestMentorsResponse(data);` to `formatDeterministicToolResponse`

### 3.6 Grounding verifier — `src/lib/ai/tool-grounding.ts`

- Near line 451 (where `verifySuggestConnections` lives) — add `verifySuggestMentors(line, toolData)`:
  - Legitimate reason codes (must match Phase 1 weights): `shared_topics, shared_industry, shared_role_family, graduation_gap_fit, shared_city, shared_company`
  - Scans pass-2 response for reason-code claims; rejects if LLM invents codes not in tool output
  - Does NOT emit `unsupported_mentorship` — mentorship IS now supported via this tool
- Wire into `verifyToolBackedResponse` at line 599 (add case for `suggest_mentors`)
- **Keep existing `suggest_connections` guard untouched** — it correctly rejects mentorship claims for the networking tool; regression risk if modified

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

- `src/components/ai-assistant/tool-status.ts:33` — add `case "suggest_mentors": return "Finding mentors…";`
- `src/components/ai-assistant/AIPanel.tsx:166-171` — add mentor starter prompts for members/alumni surface:
  - `"Suggest a mentor for [name]"`
  - `"Who could mentor new grads in finance?"`
- New renderer component `src/components/ai-assistant/SuggestMentorsResultCard.tsx`:
  - Card list: photo, name, topic tags, grad_year, capacity indicator, score, signals chips
  - `"Request intro"` CTA → POSTs to Phase 2's `/api/organizations/[orgId]/mentorship/requests` with `{mentor_user_id}` → writes `mentorship_pairs (status='proposed', match_score, match_signals)`
  - Inline state on success: `"Request sent — check your Proposals tab"`
- `src/app/[orgSlug]/mentorship/page.tsx` — add `"Ask AI for a match"` CTA button opening AIPanel with pre-filled query for current user (if mentee)

### 3.10 Telemetry

Instrument `suggest_mentors` invocation logging (via existing `src/lib/ai/telemetry.ts` pattern if present, or inline in `runSuggestMentors`):
- `mentee_id`
- `candidate_count`
- `top_reason_codes` (array of reason codes from top result)
- `grounding_rejected_bool`
- `tool_duration_ms`

For later quality loop — lets us measure whether the AI-suggested matches get approved by admin at similar rate to match-round-generated ones.

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
- `src/lib/falkordb/mentor-suggestions.ts`
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

## Open Questions

1. Should AI `"Request intro"` CTA require an explicit confirmation dialog, or one-click? (security/UX — prefer confirmation for irreversible social action)
2. Should `suggest_mentors` be gated by role? Currently admin + mentee can call; mentor calling it for themselves makes no sense — gate to `active_member | admin` in executor.
3. Rate-limit on `suggest_mentors`? Expensive (graph query + scoring). Propose: 10/hr per user via existing rate-limit pattern.
