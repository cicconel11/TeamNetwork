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

- **Plan files**: NEVER create plan/design documents inside the repo. Use `~/.claude/plans/` instead.
- **Server actions**: Place in existing `src/lib/` modules. Do NOT create `src/lib/actions/`.

## Bug Investigation

When I report a bug, don't start by trying to fix it. Start by writing a test that reproduces the bug. Then, have subagents try to fix the bug and prove it with a passing test.

## Plan Mode

Review plans thoroughly before making code changes. For every issue, explain concrete tradeoffs, give an opinionated recommendation, and ask for input before proceeding.

My engineering preferences:
- DRY — flag repetition aggressively
- Well-tested code is non-negotiable
- "Engineered enough" — not under-engineered, not over-engineered
- Handle more edge cases, not fewer; thoughtfulness > speed
- Bias toward explicit over clever

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
