# Architecture

## Tech Stack

- **Framework**: Next.js 14 App Router (TypeScript, React 18)
- **Database**: Supabase (PostgreSQL + Row Level Security)
- **Auth**: Supabase Auth with SSR
- **Payments**: Stripe subscriptions + Stripe Connect for donations
- **Email**: Resend
- **Hosting**: Vercel (cron via `vercel.json`)
- **Styling**: Tailwind CSS

## Project Structure

```
src/
├── app/
│   ├── [orgSlug]/          # Org-scoped routes (auth-gated per org)
│   ├── app/                # Platform routes (/app/join, /app/create-org)
│   ├── auth/               # Auth flows (login, signup, callback)
│   ├── api/                # API routes
│   ├── customization/      # Org customization
│   ├── enterprise/         # Enterprise UI routes
│   └── settings/           # User settings
├── components/
│   ├── ui/                 # Base primitives (Button, Card, Input)
│   ├── layout/             # OrgSidebar, MobileNav
│   ├── feedback/           # Feedback capture
│   └── skeletons/          # Route-level loading skeletons
├── lib/
│   ├── auth/               # Role utilities, enterprise context
│   ├── supabase/           # Client wrappers (see below)
│   ├── payments/           # Idempotency, Stripe events
│   ├── security/           # Rate limiting, validation, cron auth
│   ├── navigation/         # Nav items + role filtering
│   ├── schedule-connectors/ # ICS/HTML event importers
│   ├── schedule-security/  # Domain allowlist, SSRF protection
│   ├── enterprise/         # Quota, pricing, adoption logic
│   └── schemas/            # Zod validation schemas by domain
├── types/
│   └── database.ts         # Generated Supabase types (npm run gen:types)
└── middleware.ts            # Global request interception

supabase/migrations/        # All DB migrations
tests/                      # Unit + integration + E2E tests
docs/                       # Docs and agent context files
```

## Supabase Client Wrappers

Always use the right client for the context:

| File | Context |
|---|---|
| `lib/supabase/server.ts` | Server Components (uses cookies) |
| `lib/supabase/client.ts` | Client Components (browser) |
| `lib/supabase/middleware.ts` | Middleware (edge runtime) |
| `lib/supabase/service.ts` | Admin operations (service role key) |

## Middleware Request Flow

Every request passes through `src/middleware.ts`:

1. Parse auth cookies, validate JWT
2. Refresh session if needed
3. Check public vs. protected route
4. For `[orgSlug]` routes: validate org membership
5. Redirect revoked users to `/app` with error message
6. Enforce canonical domain (`myteamnetwork.com` to `www.myteamnetwork.com`)

**Public routes**: `/`, `/auth/*`, `/terms`. Stripe webhooks bypass middleware entirely.

## Role-Based Access Control

Three normalized roles:

| Role | Access |
|---|---|
| `admin` | Full access: settings, invites, navigation config |
| `active_member` | Most features: events, workouts, announcements |
| `alumni` | Read-only access to most content |

Role normalization at ingress: `member` becomes `active_member`, `viewer` becomes `alumni`.

Key utilities:
- `src/lib/auth/roles.ts` — `getOrgContext()`, `isOrgAdmin()`
- `src/lib/auth/enterprise-api-context.ts` — `getEnterpriseApiContext()` with role presets

## Cron Jobs

All configured in `vercel.json`. Auth via `Authorization: Bearer <CRON_SECRET>`.
Handler: `validateCronAuth()` from `src/lib/security/cron-auth.ts`.

| Endpoint | Schedule | Purpose |
|---|---|---|
| `/api/cron/error-baselines` | Hourly | Rolling error baselines + spike detection reset |
| `/api/cron/graduation-check` | Daily 8 AM UTC | Member graduation, alumni transition |
| `/api/cron/analytics-purge` | Daily 3 AM UTC | Purge expired analytics/ops events |
| `/api/cron/analytics-rate-limit-cleanup` | Daily 3 AM UTC | Delete stale rate limit records |
| `/api/cron/calendar-sync` | Hourly | Sync calendar feeds not updated in 60 min |
| `/api/cron/schedules-sync` | Daily midnight UTC | Sync schedule sources (max 3 concurrent) |
| `/api/cron/media-cleanup` | Daily 4 AM UTC | Orphaned media cleanup |
| `/api/cron/error-alerts` | Hourly | Email error alerts to `ALERT_EMAIL_TO` |

## Environment Variables

Required (validated at build time in `next.config.mjs`):

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
STRIPE_SECRET_KEY
STRIPE_BASE_PLAN_MONTHLY_PRICE_ID  (+ 7 tier/billing variants)
STRIPE_WEBHOOK_SECRET
RESEND_API_KEY
FROM_EMAIL          (default: noreply@myteamnetwork.com)
ADMIN_EMAIL         (default: admin@myteamnetwork.com)
CRON_SECRET
```

Optional:

```
STRIPE_WEBHOOK_SECRET_CONNECT
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_TOKEN_ENCRYPTION_KEY
ALERT_EMAIL_TO                  (comma-separated error alert recipients)
SKIP_STRIPE_VALIDATION=true     (skip Stripe price ID check in dev)
```
