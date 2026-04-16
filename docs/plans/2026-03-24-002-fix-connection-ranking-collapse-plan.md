---
title: "fix: Differentiate connection recommendations across source people"
type: fix
status: active
date: 2026-03-24
---

# fix: Differentiate connection recommendations across source people

## Overview

Connection prompts are no longer failing at routing or grounding, but they are still producing low-quality results in the test organization: different source people often receive the same or nearly the same top-ranked suggestions. The chat output varies only slightly in ordering, which makes the feature feel broken even when the pipeline is technically working.

The issue appears to be a ranking-input collapse rather than an AI-orchestration failure. The current chat route resolves the named source person correctly, calls `suggest_connections` directly, and renders the fixed connection template. The likely failure is that the scorer sees overly similar high-weight attributes across many candidates in the test org, so the same few “hub” people dominate every result set.

## Problem Statement / Motivation

This matters because connection suggestions are supposed to feel personalized. If Louis, Matt, and Matthew all get the same recommendations, admins lose trust in the people graph and in the AI assistant more broadly.

Local research suggests three contributing factors:

- `shared_company` is weighted highest at `40` in [src/lib/falkordb/scoring.ts](/Users/mleonard/sandbox/TeamNetwork/src/lib/falkordb/scoring.ts), and screenshots suggest many active members in the test org share a generic org-internal company value such as `TeamNetwork`.
- Members only project `current_company` and `graduation_year` from `members`, while `industry` and `current_city` come only from `alumni` in [src/lib/falkordb/people.ts](/Users/mleonard/sandbox/TeamNetwork/src/lib/falkordb/people.ts). For active members without alumni complements, the scorer often lacks the richer differentiators we want.
- The ranker has no “generic signal suppression” or diversity guardrails, so if the org data is homogeneous, the same candidate hubs win for everyone in both Falkor and SQL fallback.

The result is a product-level bug: rankings are technically deterministic, but they are not usefully individualized.

## Proposed Solution

Fix ranking collapse by making the scorer distinguish between meaningful professional affinity and generic org-internal overlap, while preserving Falkor/SQL parity and the current AI handoff contract.

### 1. Add source-aware ranking diagnostics

Before changing weights, add an explicit debug path around `suggest_connections` so we can inspect:

- resolved source profile fields used for scoring
- candidate reason breakdowns
- the top-N reason histogram per query
- overlap across multiple source people in the same org

Recommended implementation:

- extend `scripts/test-falkor-local.ts` to accept multiple source people or a “sample several people” mode
- emit per-source summaries:
  - normalized source company / industry / city / graduation year
  - top suggestions with reason codes and scores
  - pairwise overlap percentage between result sets
- add minimal structured observability around the tool executor or suggestion telemetry so local investigations do not depend only on chat screenshots

This should confirm whether the collapse is caused by generic `shared_company`, missing `industry`, dense mentorship hubs, or a combination.

### 2. Suppress generic company matches from dominating rankings

Treat org-internal or low-information company values as weak or ineligible `shared_company` signals for connection ranking.

Recommended rule for v1:

- normalize company values
- suppress `shared_company` when the value is effectively the org/platform identity rather than a real employer signal
- examples to treat as generic:
  - the organization name itself
  - the product/platform name such as `TeamNetwork`
  - obviously non-employer placeholders if found in source data

Implementation direction:

- add a helper in [src/lib/falkordb/scoring.ts](/Users/mleonard/sandbox/TeamNetwork/src/lib/falkordb/scoring.ts) or a nearby utility to classify company values as:
  - `career_signal`
  - `generic_org_signal`
- only award the `shared_company` weight when both source and candidate share a `career_signal`

This keeps company as a strong recommendation reason, but prevents a single generic org string from flattening the entire ranking space.

### 3. Rebalance ranking toward meaningful differentiation

Keep the advice-first posture, but retune the scorer so missing or generic company data does not collapse everything onto the same few candidates.

Recommended scoring posture:

- keep `shared_industry` as a dominant signal
- keep `shared_company` strong only when it is a real employer match
- preserve `shared_city`, `graduation_proximity`, and mentorship as fallback differentiators
- do not reintroduce `shared_major` in this pass

