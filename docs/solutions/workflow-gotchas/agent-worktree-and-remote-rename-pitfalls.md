---
title: "Claude Code Worktree Inheritance and gh CLI Remote Mismatch After Repo Rename"
category: workflow-gotchas
problem_type: git_workflow
component: claude-code-agent-tool, gh-cli
severity: high
status: resolved
date: 2026-04-08
tags: [worktree, isolation, subagent, gh-cli, repo-rename, remote-url, multi-session, orchestration]
symptoms:
  - "Subagent fails with 'apps/mobile does not exist here' despite orchestrator targeting correct worktree branch"
  - "isolation: worktree subagents branch off parent session branch, not intended target branch"
  - "gh pr merge fails with 'no matching remote found; looking for owner/NewRepoName' while git push to same remote succeeds"
  - "gh subcommands reject old remote URL after GitHub repo rename even though git operations still work via redirect"
---

# Claude Code Worktree Inheritance and gh CLI Remote Mismatch After Repo Rename

Two procedural gotchas that hit a `/subagent-driven-development` session during the brand-logo integration plan ([`~/.claude/plans/inherited-shimmying-crab.md`](../../../../.claude/plans/inherited-shimmying-crab.md)). Both are invisible at plan time, both cost real debugging time, and both recur any time (a) a parent Claude session is on a branch that doesn't contain the plan's target files, or (b) a GitHub repo has been renamed and `origin` hasn't been updated.

## Symptoms

- A subagent dispatched with `isolation: "worktree"` reports "No such file or directory" for a path the plan explicitly names — typically `apps/mobile/...` on a monorepo branch while the parent session is on a pre-monorepo flat-layout branch.
- Multiple subagents in the same wave fail identically at a pre-flight `ls` check. The failure is structural, not per-agent.
- `git push origin <branch>` succeeds and prints `remote: This repository moved. Please use the new location: https://github.com/<new-owner>/<new-repo>.git` but `gh pr merge <n> --squash --delete-branch` fails immediately afterward with `no matching remote found; looking for <new-owner>/<new-repo>`.
- `gh pr view` and other `gh` subcommands produce the same "no matching remote" error on a repo where `git fetch` and `git push` still work normally.

## Root Cause

**Gotcha 1 — `isolation: "worktree"` branches off the parent session, not a specified target.** The Agent tool's `isolation: "worktree"` creates a new git worktree branched off the current session's active branch, not off any branch the orchestrator specifies in the prompt. There is no parameter to redirect this branching point. When the parent session sits on a branch that predates a monorepo restructure (e.g., `worktree-inherited-shimmying-crab`, a flat-layout branch), every isolated worktree the orchestrator spins up inherits that flat layout — even if the orchestrator has already created a separate worktree off the correct monorepo branch and passed its path to the subagent. The subagent's isolated copy simply does not contain directories that only exist on the target branch.

**Gotcha 2 — `gh pr merge` resolves repos by matching local remote URLs, not by following server-side redirects.** When a GitHub repository is renamed, GitHub sets up an HTTP redirect from the old slug to the new one. Git operations (`push`, `fetch`, `clone`) hit that redirect transparently. But `gh` subcommands that need post-merge branch cleanup (e.g., `gh pr merge --delete-branch`) perform a local slug match against `git remote -v` output before making any API call. If the local remote URL still references the old repo slug, `gh` cannot find a matching remote for the new slug and aborts — even though the underlying API call would succeed via redirect.

## Working Solution

### Gotcha 1 — `isolation: "worktree"` inherits wrong parent branch

**In-flight recovery (when subagents have already failed)**

Re-dispatch each failed subagent WITHOUT `isolation: "worktree"`. Pass the explicit absolute path of the pre-created target worktree directly in the prompt, and require the subagent to use that path for every file edit and every `git` command. Open the prompt with a mandatory pre-flight check:

