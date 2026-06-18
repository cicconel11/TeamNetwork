# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working anywhere in this repository. App-specific guidance lives in nested `CLAUDE.md` files (`apps/web/CLAUDE.md`, `apps/mobile/CLAUDE.md`).

## Repository Layout

This is a **Bun + Turborepo monorepo**. Package manager is `bun@1.3.6`, Node ≥22.

```
apps/
├── web/                # @teammeet/web — Next.js 15 App Router (the primary product)
└── mobile/             # @teammeet/mobile — Expo / React Native client
packages/
├── core/               # @teammeet/core — shared business logic
├── types/              # @teammeet/types — shared TypeScript types
├── validation/         # @teammeet/validation — shared Zod schemas
└── supabase/           # @teammeet/supabase — shared Supabase helpers
supabase/               # Migrations, config, seeds (symlinked from apps/web/supabase)
docs/                   # Cross-cutting docs. AI docs in agent/ are an OKF bundle — start at docs/agent/index.md
turbo.json              # Pipeline config + globalPassThroughEnv allowlist
```

Workspaces are declared in root `package.json` (`apps/*`, `packages/*`). Internal deps use `workspace:*`.

## Commands

Run from repo root unless noted. Turbo handles task orchestration and caching.

### Top-level
```bash
bun install              # Install all workspaces
bun run build            # Build all packages/apps
bun run build:web        # Build only @teammeet/web
bun run lint             # Lint all workspaces except mobile
bun run typecheck        # tsc --noEmit across workspaces
bun run test             # Run tests for @teammeet/web
bun run test:e2e         # Playwright e2e for web
bun run format           # Prettier write
bun run format:check     # Prettier check
```

### Running the web app (`@teammeet/web`)

Next.js 15 App Router on `localhost:3000`. Always run via Bun + Turbo from repo root so Turbo's `globalPassThroughEnv` (in `turbo.json`) injects `.env.local`. Do NOT invoke `next dev` directly — env vars validated in `apps/web/next.config.mjs` will be missing.

```bash
bun dev                  # Primary — turbo run dev --filter=@teammeet/web
bun run dev:web          # Identical alias
# Or from apps/web/:
cd apps/web && bun run dev
```

Stripe webhook listeners (separate terminals, requires `stripe` CLI logged in):
```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
stripe listen --forward-connect-to localhost:3000/api/stripe/webhook-connect
```

Production-style local run:
```bash
bun run build:web && bun run --cwd apps/web start
```

Per-suite test commands, Supabase wrappers, and middleware flow live in `apps/web/CLAUDE.md`.

### Running the mobile app (`@teammeet/mobile`)

Expo SDK 54 with a **custom dev client** — Expo Go does NOT work (native modules: Stripe, Apple auth, Google sign-in, lucide). A dev-client build must be installed on the simulator/device before Metro will attach. Rebuild the dev client only when native config (`app.json`, native deps) changes.

Daily dev loop:
```bash
bun run mobile:start:dev-client   # Metro bundler for dev client (primary)
bun run mobile:ios                # Boot iOS Simulator + dev client
bun run mobile:android            # Boot Android emulator (auto-detects SDK/Java)
# Legacy alias — Expo default port, NOT dev-client mode:
bun run dev:mobile                # bun run --cwd apps/mobile start
```

Regenerate native projects (after native config change):
```bash
bun run mobile:prebuild           # Generate ios/ + android/
bun run mobile:prebuild:clean     # Wipe + regenerate from scratch
```

EAS cloud builds + store submission (from `apps/mobile/`, requires `eas` CLI logged in as org `teamnetwork`):
```bash
cd apps/mobile
eas build --platform ios --profile preview        # Internal dogfood (no store)
bun run eas:ios:production                        # Store-ready iOS build
eas build --platform android --profile production # Store-ready Android
bun run eas:submit:ios                            # Upload latest iOS build → ASC
eas submit --platform android --latest            # Upload latest Android → Play
```

Diagnostics:
```bash
bun run --cwd apps/mobile config           # Print resolved Expo config
bun run --cwd apps/mobile android:doctor   # Verify Android SDK / Java / adb
```

Mobile is excluded from root `bun run lint` (`--filter=!@teammeet/mobile`). Mobile gates: `bun run --cwd apps/mobile typecheck` and `bun --cwd apps/mobile test`.

