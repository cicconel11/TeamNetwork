# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

This is an npm workspaces monorepo:

```
TeamMeet/
├── apps/
│   ├── web/                    # Next.js 14 web application
│   │   ├── src/
│   │   ├── public/
│   │   ├── tests/
│   │   └── package.json
│   └── mobile/                 # Expo React Native application
│       ├── app/                # Expo Router screens
│       ├── src/                # Mobile-specific code
│       └── package.json
├── packages/
│   ├── core/                   # Shared business logic (@teammeet/core)
│   ├── types/                  # TypeScript types (@teammeet/types)
│   └── validation/             # Zod schemas (@teammeet/validation)
├── supabase/                   # Database migrations
├── docs/                       # Documentation
└── package.json                # Root workspace config
```

## Commands

### Development
```bash
npm run dev          # Start Next.js dev server at localhost:3000
npm run dev:web      # Same as above
npm run dev:mobile   # Start Expo dev server
npm run build        # Build production application
npm run start        # Start production server
npm run lint         # Run ESLint
```

### Mobile Development
```bash
cd apps/mobile
npx expo start        # Start Expo dev server
npx expo run:ios      # Build and run on iOS simulator
npx expo run:android  # Build and run on Android emulator
```

### Testing
```bash
npm run test:auth      # Test authentication middleware
npm run test:payments  # Test payment idempotency and Stripe webhooks
```

### Audit System
```bash
npm run audit:install  # Install Playwright browsers (first time only)
npm run audit:ui       # Crawl UI and validate pages
npm run audit:static   # Analyze codebase for routes
npm run audit:backend  # Audit database schema
npm run audit:all      # Run all audits
```

### Stripe Webhook Testing (Local)
```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
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
This is a multi-tenant application where organizations are first-class entities identified by slugs (e.g., `/[orgSlug]/members`). The middleware validates organization access on every request.

### Project Structure
```
src/
├── app/                    # Next.js App Router
│   ├── [orgSlug]/          # Dynamic org-scoped routes
│   ├── app/                # Platform routes (/app/join, /app/create-org)
│   ├── auth/               # Auth flows (login, signup, callback)
│   ├── api/                # API routes (Stripe webhooks, org APIs)
│   └── settings/           # User settings
├── components/             # Reusable UI components
│   ├── ui/                 # Base UI primitives (Button, Card, Input)
│   ├── layout/             # Layout components (OrgSidebar, MobileNav)
│   └── [feature]/          # Feature-specific components
├── lib/                    # Business logic and utilities
│   ├── auth/               # Role-based auth utilities
│   ├── supabase/           # Supabase client wrappers (server, client, middleware, service)
│   ├── payments/           # Payment idempotency & event handling
│   ├── security/           # Rate limiting, validation
│   └── navigation/         # Navigation configuration
├── types/
│   └── database.ts         # Generated Supabase types
└── middleware.ts           # Global auth/routing middleware

