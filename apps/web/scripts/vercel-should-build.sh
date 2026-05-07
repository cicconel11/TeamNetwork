#!/usr/bin/env bash
# Vercel Ignored Build Step.
#
# Point Vercel → Project Settings → Git → Ignored Build Step at:
#   bash scripts/vercel-should-build.sh
#
# Vercel convention:
#   exit 1 → build this commit
#   exit 0 → skip this commit (no Preview deploy, no minutes billed)
#
# Goal: stop burning minutes on exploratory branches, worktree scratch,
# and docs/test-only changes. Build main + intentional feature/fix/perf
# branches only, and only when code that affects the runtime changed.

set -euo pipefail

BRANCH="${VERCEL_GIT_COMMIT_REF:-}"
COMMIT="${VERCEL_GIT_COMMIT_SHA:-HEAD}"
PREV="${COMMIT}^"

log() { echo "[vercel-should-build] $*" >&2; }

if [[ -z "$BRANCH" ]]; then
  log "VERCEL_GIT_COMMIT_REF unset — defaulting to BUILD"
  exit 1
fi

# 1. Always build main (production deploy).
if [[ "$BRANCH" == "main" ]]; then
  log "branch=main → BUILD"
  exit 1
fi

# 2. Allowlist intentional working branches. Everything else is skipped.
#    Add new prefixes here if you start a new naming convention.
case "$BRANCH" in
  feat/*|fix/*|perf/*|refactor/*|chore/*|ci/*|feature/*|hotfix/*|release/*)
    log "branch=$BRANCH matches allowlist → checking file filter"
    ;;
  *)
    log "branch=$BRANCH not in allowlist → SKIP"
    exit 0
    ;;
esac

# 3. Skip if the diff only touches non-runtime files.
#    Docs, tests, plans, and editor configs don't need a Preview build —
#    reviewers click preview links for UI/behavior changes, not doc edits.
#
#    `git diff --quiet` exits 0 if there are NO matching changes,
#    which here means "every changed file matched the excludes" → skip build.
#
#    The `:!pattern` pathspecs are exclusions: we diff everything, minus
#    the patterns listed, and if nothing is left, there's no runtime change.
if git diff --quiet "$PREV" "$COMMIT" -- \
  ':!*.md' \
  ':!docs/**' \
  ':!tests/**' \
  ':!*.test.ts' \
  ':!*.test.tsx' \
  ':!.github/**' \
  ':!.vscode/**' \
  ':!.editorconfig' \
  ':!.gitignore' \
  ':!CLAUDE.md' \
  ':!README.md' \
  2>/dev/null; then
  log "diff only touches docs/tests/ci config → SKIP"
  exit 0
fi

log "branch=$BRANCH has runtime changes → BUILD"
exit 1