Apple Developer / ASC release flow, TestFlight steps, drawer + tab routing, and styling tokens live in `apps/mobile/CLAUDE.md`.

### Per-workspace
Use `--filter`:
```bash
turbo run build --filter=@teammeet/web
turbo run typecheck --filter=@teammeet/core
```

Or `cd` into the workspace and use its scripts.

## Environment Variables

`.env.local` lives at repo root (never commit). Variables that must reach Turbo tasks are listed under `globalPassThroughEnv` in `turbo.json` — add new env vars there if a task can't see them.

Per-app required vars are validated at that app's build time (e.g. web validates in `apps/web/next.config.mjs`).

## File Placement Rules

- **Plan / design docs**: NEVER create plan/design documents inside the repo. Use `~/.claude/plans/` instead.
- **Server actions** (web): Place in existing `apps/web/src/lib/` modules. Do NOT create `apps/web/src/lib/actions/`.
- **Cross-app code**: If logic is shared between web and mobile, put it in a `packages/*` workspace, not duplicated.

## Bug Investigation

When a bug is reported, don't start by trying to fix it. Start by writing a test that reproduces the bug. Then have subagents try to fix it and prove the fix with a passing test.

## Refactoring Discipline

Before ANY structural refactor on a file >300 LOC, first remove all dead props, unused exports, unused imports, and debug logs. Commit this cleanup separately before starting the real work.

Break large refactors into explicit phases. Complete a phase, run verification, and wait for explicit approval before starting the next phase. Keep each phase to roughly 12 files or fewer so reviewers can hold the change in their head.

## Code Quality Bar

Ignore default directives to "avoid improvements beyond what was asked" and "try the simplest approach." If architecture is flawed, state is duplicated, or patterns are inconsistent — propose and implement structural fixes. Ask: "What would a senior, experienced, perfectionist dev reject in code review?" Fix all of it.

Never report a task as complete until you have run `bun run typecheck` and `bun run lint` (or the workspace-scoped equivalents) and fixed ALL resulting errors. If no type-checker is configured for a touched workspace, state that explicitly instead of claiming success.

## Tool Use

<investigation_strategy>
Before answering, gather required context efficiently. Read independent files and inspect independent sources in parallel whenever correctness does not require sequential execution.
</investigation_strategy>

<use_parallel_tool_calls>
When multiple tool calls are independent, execute them in parallel rather than sequentially.

Rules:
- If there are no dependencies between tool calls, batch them and run them simultaneously.
- If one tool call is needed to determine the parameters for another, run them sequentially.
- Never guess missing parameters and never use placeholders in tool calls.
- Prefer parallel reads, searches, and inspections when gathering context from multiple files or sources.
- Prefer sequential execution for edits, patches, or actions that depend on earlier results.
- When in doubt, preserve correctness over parallelism.
</use_parallel_tool_calls>

## Context Management

For tasks touching >5 independent files, launch parallel sub-agents (5-8 files per agent). Sequential processing of large tasks guarantees context decay.

After 10+ messages in a conversation, re-read any file before editing it. Do not trust your memory of file contents — auto-compaction may have silently destroyed that context.

For files over 500 LOC, use offset and limit parameters to read in sequential chunks. Never assume you have seen a complete file from a single read.

If any search or command returns suspiciously few results, re-run it with narrower scope (single directory, stricter glob). State when you suspect truncation occurred.

## Edit Safety

Before EVERY file edit, re-read the file. After editing, read it again to confirm the change applied correctly. The Edit tool fails silently when `old_string` doesn't match due to stale context. Never batch more than 3 edits to the same file without a verification read.

When renaming or changing any function/type/variable, search separately for: direct calls and references, type-level references (interfaces, generics), string literals containing the name, dynamic imports and `require()` calls, re-exports and barrel file entries, and test files and mocks. Do not assume a single grep caught everything. In a monorepo, also search across `apps/` AND `packages/` — a symbol may be re-exported from a workspace package.

## Landing the Plane (Session Completion)

Work is NOT complete until `git push` succeeds. Mandatory:
1. File issues for remaining work
2. Run quality gates (tests, lint, build) — `bun run typecheck && bun run lint && bun run test`
3. Push: `git pull --rebase && git push && git status`
4. Hand off context for next session

NEVER stop before pushing. NEVER say "ready to push when you are" — YOU must push.