This may or may not require changing the literal numeric weights. The first decision should be made after instrumentation confirms how much of the collapse is caused by generic-company matches versus data sparsity.

### 4. Make sparse-member profiles more differentiable

Today, active members often have much less usable profile data than alumni because `industry` and `current_city` only come from alumni rows in [src/lib/falkordb/people.ts](/Users/mleonard/sandbox/TeamNetwork/src/lib/falkordb/people.ts).

Recommended scope for this fix:

- do not cross org boundaries
- keep current projection rules, but explicitly detect when the source profile is sparse
- ensure sparse sources can still rank meaningfully on:
  - `shared_city`
  - `graduation_proximity`
  - mentorship distance
- if needed, prioritize richer candidate reasons in tie-breaking when company is generic or absent

This keeps the current data model intact while reducing the tendency for sparse active-member sources to all converge on the same generic matches.

### 5. Preserve AI handoff and output contract

The AI route is not the main bug here, but it must stay in sync with any ranking changes.

Keep the current:

- direct-name routing to `members`
- `suggest_connections` as the single chat entry point
- display-ready payload shape
- fixed `Top connections for [name]` answer template
- connection-specific grounding

Only adjust the payload if new diagnostic metadata is needed internally. Do not make pass 2 interpret raw scoring semantics again.

## Alternative Approaches Considered

### Option A: Do nothing

Pros:

- no engineering work

Cons:

- connection output remains untrustworthy
- demo value stays low
- admins will keep seeing the same names for everyone

Recommendation: reject.

### Option B: Retune weights only

Pros:

- simple change
- quick to ship

Cons:

- does not address generic-company contamination directly
- risks replacing one collapse mode with another
- could still produce same outputs if the source data remains homogeneous

Recommendation: insufficient on its own.

### Option C: Add diagnostic instrumentation plus generic-signal suppression

Pros:

- directly targets the likely failure mode
- preserves current AI orchestration contract
- keeps Falkor and SQL fallback aligned

Cons:

- slightly broader than a one-line scoring tweak
- requires new regression coverage

Recommendation: choose this.

## Technical Considerations

- Both Falkor and SQL fallback must apply the same generic-company suppression rules in [src/lib/falkordb/suggestions.ts](/Users/mleonard/sandbox/TeamNetwork/src/lib/falkordb/suggestions.ts) and [src/lib/falkordb/scoring.ts](/Users/mleonard/sandbox/TeamNetwork/src/lib/falkordb/scoring.ts).
- The fix should remain org-scoped. We should not borrow profile attributes from other orgs just to create differentiation.
- The current projection model intentionally favors alumni professional fields over member rows when both exist. Any suppression logic must respect that merge contract in [src/lib/falkordb/people.ts](/Users/mleonard/sandbox/TeamNetwork/src/lib/falkordb/people.ts).
- Diagnostics should help explain why two sources produce similar outputs, not just record that they did.

## System-Wide Impact

### Interaction graph

User prompt -> [src/app/api/ai/[orgId]/chat/handler.ts](/Users/mleonard/sandbox/TeamNetwork/src/app/api/ai/[orgId]/chat/handler.ts) -> `suggest_connections` tool execution -> source resolution + projection in [src/lib/falkordb/suggestions.ts](/Users/mleonard/sandbox/TeamNetwork/src/lib/falkordb/suggestions.ts) -> scoring in [src/lib/falkordb/scoring.ts](/Users/mleonard/sandbox/TeamNetwork/src/lib/falkordb/scoring.ts) -> display-ready payload -> pass-2 fixed template -> grounding in [src/lib/ai/tool-grounding.ts](/Users/mleonard/sandbox/TeamNetwork/src/lib/ai/tool-grounding.ts).

### Error propagation

- source resolution failures still return `not_found` or `ambiguous`
- Falkor query failures still fall back to SQL
- ranking diagnostics must not throw hard errors in the chat path
- if diagnostic enrichment fails, connection suggestions should still render

### State lifecycle risks

This is a read-path bug. No persistent state changes are required beyond optional telemetry/logging. Main risk is behavioral drift between Falkor and SQL fallback if suppression logic is applied in one path but not the other.

### API surface parity

The same ranking rules must apply to:

- direct chat calls through `suggest_connections`
- Falkor mode
- SQL fallback mode
- local Falkor inspection scripts

