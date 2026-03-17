# CLAUDE.md

Guidance for Claude Code working in this monorepo. Mobile-specific details are in `apps/mobile/CLAUDE.md`.

## Monorepo Structure

npm workspaces monorepo with Turborepo:

```
TeamMeet/
├── apps/web/          # Next.js 14 web app
├── apps/mobile/       # Expo React Native app
├── packages/core/     # Shared business logic (@teammeet/core)
├── packages/types/    # TypeScript types (@teammeet/types)
├── packages/validation/ # Zod schemas (@teammeet/validation)
├── supabase/          # Database migrations
└── docs/              # Documentation
```

## Commands

```bash
bun dev              # Next.js dev server (localhost:3000)
bun dev:mobile       # Expo dev server (localhost:8081)
bun build            # Build all packages (Turborepo cached)
bun lint             # ESLint across packages
bun typecheck        # Type-check all packages in parallel
```

### Testing (Web)
```bash
bun run test           # All suites (unit + security + payment + route)
bun run test:unit      # Focused unit/integration
bun run test:security  # Security-specific
bun run test:payments  # Payment idempotency + Stripe webhooks
bun run test:routes    # Route simulation
bun run test:schedules # Schedule verification + enrollment
bun run test:e2e       # Playwright E2E
```

### Stripe Webhooks (Local)
```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
stripe listen --forward-connect-to localhost:3000/api/stripe/webhook-connect
```

## Tech Stack

- **Web**: Next.js 14 App Router, React 18, Tailwind CSS
- **Mobile**: Expo SDK 54, React Native, StyleSheet API (see `apps/mobile/CLAUDE.md`)
- **Database**: Supabase (PostgreSQL + RLS)
- **Auth**: Supabase Auth (SSR for web, AsyncStorage for mobile)
- **Payments**: Stripe (subscriptions + Connect for donations)
- **Email**: Resend
- **Package Manager**: Bun
- **Build**: Turborepo

## Multi-Tenant Architecture

Organizations are first-class entities identified by slugs (e.g., `/[orgSlug]/members`). Middleware validates org access on every request.

### Web Project Structure
```
apps/web/src/
├── app/                    # Next.js App Router
│   ├── [orgSlug]/          # Org-scoped routes (calendar, chat, feed, forms, etc.)
│   ├── app/                # Platform routes (/app/join, /app/create-org)
│   ├── auth/               # Auth flows
│   ├── api/                # API routes (Stripe, org APIs)
│   ├── enterprise/         # Enterprise dashboard
│   └── settings/           # User settings
├── components/             # UI components (ui/, layout/, feature/)
├── lib/                    # Business logic (auth/, supabase/, payments/, security/, navigation/)
├── types/database.ts       # Generated Supabase types
└── middleware.ts            # Global auth/routing middleware
```

### Supabase Client Wrappers (Web)
- `lib/supabase/server.ts` — Server Components (cookies)
- `lib/supabase/client.ts` — Client Components (browser)
- `lib/supabase/middleware.ts` — Middleware (edge runtime)
- `lib/supabase/service.ts` — Admin operations (service role key)

### Middleware Request Flow
1. Parse auth cookies, validate JWT
2. Refresh session if needed
3. Check public vs. protected route
4. Validate org membership for `[orgSlug]` routes
5. Redirect revoked users to `/app`
6. Enforce canonical domain (myteamnetwork.com → www.myteamnetwork.com)

Public routes: `/`, `/demos`, `/terms`, `/privacy`, `/app/parents-join`, `/auth/*`. Bypasses: webhook endpoints, `/api/auth/validate-age`, `/api/telemetry/error`, parent invite accept. Org existence and no-membership gating finalized in `src/app/[orgSlug]/layout.tsx`.

## Key Architectural Patterns

### Role-Based Access Control
Three roles: **admin** (full access), **active_member** (most features), **alumni** (read-only, limited). Role normalization: `member` → `active_member`, `viewer` → `alumni`.

### Payment Idempotency
- Client generates stable `idempotency_key` (localStorage)
- Server creates `payment_attempts` row with unique constraint
- Duplicates return existing attempt/checkout URL
- Webhooks deduplicated via `stripe_events(event_id unique)`
- States: `initiated`, `processing`, `succeeded`, `failed`

