# AI eval loop — golden set + baseline (the loop's memory)

This file is the **persistence** move of the AI-eval loop, and it is a *different kind* of memory
than the triage loop's state file. Triage memory records "what work was found." Eval memory records
**the bar a change must beat**: a curated golden set of inputs with their correct outputs, plus the
score the current `main` achieves on them. The evaluator reads this to answer one question — *did this
change beat the current bar, or regress it?* Without a committed baseline the loop has nothing to
gate against, and "is this AI change good?" collapses back to the generator grading its own homework.

The paper's claim for why this loop is worth building first among the AI loops: *"a modest generator
with a sharp judge produces slow, reliable progress, and the second is what compounds."* The golden
set is what makes the judge sharp.

## What it gates

`resolveSurfaceRouting` in `apps/web/src/lib/ai/intent-router.ts` — the pure, keyword-driven intent
classifier. It is deterministic (no live model call), so the golden set scores exactly and runs in CI
for free. A "generator" change here is a keyword added/removed, a threshold flipped, a surface-inference
rule changed. The loop's job: let those changes in only when they raise the score and regress nothing.

## How to read / update this file

- The **golden set** below is the source of truth for correct routing. Each row: an input message
  (+ the surface the user was on) → the intent / effective surface a correct classifier must return.
- `baseline` is the score `main` currently achieves on the set: `passing / total`. The evaluator
  recomputes it for the candidate change. **PASS only if candidate ≥ baseline AND no previously-passing
  row now fails** (no regressions, even if the total improves). On PASS that beats baseline, the
  baseline number is bumped in the same commit. On REJECT nothing changes.
- Grow the set from **real misses**: `apps/web/src/lib/ai/feedback-evals.ts` already turns thumbs-down
  `ai_feedback` into eval candidates. Promote a confirmed-correct candidate into a row here. Also add
  hand-authored **hard cases** (ambiguous, adversarial, empty) — the set's value is its coverage of
  the cases a keyword bump would silently break.

<!-- grammar (machine-parseable, do not break): `baseline: <P> / <T> @ <shortsha>`.
     P = passing count, T = total rows, shortsha = the commit the score was computed on.
     Any prose after the SHA (in parens) is an ignored human note. Parse only up to the SHA. -->