supabase/migrations/        # Database migrations
tests/                      # Test files
docs/                       # Product and database documentation
```

### Supabase Client Wrappers
Use the appropriate wrapper for different contexts:
- `lib/supabase/server.ts` - Server Components (uses cookies)
- `lib/supabase/client.ts` - Client Components (browser)
- `lib/supabase/middleware.ts` - Middleware (edge runtime)
- `lib/supabase/service.ts` - Admin operations (service role key)

### Role-Based Access Control
Three main roles control access throughout the app:
- **admin**: Full access, can manage settings/invites/navigation
- **active_member**: Access to most features (events, workouts, etc.)
- **alumni**: Read-only access to most content, limited features

Role normalization happens in the system: `member` → `active_member`, `viewer` → `alumni`

### Middleware Request Flow
Every request flows through `src/middleware.ts`:
1. Parse auth cookies and validate JWT
2. Refresh session if needed
3. Check if route is public vs. protected
4. Validate org membership for `[orgSlug]` routes
5. Redirect revoked users to `/app` with error
6. Enforce canonical domain (myteamnetwork.com → www.myteamnetwork.com)

Public routes: `/`, `/auth/*`, `/terms`. Stripe webhooks bypass middleware.

## Key Architectural Patterns

### Payment Idempotency System
Robust payment handling to prevent double charges:
- Client generates stable `idempotency_key` (stored in localStorage)
- Server creates `payment_attempts` row with unique constraint on key
- Duplicate requests return existing attempt/checkout URL
- Webhooks deduplicated via `stripe_events(event_id unique)` table
- Payment attempt states: `initiated`, `processing`, `succeeded`, `failed`

Files: `src/lib/payments/idempotency.ts`, `src/lib/payments/stripe-events.ts`

### Organization Subscription Tiers
Alumni quota tiers determine pricing and add-on costs:
- 0-250 alumni (+$10/mo or $100/yr)
- 251-500 alumni (+$20/mo or $200/yr)
- 501-1000 alumni (+$35/mo or $350/yr)
- 1001-2500 alumni (+$60/mo or $600/yr)
- 2500-5000 alumni (+$100/mo or $1000/yr)
- 5000+ (requires custom setup - sales-led)

File: `packages/core/src/pricing/index.ts`

### Soft Delete Pattern
Most tables use `deleted_at` timestamp instead of hard deletes. Always filter: `.is("deleted_at", null)` when querying.

### Role-Based Navigation
Navigation is customizable per organization:
- Each nav item in `src/lib/navigation/nav-items.tsx` declares allowed roles
- Organizations can customize labels/visibility via `nav_config` JSONB column
- Sidebar dynamically filters based on user role

### Announcement Audience Targeting
Announcements support flexible audience specification:
- `all` - Everyone in the organization
- `members` - Active members only
- `active_members` - Alias for members
- `alumni` - Alumni only
- `individuals` - Specific user IDs (array)

Server-side filtering in `src/lib/announcements.ts` enforces access control.

### Stripe Connect Donations
Donations use Stripe Connect so funds never touch the app:
- Org configures Stripe Connect → gets `stripe_connect_account_id`
- Payment routes directly to org's connected account
- Webhook updates `organization_donations` + rolls up to `organization_donation_stats`

File: `docs/stripe-donations.md`

### Membership Lifecycle
Members progress through states:
- **pending**: Awaiting admin approval
- **active**: Full access granted
- **revoked**: Access removed, user redirected to `/app`

## Environment Variables

Required variables (validated at build time in `next.config.mjs`):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_BASE_PLAN_MONTHLY_PRICE_ID` (+ 7 more tier/billing variants)
- `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`

Stored in `.env.local` (never commit this file).

Use `SKIP_STRIPE_VALIDATION=true` in dev to skip Stripe price ID validation.

### Mobile Environment Variables (apps/mobile/.env.local)
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

## Shared Packages

Import shared code using package names:

```typescript
// In apps/web or apps/mobile
import { normalizeRole, roleFlags } from "@teammeet/core";
import type { Organization, UserRole } from "@teammeet/types";
import { baseSchemas, validateOrgName, z } from "@teammeet/validation";
```

### @teammeet/core
Shared business logic:
- `normalizeRole()`, `roleFlags()` - Role normalization and checks
- `filterAnnouncementsForUser()` - Announcement audience filtering
- Pricing constants: `BASE_PRICES`, `ALUMNI_ADD_ON_PRICES`, `ALUMNI_LIMITS`

### @teammeet/types
Supabase-generated TypeScript types:
- `Database`, `Tables<T>`, `Enums<T>` - Database type helpers
- `Organization`, `UserRole`, `AlumniBucket`, etc.

### @teammeet/validation
Zod schemas for validation:
- `baseSchemas` - Common validators (uuid, slug, email)
- `safeString()`, `uuidArray()` - Schema builders

## Mobile App Architecture

- **Framework**: Expo SDK 54 with Expo Router
- **Auth**: Supabase with AsyncStorage (not cookies)
- **Styling**: React Native StyleSheet (not Tailwind)
- **Navigation**: File-based routing via Expo Router

### Mobile Supabase Client

Mobile uses a different Supabase client configuration:

```typescript
// apps/mobile/src/lib/supabase.ts
import AsyncStorage from "@react-native-async-storage/async-storage";

export const supabase = createClient(url, key, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
```

## Coding Conventions

From `AGENTS.md`:
- TypeScript with strict mode
- 2-space indentation, semicolons, double quotes
- PascalCase for components, camelCase for functions/variables
- `useX` naming for custom hooks
- Commit prefixes: `feat:`, `fix:`, `chore:`
- Test files: `*.test.ts` using Node's built-in test runner

## Key Files to Understand

- `src/middleware.ts` - Request interception, auth, org validation
- `src/app/[orgSlug]/layout.tsx` - Organization context provider
- `src/lib/auth/roles.ts` - Role checking utilities
- `src/lib/payments/idempotency.ts` - Payment deduplication logic
- `src/lib/navigation/nav-items.tsx` - Navigation structure and role filtering
- `docs/db/schema-audit.md` - Database schema documentation and known issues

## Known Issues & Considerations

From `docs/db/schema-audit.md`:
- Announcement notifications are stubs (needs Resend API integration)
- Consider moving invite code generation to server-side RPC for security
- RLS policies use helper functions: `is_org_admin()`, `is_org_member()`, `has_active_role()`