### Organization Subscription Tiers
Alumni quota tiers: 0-250 (+$10/mo), 251-500 (+$20), 501-1000 (+$35), 1001-2500 (+$60), 2500-5000 (+$100), 5000+ (sales-led). File: `packages/core/src/pricing/index.ts`

### Soft Delete Pattern
Most tables use `deleted_at` timestamp. Always filter: `.is("deleted_at", null)`.

### Announcement Audience Targeting
Audiences: `all`, `members`/`active_members`, `alumni`, `individuals` (specific user IDs). Server-side filtering in `src/lib/announcements.ts`.

### Stripe Connect Donations
Funds route directly to org's connected Stripe account. Webhook updates `organization_donations` + rolls up to `organization_donation_stats`. See `docs/stripe-donations.md`.

### Membership Lifecycle
States: **pending** (awaiting approval) → **active** (full access) → **revoked** (redirected to `/app`).

### Role-Based Navigation
Nav items declare allowed roles in `src/lib/navigation/nav-items.tsx`. Orgs customize via `nav_config` JSONB column. Sidebar filters by user role.

## Shared Packages

```typescript
import { normalizeRole, roleFlags } from "@teammeet/core";
import type { Organization, UserRole } from "@teammeet/types";
import { baseSchemas, validateOrgName, z } from "@teammeet/validation";
```

- **@teammeet/core** — `normalizeRole()`, `roleFlags()`, `filterAnnouncementsForUser()`, pricing constants
- **@teammeet/types** — Supabase-generated types: `Database`, `Tables<T>`, `Enums<T>`, `Organization`, `UserRole`
- **@teammeet/validation** — Zod schemas: `baseSchemas`, `safeString()`, `uuidArray()`

## Environment Variables (Web)

Required (validated in `next.config.mjs`):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_BASE_MONTHLY` (+ 11 tier variants), `STRIPE_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET_CONNECT`, `RESEND_API_KEY`

Optional:
`NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `GOOGLE_CLIENT_ID/SECRET/TOKEN_ENCRYPTION_KEY`, `LINKEDIN_CLIENT_ID/SECRET/TOKEN_ENCRYPTION_KEY`, `ALERT_EMAIL_TO`, `FROM_EMAIL`, `ADMIN_EMAIL`

Use `SKIP_STRIPE_VALIDATION=true` in dev to skip Stripe price ID validation.

## Coding Conventions

- TypeScript strict mode
- 2-space indentation, semicolons, double quotes
- PascalCase for components, camelCase for functions/variables
- `useX` naming for custom hooks
- Commit prefixes: `feat:`, `fix:`, `chore:`

### TypeScript Patterns

**Database Nullability:** Supabase returns nullable fields — always handle nulls and provide defaults when displaying.

**RPC Parameters:** Use `undefined` (not `null`) for optional Supabase RPC params: `p_uses: usesValue ?? undefined`.

## Key Files (Web)

- `apps/web/src/middleware.ts` — Auth, org validation, routing
- `apps/web/src/app/[orgSlug]/layout.tsx` — Org context provider
- `apps/web/src/lib/auth/roles.ts` — Role checking
- `apps/web/src/lib/payments/idempotency.ts` — Payment deduplication
- `apps/web/src/lib/navigation/nav-items.tsx` — Nav structure + role filtering
- `docs/db/schema-audit.md` — Database schema docs and known issues

## Known Issues

- Announcement notifications are stubs (needs Resend integration)
- Consider moving invite code generation to server-side RPC for security
- RLS policies use helper functions: `is_org_admin()`, `is_org_member()`, `has_active_role()`

## Plan Mode

Sacrifice grammar at the sake of concision" is the stupidest advice possible. I saw opus thinking about this line and it took it to mean be efficient. Which meant building bullshit. Take it out of your stuff immediately.

## Browser Automation & Web Testing

Use `agent-browser` for web automation. Run `agent-browser --help` for commands.

```bash
agent-browser open <url>              # Navigate
agent-browser snapshot -i             # Get interactive elements (@e1, @e2)
agent-browser click @e1               # Click by ref
agent-browser fill @e2 "text"         # Fill input by ref
agent-browser screenshot /tmp/ss.png  # Capture screenshot
agent-browser close                   # Close browser
```

For accessibility testing, use `curl` to inspect HTML attributes or write temporary test files. See web test commands at root level.