### Integration test scenarios

- two distinct source people with different meaningful profile signals should not collapse to the same top-N list unless the org data truly warrants it
- a generic-company-only overlap should not outrank a real shared-industry match
- a sparse member source with no company/industry should still get differentiated results from city, graduation proximity, and mentorship
- Falkor and SQL fallback should continue to produce the same ranking behavior after suppression rules are added

## Acceptance Criteria

- [ ] Direct-name connection prompts still route correctly and return grounded results through the existing `suggest_connections` chat flow.
- [ ] Generic org-internal company strings such as platform/org identity values no longer dominate `shared_company` scoring.
- [ ] Two different source people in the same org no longer produce the same top-ranked list solely because they share a generic company value.
- [ ] If a source and candidate share a real employer, `shared_company` still contributes strongly.
- [ ] Sparse member profiles without company or industry still return differentiated suggestions when fallback signals exist.
- [ ] Falkor and SQL fallback continue to return equivalent results under the new ranking rules.
- [ ] Local diagnostics make it easy to inspect source attributes, candidate reasons, and result-set overlap for multiple source people in one org.

## Success Metrics

- Lower overlap across top-3 or top-5 connection result sets for different source people in the same org, except where data is truly identical
- Fewer screenshots/manual repros where multiple names return visually identical connection cards
- Increased presence of `shared_industry` and other meaningful reasons when the underlying data supports them

## Dependencies & Risks

### Dependencies

- current Falkor/SQL scoring parity tests in [tests/falkordb-people-graph.test.ts](/Users/mleonard/sandbox/TeamNetwork/tests/falkordb-people-graph.test.ts)
- tool executor tests in [tests/routes/ai/tool-executor.test.ts](/Users/mleonard/sandbox/TeamNetwork/tests/routes/ai/tool-executor.test.ts)
- local inspection script in [scripts/test-falkor-local.ts](/Users/mleonard/sandbox/TeamNetwork/scripts/test-falkor-local.ts)

### Risks

- over-suppressing company signals could make rankings feel too weak in orgs where company is genuinely the best advice signal
- adding ad hoc platform-name suppression without normalization could become brittle
- the underlying data may still be too sparse in some orgs, which means output similarity may be partially a data-quality problem rather than purely a scoring bug

## Test Plan

- Add a regression that compares results for multiple different source people in the same org and fails when all top suggestions collapse to the same list under generic-company conditions.
- Add unit tests for generic-company suppression in [src/lib/falkordb/scoring.ts](/Users/mleonard/sandbox/TeamNetwork/src/lib/falkordb/scoring.ts).
- Add parity tests to prove Falkor and SQL fallback apply the same suppression and return the same reason payloads.
- Extend the sparse-source test coverage so a member with no `current_company` and no `industry` still gets differentiated results from city, graduation proximity, and mentorship.
- Add a diagnostic script workflow test or documented manual verification path using [scripts/test-falkor-local.ts](/Users/mleonard/sandbox/TeamNetwork/scripts/test-falkor-local.ts) across several named sources in the test org.

## Sources & References

- Connection scoring and display payload: [src/lib/falkordb/scoring.ts](/Users/mleonard/sandbox/TeamNetwork/src/lib/falkordb/scoring.ts)
- Source resolution and Falkor/SQL ranking flow: [src/lib/falkordb/suggestions.ts](/Users/mleonard/sandbox/TeamNetwork/src/lib/falkordb/suggestions.ts)
- Person projection and attribute precedence: [src/lib/falkordb/people.ts](/Users/mleonard/sandbox/TeamNetwork/src/lib/falkordb/people.ts)
- Chat orchestration and fixed connection template: [src/app/api/ai/[orgId]/chat/handler.ts](/Users/mleonard/sandbox/TeamNetwork/src/app/api/ai/[orgId]/chat/handler.ts)
- Grounding contract: [src/lib/ai/tool-grounding.ts](/Users/mleonard/sandbox/TeamNetwork/src/lib/ai/tool-grounding.ts)
- Falkor architecture doc: [docs/agent/falkor-people-graph.md](/Users/mleonard/sandbox/TeamNetwork/docs/agent/falkor-people-graph.md)
