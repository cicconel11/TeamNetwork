#!/usr/bin/env bash
# Vercel Ignored Build Step.
#
# Vercel project setting → Git → Ignored Build Step →
#   bash scripts/vercel-should-build.sh
#
# Vercel convention:
#   exit 1 → build this commit
#   exit 0 → skip this commit (no Preview deploy, no minutes billed)
#
# This file lives at the repo root because Vercel's Root Directory is the
# repo root (not apps/web). The companion copy at apps/web/scripts is for
# direct invocation when the Root Directory is ever switched to apps/web.

set -euo pipefail

BRANCH="${VERCEL_GIT_COMMIT_REF:-}"
COMMIT="${VERCEL_GIT_COMMIT_SHA:-HEAD}"
PREV="${COMMIT}^"

log() { echo "[vercel-should-build] $*" >&2; }

if [[ -z "$BRANCH" ]]; then
  log "VERCEL_GIT_COMMIT_REF unset — defaulting to BUILD"
  exit 1
fi

# 1. Always build production-track branches.
#    `react-native` is the active monorepo trunk; `main` is the legacy single-app trunk.
case "$BRANCH" in
  main|react-native)
    log "branch=$BRANCH (production trunk) → BUILD"
    exit 1
    ;;
esac

# 2. Allowlist intentional working branches. Everything else is skipped.
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
