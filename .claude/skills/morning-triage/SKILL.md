---
name: morning-triage
description: >-
  Discovery skill for the TeamNetwork triage loop. Invoked on a schedule (cloud cron or local /loop),
  it reads what changed since the last run — failed CI jobs, issues opened in the last 24h, commits
  merged since the last run — judges what is actually actionable, and writes findings to a state file
  on disk so the next run picks up where this one left off. It NEVER merges, deletes, or auto-ships;
  uncertain items go to an inbox for a human. This is the "discovery" + "persistence" half of a loop;
  handoff/verification are done by worktree agents + the `reviewer` evaluator agent.
---

# morning-triage — the discovery move of the loop

This skill is the **discovery** and **persistence** moves of the TeamNetwork triage loop
(see the Loop Engineering playbook: discovery → handoff → verification → persistence →
scheduling). It is deliberately small. It finds work and records it; it does not do the work.

The loop's quality ceiling is set here: surface noise and the other four moves run beautifully
in service of nothing. So judge hard, keep little.

## Read (the DISCOVERY inputs)

Gather, since the **last recorded run** (read `.claude/loops/state/triage.md` first to find it):

- **CI failures** — the `CI` workflow jobs that failed on `main` or open PRs:
  `test-unit`, `test-ai`, `test-mobile`, `migration-drift`, `validate-okf`, `build`
  (use the GitHub MCP tools `actions_list` / `get_job_logs`, scoped to `cicconel11/teamnetwork`).
- **Issues** opened or labeled in the last 24h (`list_issues`).
- **Commits** merged to `main` since the last run (`list_commits`).
- The **previous** `.claude/loops/state/triage.md` — so you don't rediscover handled work.

## Judge (the part that sets the ceiling)

For each candidate, decide — and write down the decision, not just the item:

- Is it **actionable now**, or noise (flake already retried, dependabot churn)? Skip noise.
- Does it **block a release** (App Store build, Stripe/webhook, wallet pass signing)? → `priority`.
- Is it **already tracked** by an open PR or an earlier `triage.md` row? → skip.
- Is the fix **small and well-scoped** (lint, flaky test, null-deref, stale dep)? → eligible for a
  worktree agent. Anything architectural or ambiguous → **inbox**, not a worktree.

Keep only what is worth opening a worktree for **today**.

### Known noise — skip or retry, never file (maintained list, raise the ceiling)

This is the discovery ceiling made explicit. Anything here is noise by default; treat it as such
unless it recurs across runs with a real signal. Add to this list when a new false-positive wastes a run.

- **Flaky tests** — retry once before filing; only file if it fails on retry. (No confirmed flakes
  catalogued yet — append `suite::test` here the first time one is confirmed flaky, not on first red.)
- **Dependabot / lockfile churn** — `dependabot/*` branches, `bun.lock` / `package.json` version-bump-only
  diffs: skip. Not triage work unless a bump breaks `build` or `test-*`.
- **`.env*.bak` / generated files** — backup and generated artifacts are not findings.
- **OKF / docs-only commits** — `validate-okf`-passing doc changes (`docs/agent/`, `docs/db/okf/`) are
  not actionable triage unless `validate-okf` itself fails.

## Write (the PERSISTENCE output)

Append/update `.claude/loops/state/triage.md`, one row per finding:

| finding | source | priority | status | run |
|---------|--------|----------|--------|-----|

`status` ∈ `new` → `worktree` → `pr-open` → `done` | `inbox` | `skipped`.
Commit the file back to the branch so tomorrow's run can read it. The agent forgets; the repo does not.

## Hand off (prepare the HANDOFF)

For each `new` finding small enough to fix, emit a task line for a worktree agent:

```
worktree=fix/<slug>  goal=<deterministic stop-condition>  e.g. "test/auth passes and lint is clean"
```

Each finding gets its **own** git worktree so parallel agents never touch the same files
(`Agent(..., isolation: "worktree")` in-session, or `claude --worktree` from the CLI).
The drafting agent is the **generator**; it must hand its diff to the `reviewer` agent
(the **evaluator**) before anything opens as a PR.

## Stop (the boundary you keep for yourself — DO NOT REMOVE)

This section is not boilerplate; it is the one place the loop's limits are written down.
The loop will faithfully do everything above and nothing this section forbids.

- **Never merge. Never delete. Never force-push.** PRs open in draft; humans merge.
- Anything you are **less than confident** about → `.claude/loops/inbox/` for a human, not a PR.
- **Token cap:** stop after the configured per-run budget; do not spawn unbounded retries.
- Touch only `cicconel11/teamnetwork`. Never act on secrets, billing, or production data.
