# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
```bash
npm run dev          # Start Next.js dev server at localhost:3000
npm run build        # Build production application
npm run start        # Start production server
npm run lint         # Run ESLint
npm run gen:types    # Regenerate Supabase TypeScript types (writes to src/types/database.ts)
```

### Testing
```bash
npm run test            # Run unit + security + payment + route suites
npm run test:unit       # Run focused unit/integration suites
npm run test:security   # Run security-specific tests
npm run test:payments   # Test payment idempotency and Stripe webhooks
npm run test:routes     # Run route simulation suites
npm run test:schedules  # Test schedule domain verification and enrollment
npm run test:e2e        # Run Playwright end-to-end tests
```

Single test file: `node --test tests/your-test.test.ts` (uses `tests/ts-loader.js` for TypeScript).

### Stripe Webhook Testing (Local)
```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
stripe listen --forward-connect-to localhost:3000/api/stripe/webhook-connect
```

## Architecture

### Tech Stack
- **Framework**: Next.js 14 with App Router (TypeScript, React 18)
- **Database**: Supabase (PostgreSQL with RLS policies)
- **Authentication**: Supabase Auth with SSR
- **Payments**: Stripe (subscriptions + Stripe Connect for donations)
- **Email**: Resend
- **Styling**: Tailwind CSS

### Multi-Tenant SaaS Architecture
Organizations are first-class entities identified by slugs (e.g., `/[orgSlug]/members`). Middleware validates organization access on every request.

### Project Structure
```
src/
├── app/                    # Next.js App Router
│   ├── [orgSlug]/          # Dynamic org-scoped routes (calendar, chat, discussions, feed, forms, jobs, media, parents, philanthropy, etc.)
│   ├── app/                # Platform routes (/app/join, /app/create-org, /app/create-enterprise)
│   ├── auth/               # Auth flows (login, signup, callback)
│   ├── api/                # API routes (Stripe webhooks, org APIs, enterprise APIs)
│   ├── enterprise/         # Enterprise dashboard routes
│   └── settings/           # User settings (notifications)
├── components/             # Reusable UI components (ui/, layout/, feedback/, skeletons/)
├── lib/                    # Business logic and utilities
│   ├── auth/               # Role-based auth utilities
│   ├── supabase/           # Supabase client wrappers (server, client, middleware, service)
│   ├── payments/           # Payment idempotency & event handling
│   ├── security/           # Rate limiting, validation
│   ├── enterprise/         # Enterprise quota, pricing, adoption
│   ├── navigation/         # Navigation configuration
│   ├── schedule-connectors/ # External schedule importers (ICS, HTML parsers)
│   ├── schedule-security/  # Domain allowlist, SSRF protection
│   └── schemas/            # Zod validation schemas by domain (see index.ts for full list)
├── types/
│   └── database.ts         # Generated Supabase types
└── middleware.ts           # Global auth/routing middleware

supabase/migrations/        # Database migrations
tests/                      # Test files (unit, routes/, e2e/, fixtures/)
docs/agent/                 # AI agent architecture & feature docs
```

### Supabase Client Wrappers
Use the appropriate wrapper for each context:
- `lib/supabase/server.ts` — Server Components (uses cookies)
- `lib/supabase/client.ts` — Client Components (browser)
- `lib/supabase/middleware.ts` — Middleware (edge runtime)
- `lib/supabase/service.ts` — Admin operations (service role key)

### Role-Based Access Control
Four roles: **admin** (full access), **active_member** (most features), **alumni** (read-only), **parent** (selected features, requires org flag). Role normalization: `member` → `active_member`, `viewer` → `alumni`.

### Middleware Request Flow
Every request flows through `src/middleware.ts`:
1. Parse auth cookies and validate JWT
2. Refresh session if needed
3. Check if route is public vs. protected
4. Validate org membership for `[orgSlug]` routes
5. Redirect revoked users to `/app` with error
6. Enforce canonical domain

Public routes: `/`, `/demos`, `/terms`, `/privacy`, `/app/parents-join`, `/auth/*`. Bypassed: Stripe webhooks, `/api/auth/validate-age`, `/api/telemetry/error`. Org existence gating finalized in `src/app/[orgSlug]/layout.tsx`.

## Key Architectural Patterns

### Payment Idempotency System
Client generates stable `idempotency_key` (localStorage) → server creates `payment_attempts` row with unique constraint → duplicate requests return existing attempt/checkout URL → webhooks deduplicated via `stripe_events(event_id unique)`. States: `initiated`, `processing`, `succeeded`, `failed`. Files: `src/lib/payments/idempotency.ts`, `src/lib/payments/stripe-events.ts`.

### Soft Delete Pattern
Most tables use `deleted_at` timestamp. Always filter: `.is("deleted_at", null)` when querying.

### Stripe Connect Donations
Funds route directly to org's connected Stripe account, never touching the app. See `docs/stripe-donations.md`.

