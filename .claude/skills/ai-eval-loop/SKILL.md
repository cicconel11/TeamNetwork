---
name: ai-eval-loop
description: >-
  Discovery + scoring skill for the TeamNetwork AI-eval loop. Invoked on a schedule, it finds
  candidate improvements to the deterministic intent classifier (resolveSurfaceRouting), scores every
  candidate against the committed golden set in .claude/loops/state/ai-eval-baseline.md, and lets a
  change through ONLY if it beats the baseline with zero regressions. The hard judgment — pass or
  reject — belongs to the separate `ai-eval-judge` agent; this skill discovers, runs the set, and
  records the score. It NEVER edits the golden set to make a change pass, and never touches the safety
  gate, access policy, or spend caps.
---

# ai-eval-loop — the discovery + persistence moves of the AI-eval loop

This is the AI-eval counterpart to `morning-triage`. Triage finds *work*; this finds *improvements to a
classifier and proves they don't regress*. Per the playbook, the evaluator is this loop's floor: a modest
generator (a keyword tweak) plus a sharp judge (the golden set) compounds, where a strong generator with a
weak judge ships confident garbage. The golden set is the sharpness.

## Read (the DISCOVERY inputs)

Read `.claude/loops/state/ai-eval-baseline.md` FIRST — it holds the golden set and the current `baseline`.
Then gather candidate improvements from, in order of trust:

- **Real misses (highest value)** — `apps/web/src/lib/ai/feedback-evals.ts` turns thumbs-down
  `ai_feedback` into eval candidates; `apps/web/src/lib/ai/feedback-golden-bridge.ts` converts each into
  a `GoldenRowProposal` carrying the real prompt, the surface, and what the *current* router does with it.
  Run `feedbackCandidatesToGoldenProposals(...)`; for each proposal a HUMAN sets the correct
  `expectIntent`/`expectSurface` (a thumbs-down means a human judged the turn wrong — only a human supplies
  ground truth, never this loop). A proposal whose `current` routing disagrees with the human's ground
  truth is the strongest possible row: a real user, a real miss, traceable by `feedbackId`. Promote it.
- **Open routing findings** — any `triage.md` row or issue describing a misrouted query.
- **The classifier itself** — `apps/web/src/lib/ai/intent-router.ts`. A candidate is a concrete diff
  (keyword added/removed, threshold flipped, tie-break rule changed) that aims to fix a failing golden row.

## Judge (the part that sets the ceiling)

The golden set's coverage is the whole loop's quality ceiling — a tweak that passes a thin set but breaks
real routing is worse than no change. So:

- A candidate is eligible only if it targets a **currently-failing** golden row (or one being added from a
  confirmed real miss). No speculative keyword churn.
- **Never edit the golden set to make a candidate pass.** The set encodes correct behavior, not the
  current behavior. If a candidate "fails" because the expected output is genuinely wrong, that is a
  separate, human-reviewed correction to the set — its own commit, never bundled with a generator change.
- Anything touching `safety-gate.ts`, `message-safety.ts`, `access-policy.ts`, or `spend.ts` is **out of
  scope** → inbox for a human. This loop tunes routing, never safety or money.

## Score + Write (the PERSISTENCE output)

For each eligible candidate:

1. Apply the candidate diff in an isolated worktree (handoff — never in the main checkout).
2. Run the golden set against `resolveSurfaceRouting` for **every** row (baseline rows + new rows).
   The runner is a deterministic node test (see `apps/web/tests/ai-fast-path-classifier.test.ts` for the
   house style — `node:test` + `assert/strict`, no live model). Record `passing / total`.
3. Hand the candidate + its score to the `ai-eval-judge` agent. It re-runs the set itself (never trust a
   score it did not compute) and returns PASS only if `candidate ≥ baseline` AND no previously-passing row
   regressed.
4. On PASS-that-beats-baseline: open a DRAFT PR with the classifier diff AND the golden-set additions, and
   bump `baseline:` to the new passing count + the candidate SHA in the same PR. On REJECT or tie: write
   the attempt to `.claude/loops/inbox/` and change nothing.

## Stop (the boundary you keep — DO NOT REMOVE)

- **Never merge, never auto-bump the baseline outside a reviewed PR, never force-push.** PRs open draft.
- **Never grow or edit the golden set to manufacture a pass.** That is the one move that hollows out this
  loop — it turns the judge into a rubber stamp.
- **Out of scope:** safety gate, access policy, spend caps, anything calling a live model in the scored
  path. Routing keywords and thresholds only.
- **No PII** in the golden set or inbox. Synthetic or anonymized inputs only.
- **Token cap:** stop after the configured per-run budget; no unbounded retry of a candidate that keeps
  failing — failing twice is an inbox item, not a third attempt.
