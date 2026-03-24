---
status: pending
priority: p2
issue_id: "002"
tags: [lint, quality-gates]
dependencies: []
---

# Fix Repo-Wide Lint Baseline

## Problem Statement

`npm run lint` currently fails on many unrelated files, which makes it hard to use as a merge-quality signal for targeted feature work.

## Findings

- The lint run during this session failed with a large pre-existing error set.
- A significant portion of the failures came from `.worktrees/blackbaud/...`, which should not block lint signal for the active workspace.
- Additional failures exist in main workspace Blackbaud files and older test files with `any` / unused variable issues.

## Proposed Solutions

### Option 1: Exclude auxiliary worktrees from lint scope

**Approach:** Update lint configuration or command scope so `.worktrees/` is not linted as part of the main repo gate.

**Pros:**
- Immediately removes noisy duplicate failures.
- Better matches the active workspace.

**Cons:**
- Leaves real lint debt in source and tests untouched.

**Effort:** < 1 hour

**Risk:** Low

---

### Option 2: Repair the current lint debt in active source/tests

**Approach:** Fix the existing `no-explicit-any` and `no-unused-vars` errors in active repo files.

**Pros:**
- Restores a meaningful repo-wide lint gate.
- Improves code health.

**Cons:**
- Broader cleanup unrelated to this feature.

**Effort:** 0.5-1 day

**Risk:** Medium

## Recommended Action

To be filled during triage.

## Technical Details

Affected command:
- `npm run lint`

Observed hotspots:
- `.worktrees/blackbaud/**`
- `src/app/api/blackbaud/**`
- `src/lib/blackbaud/**`
- `src/lib/linkedin/oauth.ts`
- `tests/blackbaud-*.test.ts`
- `tests/utils/supabaseIntegration.ts`

## Resources

- Session evidence: lint run on 2026-03-23 during AI trust-boundary implementation

## Acceptance Criteria

- [ ] `npm run lint` passes for the active workspace
- [ ] `.worktrees/` files are either excluded intentionally or brought to compliance
- [ ] Remaining active-source lint errors are fixed or documented as deferred

## Work Log

### 2026-03-23 - Initial Discovery

**By:** Codex

**Actions:**
- Ran `npm run lint` after implementing AI trust-boundary hardening
- Identified that the gate is failing on unrelated pre-existing files, especially under `.worktrees/blackbaud`

**Learnings:**
- The current lint command is broader than the active feature workspace and obscures targeted feature validation

## Notes

- This issue is not introduced by the AI trust-boundary changes from this session.
