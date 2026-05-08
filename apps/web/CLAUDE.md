# CLAUDE.md — apps/web

Guidance for the Next.js web application (`@teammeet/web`). For monorepo-wide guidance see the root `CLAUDE.md`.

## Commands

Run from `apps/web/` (or via `turbo run <task> --filter=@teammeet/web` from the repo root).

### Development
```bash
bun run dev          # Start Next.js dev server at localhost:3000
bun run build        # Build production application
bun run start        # Start production server
bun run lint         # Run ESLint
bun run typecheck    # tsc --noEmit
bun run gen:types    # Regenerate Supabase TypeScript types (writes to src/types/database.ts)
```

From the repo root: `bun dev` (web), `bun run build:web`, `bun run lint`, `bun run typecheck`.

### Testing
```bash
bun run test            # Orphan check + fast suites
bun run test:unit       # Focused unit/integration suites
bun run test:security   # Security-specific tests
bun run test:payments   # Payment idempotency + Stripe webhooks
bun run test:routes     # Route simulation suites
bun run test:schedules  # Schedule domain verification + enrollment
bun run test:e2e        # Playwright end-to-end tests
```

Single test file: `node --import ./tests/register-ts-loader.mjs --test tests/your-test.test.ts`.

### Stripe Webhook Testing (Local)
```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
stripe listen --forward-connect-to localhost:3000/api/stripe/webhook-connect
```

## Architecture

### Tech Stack
- **Framework**: Next.js 15 with App Router (TypeScript, React 18)
- **Database**: Supabase (PostgreSQL with RLS policies)
- **Authentication**: Supabase Auth with SSR
- **Payments**: Stripe (subscriptions + Stripe Connect for donations)
- **Email**: Resend
- **Styling**: Tailwind CSS

### Multi-Tenant SaaS Architecture
Organizations are first-class entities identified by slugs (e.g., `/[orgSlug]/members`). Middleware validates organization access on every request.

### Project Structure
Paths below are relative to `apps/web/`.
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

supabase/                   # Symlink → repo-root supabase/ (migrations, config, seeds)
tests/                      # Test files (unit, routes/, e2e/, fixtures/)
```

Shared monorepo packages consumed via workspace deps: `@teammeet/core`, `@teammeet/types`, `@teammeet/validation`. AI agent docs live at repo-root `docs/agent/`.

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
Funds route directly to org's connected Stripe account, never touching the app. See `docs/stripe-donations.md` (repo root).

### Schedule Domain Allowlist & Security
External schedule URLs validated before import to prevent SSRF. Domain statuses: `denied` → `pending` → `active` / `blocked`. Files: `src/lib/schedule-security/allowlist.ts`, `safe-fetch.ts`, `verifyAndEnroll.ts`.

### AI Agent
Architecture, pipeline, and feature docs live in repo-root `docs/agent/`. When modifying AI agent code (`src/lib/ai/`, `src/app/api/ai/`, `src/app/[orgSlug]/chat/`), update the relevant doc in `docs/agent/` to reflect structural changes, new features, or revised taxonomy.

### Schema Validation
Centralized Zod schemas in `src/lib/schemas/` — see `index.ts` for all available domains. Usage: `import { schemaName } from "@/lib/schemas"`. Cross-app schemas live in `@teammeet/validation`.

## Environment Variables

Required variables validated at build time in `next.config.mjs` — see that file for the complete list. Key optional vars:
- `RESEND_API_KEY` — Real email delivery (falls back to stub logging)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY` — Google Calendar
- `BRIGHT_DATA_API_KEY` — LinkedIn enrichment via Bright Data (~$1.50/1k lookups)
- `SKIP_STRIPE_VALIDATION=true` — Skip Stripe price ID validation in dev

Stored in `.env.local` at repo root (never commit). Vars surfaced to Turbo via `globalPassThroughEnv` in `turbo.json`.

## Key Files

- `src/middleware.ts` — Request interception, auth, org validation
- `src/app/[orgSlug]/layout.tsx` — Organization context provider
- `src/lib/auth/roles.ts` — `getOrgContext()`, `isOrgAdmin()`
- `src/lib/security/validation.ts` — Zod schemas, `sanitizeIlikeInput()`
- `src/lib/payments/idempotency.ts` — Payment deduplication
- `src/lib/schemas/index.ts` — Centralized validation schemas
- `../../docs/db/schema-audit.md` — Database schema docs and known issues