### Schedule Domain Allowlist & Security
External schedule URLs validated before import to prevent SSRF. Domain statuses: `denied` → `pending` → `active` / `blocked`. Files: `src/lib/schedule-security/allowlist.ts`, `safe-fetch.ts`, `verifyAndEnroll.ts`.

### AI Agent
Architecture, pipeline, and feature docs live in `docs/agent/`. When modifying AI agent code (`src/lib/ai/`, `src/app/api/ai/`, `src/app/[orgSlug]/chat/`), update the relevant doc in `docs/agent/` to reflect structural changes, new features, or revised taxonomy.

### Schema Validation
Centralized Zod schemas in `src/lib/schemas/` — see `index.ts` for all available domains. Usage: `import { schemaName } from "@/lib/schemas"`.

## Environment Variables

Required variables validated at build time in `next.config.mjs` — see that file for the complete list. Key optional vars:
- `RESEND_API_KEY` — Real email delivery (falls back to stub logging)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY` — Google Calendar
- `BRIGHT_DATA_API_KEY` — LinkedIn enrichment via Bright Data (~$1.50/1k lookups)
- `SKIP_STRIPE_VALIDATION=true` — Skip Stripe price ID validation in dev

Stored in `.env.local` (never commit).

## Key Files

- `src/middleware.ts` — Request interception, auth, org validation
- `src/app/[orgSlug]/layout.tsx` — Organization context provider
- `src/lib/auth/roles.ts` — `getOrgContext()`, `isOrgAdmin()`
- `src/lib/security/validation.ts` — Zod schemas, `sanitizeIlikeInput()`
- `src/lib/payments/idempotency.ts` — Payment deduplication
- `src/lib/schemas/index.ts` — Centralized validation schemas
- `docs/db/schema-audit.md` — Database schema docs and known issues

## File Placement Rules

- **Plan files**: NEVER create plan/design documents inside the repo (including `docs/plans/`). Use `~/.claude/plans/` instead.
- **Server actions**: Place in existing `src/lib/` modules. Do NOT create `src/lib/actions/`.

## Available Agents

Use these agents for the corresponding tasks:

- **planner** — Create implementation plans before starting any feature work. Use for breaking down tasks, identifying dependencies, and phasing work.
- **architect** — Use BEFORE making structural decisions that are hard to reverse: adding a new feature domain, designing RLS policies, changing multi-tenant data boundaries, refactoring middleware, evaluating queue vs. inline processing, or any decision that will affect multiple files/tables and that someone will ask "why did we structure it this way?" 6 months from now. Do NOT use for bug fixes or changes that follow established patterns.
- **tdd-guide** — Enforce write-tests-first for all new features and bug fixes.
- **reviewer** — Combined code quality + security review after writing or modifying code.
- **build-error-resolver** — Proactive on build or TypeScript errors.
- **refactor-cleaner** — Dead code cleanup and consolidation.
- **e2e-runner** — Playwright end-to-end tests.
- **Explore** — Deep codebase exploration when Glob/Grep are insufficient.
- **compound-engineering:data-integrity-guardian** — Migration safety, RLS constraints, transaction boundaries.
- **compound-engineering:security-sentinel** — Full OWASP security audit before sensitive merges.
- **compound-engineering:performance-oracle** — Performance bottlenecks, query analysis, scalability review.

## Project-Scoped Skills

- **/screenshot-debug** — Debug bugs from screenshots. Extracts error info, launches Explore agent to investigate, uses Supabase MCP to check data/RLS state, proposes targeted fix. Use when sharing error screenshots.
- **/apply-migration** — Apply Supabase migrations with pre-filled project ID (`rytsziwekhtjdqzzpdso`). Reads migration file and calls `apply_migration` MCP tool.

## Agent Principles

### 1. Think Before Coding
Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First
Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes
Touch only what you must. Clean up only your own mess.

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution
Define success criteria. Loop until verified.

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## Bug Investigation

For bugs, use subagents: write a reproducing test, then have subagents fix it and prove with a passing test.

## Plan Mode

**For each issue**: Describe concretely with file/line references. Present 2-3 options (including "do nothing"). For each: effort, risk, impact, maintenance burden. Recommended option first. Ask before proceeding.

**Exploration budget**: Max 15 tool calls for discovery. After that, produce a plan, begin edits, or tell me what's blocking. Don't re-read files or spawn exploration sub-agents.

**Before starting**: Ask if I want BIG CHANGE (4 issues per section, Architecture → Code Quality → Tests → Performance) or SMALL CHANGE (1 issue per section). Number issues, letter options.

## Landing the Plane (Session Completion)

Work is NOT complete until `git push` succeeds. Mandatory:
1. File issues for remaining work
2. Run quality gates (tests, lint, build)
3. Push: `git pull --rebase && git push && git status`
4. Hand off context for next session

NEVER stop before pushing. NEVER say "ready to push when you are" — YOU must push.

## TODO

- [ ] Invite expiration uses UTC midnight instead of user's local timezone end-of-day — an invite set to expire "March 27" actually expires at 7pm ET on March 26. Fix: append `T23:59:59` in the user's local timezone before converting to ISO string.