```bash
ls /path/to/worktrees/brand-logo-mobile/apps/mobile/assets/
```

If the directory is missing, the subagent must STOP and report rather than proceed. Because the failed wave's tasks often touch disjoint files (e.g., landing / login / drawer), running them sequentially in the shared worktree without isolation is safe — no merge conflicts are possible.

When staging in a shared worktree, each subagent must stage only its own files:

```bash
# CORRECT — stage only the specific file this subagent owns
git add apps/mobile/app/(auth)/login.tsx

# WRONG — never do this in a shared worktree with concurrent subagents
git add -A
git add .
```

**Future avoidance (structuring the session correctly from the start)**

When the parent session's branch does not contain the plan's target files:

1. At the very beginning of the orchestration session, create a dedicated worktree off the correct branch:
   ```bash
   git worktree add /path/to/worktrees/my-feature-worktree react-native
   ```
2. Dispatch ALL subagents against that worktree path via an explicit absolute path in the prompt — do NOT use `isolation: "worktree"`.
3. Reserve `isolation: "worktree"` only for cases where the parent session's branch already contains all files the subagents need to edit. The isolated worktree will always match the parent's branch, so this is only safe when parent and target are the same branch.

### Gotcha 2 — `gh pr merge` "no matching remote" after GitHub repo rename

**Permanent fix (recommended for ongoing work)**

Update the local remote URL to match the new repo slug. This resolves the mismatch for all future `gh` and `git` operations:

```bash
git remote set-url origin https://github.com/cicconel11/TeamNetwork.git
```

Note: this modifies shared git config. If multiple worktrees share the same `.git` directory, this change affects all of them immediately. Coordinate with any other active sessions before running it — though the practical impact is minor (their next `git push` will go direct rather than via redirect).

**Session-local workaround (when you cannot mutate shared git config)**

Use the `-R owner/repo` flag on each `gh` command. This bypasses the local-remote lookup entirely and talks straight to the specified repo slug via the API:

```bash
gh pr merge 52 -R cicconel11/TeamNetwork --squash --delete-branch
gh pr view 52 -R cicconel11/TeamNetwork --json state,mergedAt
```

Use this when another session is actively using the same checkout and mutating the remote URL would be disruptive, or when you need a one-off fix without changing shared state.

## Prevention

### Pre-flight checks (before starting a session)

Run these before dispatching any subagent:

- **Verify branch contains plan's target files:**
  ```bash
  ls src/   # or whatever root the plan references; if "No such file or directory", stop
  git branch --show-current  # confirm you're on the intended branch, not a stale worktree base
  ```
- **Verify remote URL matches canonical GitHub slug:**
  ```bash
  git remote -v  # check origin URL; compare to expected owner/repo
  gh repo view    # if this fails with "no matching remote found", the remote URL is stale
  ```
- **Confirm `gh` CLI resolves the repo correctly:**
  ```bash
  gh repo view --json nameWithOwner -q .nameWithOwner  # must return expected "owner/repo"
  ```
- **If remote URL is stale after a repo rename, fix it permanently before continuing:**
  ```bash
  git remote set-url origin https://github.com/<new-owner>/<new-repo>.git
  ```
- **Spot-check one target file from the plan to confirm branch ancestry:**
  ```bash
  git log --oneline -5   # confirm recent commits match what you expect
  ls <plan-target-path>  # e.g., apps/mobile/package.json for a monorepo plan
  ```

### Session structure patterns

**Pattern A — "Shared worktree, no isolation"**

Use when: subagents must read or write files that exist only on the parent branch (e.g., a monorepo layout introduced in a branch the parent session already has checked out) and the `isolation: "worktree"` mode would branch off a stale or pre-restructure base that lacks those paths.

How: dispatch subagents without `isolation: "worktree"`. All subagents operate directly in the parent's working tree.

