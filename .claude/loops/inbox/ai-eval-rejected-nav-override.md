# Rejected candidate — "route navigation intent to general surface"

**Loop:** ai-eval · **Verdict:** REJECT · **Date:** 2026-06-24 · **Baseline at time:** 10/10

## What the generator proposed

Add an early return in `resolveSurfaceRouting` (apps/web/src/lib/ai/intent-router.ts): when
`intentType === "navigation"`, force `effectiveSurface: "general"` so the assistant can "guide the
user." Rationale looked reasonable and the change typechecked.

## Why the evaluator rejected it

Recomputed the full golden set → **9/10, one regression**:

```
✖ "show me the roster" [analytics] → expected members, got general
```

`"show me the roster"` contains "show me", which `classifyIntentType` labels `navigation`. The proposed
early return then forced it to `general`, destroying the cross-surface reroute that golden row guards.
The generator was reasoning about "how do I…" phrasings and never considered that "show me X" is also
navigation-typed — exactly the blind spot a separate evaluator recomputing the *whole* set exists to catch.

## The real signal worth a human's judgment

There IS a genuine open question buried here: should a how-to query like *"how do I message a mentor"*
route to the members surface (current behavior — members keywords win) or to a general/help surface? That
is a product-UX call, not a keyword tweak, and it must not be made by silently overriding surface routing
for *all* navigation-typed messages. If pursued, it needs:

- a narrower signal than `intentType === "navigation"` (which over-matches "show me", "open", "go to"), and
- its own golden rows proving it doesn't regress the existing reroutes.

→ Left for a human. No classifier change shipped. Baseline unchanged at 10/10.
