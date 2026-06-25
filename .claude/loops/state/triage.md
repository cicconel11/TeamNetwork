# Triage loop state (the loop's memory)

This file is the **persistence** move of the morning-triage loop. The agent forgets when
its context window clears; this file does not. Each run reads it to find the last run and
to avoid rediscovering handled work, then appends/updates rows and commits it back.

`status`: `new` → `worktree` → `pr-open` → `done`  ·  or `inbox` · `skipped`

| finding | source | priority | status | run |
|---------|--------|----------|--------|-----|
| _(seed — first real run replaces this row)_ | — | — | — | 0 |