Tradeoffs and mitigations:
- No concurrent edits to the same file are safe. Mitigate by partitioning Wave tasks so each subagent owns a disjoint set of files; never let two subagents touch overlapping paths in the same wave.
- Use `git add <specific-file>` (never `git add -A` or `git add .`) to avoid accidentally staging another subagent's in-progress changes.
- Serialize waves: complete and commit Wave N before dispatching Wave N+1 to avoid merge conflicts in the working tree.

**Pattern B — "Native isolation"**

Use when: the parent session is already on the correct branch that contains all files the plan references, and subagents need true parallelism (e.g., independent feature modules with no shared files).

How: use `isolation: "worktree"` freely. Each subagent gets its own worktree branched off the current HEAD, which already has the correct file layout.

What's gained: true parallel execution with no staging interleaving risk; each subagent has an isolated index and working tree; PRs or commits can be reviewed and merged independently.

Safety condition: before switching to this pattern, confirm with the pre-flight `ls` check above that the current HEAD contains every path referenced in the plan. If any path is missing, fall back to Pattern A.

### Detection signals

- A subagent reports "No such file or directory" for a path the plan explicitly names — check whether `isolation: "worktree"` branched off a base that predates the file's introduction (worktree-inheritance gotcha).
- Multiple subagents in the same wave fail identically at a pre-flight `ls` or file-read step — the failure is structural, not per-agent; the branching point is wrong (worktree-inheritance gotcha).
- `gh pr view`, `gh pr merge`, `gh pr create`, or any `gh` command fails with the string `no matching remote found` — the local remote URL does not match the current GitHub repo slug (gh-remote gotcha); `git push` may still be succeeding through GitHub's server-side redirect, masking the problem.
- `git push` succeeds but `gh pr ...` commands fail immediately after on the same repo — classic symptom of a repo rename where GitHub redirects git-protocol traffic but `gh` does a local slug-match first (gh-remote gotcha).
- `gh repo view` returns a different `nameWithOwner` than the plan's documented repo slug — the remote URL is pointing at the old name and must be updated before any `gh` workflow commands are run.

## Related Documentation

### In this repo

None — this is the first documented workflow gotcha on the `react-native` branch. The existing `docs/` tree contains operational runbooks, compliance docs, and setup guides but no Claude-Code-tooling or orchestration notes. This doc establishes the `docs/solutions/workflow-gotchas/` category.

### In user dotfiles / rules

- `~/.claude/rules/git-workflow.md` — covers PR workflow (push with `-u`, `gh` usage, commit conventions) but does not yet mention the `-R owner/repo` flag or post-rename remote staleness. Should be cross-linked from its "Pull Request Workflow" section.
- `~/.claude/plans/inherited-shimmying-crab.md` — the plan that hit both gotchas during execution. Notes at line 6: *"The current worktree (`inherited-shimmying-crab`) is on a pre-monorepo branch and does not contain `apps/mobile/`. This plan will be executed in a new worktree created off the `react-native` branch."* Source-of-truth for the worktree-inheritance context.

### GitHub issues / PRs

None found. Searches against `cicconel11/TeamNetwork` for "worktree", "gh pr merge", and "repo rename" returned no matching issues or PRs.

### Suggested cross-references

- **`~/.claude/rules/git-workflow.md`** — add a note under "Pull Request Workflow" step 5: *"If `gh pr merge` fails with 'no matching remote found', the repo may have been renamed. Use `gh pr merge -R owner/repo` or update `origin` via `git remote set-url`. See `docs/solutions/workflow-gotchas/agent-worktree-and-remote-rename-pitfalls.md`."*
- **Repo-root `CLAUDE.md`** — the "Available Agents" section should flag the worktree-inheritance gotcha as a one-line callout before any agent that uses `isolation: "worktree"` for cross-branch work.
- **`docs/RUNBOOK.md`** — the "Rollback Procedures" and "Deployment" sections assume `gh` commands work; add a note pointing at this doc for the post-rename failure mode.
