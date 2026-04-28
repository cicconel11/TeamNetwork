---
status: pending
priority: p1
issue_id: "001"
tags: [tests, quality-gates]
dependencies: []
---

# Stabilize Unit Quality Gates

## Problem Statement

`npm run test:unit` does not currently provide a clean signal for feature work because it fails in several unrelated areas outside the AI trust-boundary changes.

## Findings

- Current local run on 2026-04-28 is much narrower than the original finding: `npm run test:unit` fails only in `tests/media-albums-cache-wiring.test.ts` because its source-shape assertions still expected `AlbumGrid` to own album fetching after that state was lifted into `MediaGallery`.
- `npm run lint` and `npm run typecheck` pass locally as of 2026-04-28.
- The unit run failed during this session after the new AI safety and handler tests passed.
- One failure path was historically network-dependent captcha verification against provider APIs, which is not reliable in the current sandboxed environment.
- Additional unrelated failures came from pre-existing suites such as dashboard source assertions, form admin rework assertions, Google OAuth property tests, parent invite migration regressions, parent CRUD validation, and schedule sync tests.

## Proposed Solutions

### Option 1: Isolate external-network tests

**Approach:** Mock or explicitly skip outbound-network captcha cases in unit mode.

**Pros:**
- Restores deterministic CI signal.
- Reduces sandbox-specific noise.

**Cons:**
- Does not fix unrelated source/test drift.

**Effort:** 1-2 hours

**Risk:** Low

---

### Option 2: Triage and repair the current failing suites

**Approach:** Review each failing suite and either update stale assertions or fix the underlying regressions.

**Pros:**
- Restores trust in the full unit gate.
- Removes hidden repo drift.

**Cons:**
- Broader work item with multiple owners/areas.

**Effort:** 1-2 days

**Risk:** Medium

## Recommended Action

Align the media album cache wiring regression tests with the current lifted state architecture, then keep `npm run test:unit` as an explicit CI gate alongside lint, typecheck, and the focused AI gate.

## Technical Details

Affected commands:
- `npm run test:unit`

Observed failing areas:
- Current 2026-04-28 blocker:
  - `tests/media-albums-cache-wiring.test.ts`
- Historical 2026-03-23 blockers:
- `tests/captcha.test.ts`
- `tests/dashboard-counts.test.ts`
- `tests/form-admin-rework.test.ts`
- `tests/google-oauth.test.ts`
- `tests/parent-invite-migrations-regressions.test.ts`
- `tests/parents-crud.test.ts`
- `tests/schedule-connectors.test.ts`
- `tests/schedule-source-sync.test.ts`

## Resources

- Session evidence: unit run on 2026-03-23 during AI trust-boundary implementation

## Acceptance Criteria

- [ ] `npm run test:unit` passes in the standard local environment
- [ ] Captcha tests are deterministic or explicitly scoped out of unit mode
- [ ] Remaining failing suites are triaged and either fixed or intentionally deferred with documented rationale

## Work Log

### 2026-04-28 - Current-State Retriage

**By:** Codex

**Actions:**
- Ran `npm run lint`, `npm run typecheck`, and `npm run test:unit`.
- Confirmed lint and typecheck pass locally.
- Confirmed the unit gate has narrowed to two stale media album cache wiring assertions.

**Learnings:**
- The original broad unit-failure list is stale; the current fix should target the media album cache regression test shape, not captcha or older unrelated suites.

### 2026-03-23 - Initial Discovery

**By:** Codex

**Actions:**
- Ran `npm run test:unit` after implementing AI grounding and prompt-injection defense
- Confirmed new AI-focused tests passed
- Captured unrelated pre-existing unit failures blocking a clean repo-wide gate

**Learnings:**
- The repo-wide unit gate currently mixes deterministic unit coverage with network-sensitive and stale-suite failures

## Notes

- This issue is not caused by the AI trust-boundary changes from this session.