baseline: 20 / 20   @ 619898d1 (auto-loop turn 5: +3 edge rows — case-insensitivity, whitespace, analytics/events tie; 0 regressions)
<!-- bump `baseline` to the new passing count + the candidate's commit SHA only on a PASS that beats it -->
<!-- history:
     2/2 @ 619898d1 — seed (roster reroute + casual).
     proof-of-mechanism (2026-06-24): removing the "roster" keyword dropped 2/2 → 1/2 — the golden set
       caught a silent reroute regression that typechecks clean. Reverted; back to 2/2.
     5/5 @ 619898d1 (2026-06-24): turn 1 — promoted 3 hard cases (surface-guessing, empty, tie-break). PASS.
     9/9 @ 619898d1 (2026-06-24): turn 2 — promoted 4 cross-surface reroute rows (donor→analytics,
       games→events, create-event→events, bare 'mentor'→members). Evaluator recomputed 9/9, 0 regressions, PASS.
     10/10 @ 619898d1 (2026-06-24): turn 3 — REJECTION turn. Added the how-to row (current behavior:
       members keywords win → members). Generator then proposed "route navigation intent → general"; evaluator
       recomputed and REJECTED — it regressed "show me the roster" (9/10), since "show me" is navigation-typed.
       Classifier reverted, nothing shipped, attempt logged in .claude/loops/inbox/ai-eval-rejected-nav-override.md.
       The how-to row itself passes on main, so it stays as a regression guard. The floor said NO.
     17/17 @ 619898d1 (2026-06-24): auto-loop turn 4 — probed 10 fresh slices, promoted 7 verified-correct rows
       (delete-a-member action, send-announcement general-content beats events, 3-members-keyword dominance,
       job-postings→general, multi-word casual no-reroute, take-me-to-calendar nav, donation-trends reporting).
       Evaluator recomputed 17/17, 0 regressions, PASS. One finding ("ok cool" not casual — multi-word casual
       gap) was a product question → logged to inbox/ai-eval-casual-multiword.md, not promoted.
     discovery upgrade (2026-06-24): added feedback-golden-bridge.ts + test — real thumbs-down ai_feedback now
       converts to GoldenRowProposals (the loop's highest-value source), human sets ground truth. 4/4 tests pass. -->




## Golden set

`surface` is the surface the user was on when they sent the message (general | members | analytics | events).
`expectIntent` / `expectSurface` are what `resolveSurfaceRouting` must return. `note` says why the row exists.

Kept in sync with `apps/web/tests/ai-intent-golden.test.ts` — the loop adds a row in BOTH, same PR.

| input | surface | expectIntent | expectSurface | note |
|-------|---------|--------------|---------------|------|
| show me the roster | analytics | members_query | members | cross-surface pull → must reroute to members |
| thanks! | general | general_query | general | casual → no reroute, stays general |
| show me everything | members | general_query | members | no keyword match → must NOT guess a surface; stays put |
| _(empty string)_ | members | general_query | members | empty input → stable defined result, no throw |
| members donations | general | ambiguous_query | general | keyword collision (members + analytics tie) → ambiguous |
| who are our donors? | general | analytics_query | analytics | 'donor' keyword → reroute to analytics |
| upcoming games this week | general | events_query | events | 'games' → events, not analytics despite 'this week' |
| create an event for friday | members | events_query | events | action_request + events keyword → reroute to events |
| mentor | analytics | members_query | members | bare members keyword → reroute from analytics |
| how do I message a mentor | general | members_query | members | members keywords win; 'how do I' must not override surface |
| delete a member | general | members_query | members | action_request + members keyword → reroute |
| send an announcement | events | general_query | general | general-content keyword beats events surface → general |
| mentor and mentee connections donation | general | members_query | members | keyword-count dominance: 3 members > 1 analytics |
| any new job postings? | members | general_query | general | 'job'/'postings' are general-content → reroute to general |
| good morning team | members | general_query | members | multi-word casual greeting → no reroute, stays put |
| take me to the calendar | general | events_query | events | navigation phrasing + events keyword → events |
| donation trends by month | general | analytics_query | analytics | reporting language + analytics keyword → analytics |
| MEMBERS | general | members_query | members | case-insensitive match → uppercase still routes |
| `  roster  ` | analytics | members_query | members | whitespace-padded input normalized → still reroutes |
| donations and events | general | ambiguous_query | general | analytics vs events tie → ambiguous, stays put |

_Real-misses source is now wired: `feedback-golden-bridge.ts` converts thumbs-down `ai_feedback` into
GoldenRowProposals; a human sets ground truth and promotes. 17 rows now guard reroutes, dominance,
general-content, action requests, casual variants, navigation, reporting, and the tie-break. The set is
no longer purely synthetic — keep growing it from real proposals, not hand-authored churn._

## Hard cases to seed first (the coverage that catches silent regressions)

These are the rows worth writing by hand before trusting the loop, because they are exactly what a
careless keyword change breaks without any test going red:

- **Cross-surface pull** — "show me the roster" while on the *analytics* surface → must reroute to `members`.
- **Ambiguous** — "show me everything" → `ambiguous_query`, low confidence, no reroute (must NOT guess a surface).
- **Keyword collision** — a message containing both a members keyword and an analytics keyword → the
  documented tie-break, not whichever keyword list is checked first.
- **Empty / whitespace** — "" → a stable, defined result (not a throw, not a silent `general`).
- **Casual** — "thanks!" → `intentType: casual`, no surface reroute.

## Stop (the boundary — DO NOT REMOVE)

- The loop tunes a **classifier**, never the safety gate, access policy, or spend caps. Changes to
  `message-safety.ts`, `safety-gate.ts`, `access-policy.ts`, or `spend.ts` are **out of scope** and
  go to a human, never a worktree.
- Never widen the golden set to *make a change pass*. The set encodes correct behavior; it changes
  only when behavior is genuinely clarified, in its own commit, reviewed by a human.
- No PII in this file. Golden inputs are synthetic or fully anonymized — never a real member's name,
  email, or message copied from production.
