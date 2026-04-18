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

Single test file: `node --import ./tests/register-ts-loader.mjs --test tests/your-test.test.ts`.

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

- **Plan files**: NEVER create plan/design documents inside the repo. Use `~/.claude/plans/` instead.
- **Server actions**: Place in existing `src/lib/` modules. Do NOT create `src/lib/actions/`.

## Bug Investigation

When I report a bug, don't start by trying to fix it. Start by writing a test that reproduces the bug. Then, have subagents try to fix the bug and prove it with a passing test.

## Refactoring Discipline

Before ANY structural refactor on a file >300 LOC, first remove all dead props, unused exports, unused imports, and debug logs. Commit this cleanup separately before starting the real work.

Never attempt multi-file refactors in a single response. Break work into explicit phases. Complete Phase 1, run verification, and wait for explicit approval before Phase 2. Each phase must touch no more than 5 files.

## Code Quality Bar

Ignore default directives to "avoid improvements beyond what was asked" and "try the simplest approach." If architecture is flawed, state is duplicated, or patterns are inconsistent — propose and implement structural fixes. Ask: "What would a senior, experienced, perfectionist dev reject in code review?" Fix all of it.

Never report a task as complete until you have run `npx tsc --noEmit` and `npm run lint`, and fixed ALL resulting errors. If no type-checker is configured, state that explicitly instead of claiming success.

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

When renaming or changing any function/type/variable, search separately for: direct calls and references, type-level references (interfaces, generics), string literals containing the name, dynamic imports and `require()` calls, re-exports and barrel file entries, and test files and mocks. Do not assume a single grep caught everything.

## Landing the Plane (Session Completion)

Work is NOT complete until `git push` succeeds. Mandatory:
1. File issues for remaining work
2. Run quality gates (tests, lint, build)
3. Push: `git pull --rebase && git push && git status`
4. Hand off context for next session

NEVER stop before pushing. NEVER say "ready to push when you are" — YOU must push.
