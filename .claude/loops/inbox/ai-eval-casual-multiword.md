# Finding — multi-word casual phrases are not classified as casual

**Loop:** ai-eval · **Type:** product question (NOT auto-fixable) · **Date:** 2026-06-24

## Observation

Discovery probe found:

```
"ok cool" [analytics] → intentType=knowledge_query   (expected: casual?)
"good morning team"   → intentType=casual            (matches a pattern)
```

`CASUAL_MESSAGE_PATTERNS` anchors single tokens (`/^(?:ok|okay|cool|...)$/`), so "ok cool" — two casual
words concatenated — does not match and falls through to `knowledge_query`. "good morning team" matches
because there is an explicit multi-word pattern for greetings.

## Why this is inbox, not a golden row

Whether "ok cool" *should* be casual is a judgment call, not settled behavior:
- Treating it as casual is friendlier but risks swallowing real two-word queries that happen to start
  with "ok"/"cool" (e.g. "ok show me events" — though navigation/keyword logic would still fire there).
- The safe fix is narrow: add specific multi-word casual patterns, not a broad "contains a casual word"
  rule. A broad rule would over-match.

This needs a human to decide the product behavior AND, if pursued, its own golden rows proving it does
not regress the keyword/navigation paths. Not promoted; no classifier change made.

→ Left for a human. Baseline unaffected.
