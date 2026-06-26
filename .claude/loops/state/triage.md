# Triage loop state (the loop's memory)

This file is the **persistence** move of the morning-triage loop. The agent forgets when
its context window clears; this file does not. Each run reads it to find the last run and
to avoid rediscovering handled work, then appends/updates rows and commits it back.

`status`: `new` → `worktree` → `pr-open` → `done`  ·  or `inbox` · `skipped`

<!--
last_run: 619898d1 @ 2026-06-24
  The SHA + date this triage has already covered. The FIRST move of every run is to read this:
  "commits/issues/CI since last_run", not "since the beginning of history". Bump it (SHA = the
  HEAD this run covered, date = run date) as the LAST write of each run, in the same commit as
  the rows below. Without it the first run rediscovers all of history. This is the load-bearing seed.
  Discover in-flight PRs/branches LIVE each run (list_pull_requests) — do NOT hand-maintain them here;
  a pasted list goes stale the moment it's written.
-->

| finding | source | priority | status | run |
|---------|--------|----------|--------|-----|
| _(seed — first real run replaces this row)_ | — | — | — | 0 |
