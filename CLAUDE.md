# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
```bash
npm run dev          # Start Next.js dev server at localhost:3000
npm run build        # Build production application
npm run start        # Start production server
npm run lint         # Run ESLint
```

### Testing
```bash
npm run test:auth       # Test authentication middleware
npm run test:payments   # Test payment idempotency and Stripe webhooks
npm run test:schedules  # Test schedule domain verification and enrollment
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
│   ├── customization/      # Org customization route (renamed from settings)
│   └── settings/           # User settings (notifications)
├── components/             # Reusable UI components
│   ├── ui/                 # Base UI primitives (Button, Card, Input)
│   ├── layout/             # Layout components (OrgSidebar, MobileNav)
│   ├── feedback/           # Feedback capture components
│   └── [feature]/          # Feature-specific components
├── lib/                    # Business logic and utilities
│   ├── auth/               # Role-based auth utilities
│   ├── supabase/           # Supabase client wrappers (server, client, middleware, service)
│   ├── payments/           # Payment idempotency & event handling
│   ├── security/           # Rate limiting, validation
│   ├── navigation/         # Navigation configuration
│   ├── schedule-connectors/ # External schedule importers (ICS, HTML parsers)
│   ├── schedule-security/  # Domain allowlist, SSRF protection
│   └── schemas/            # Zod validation schemas by domain
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
Alumni quota tiers determine pricing and storage limits:
- none: 0 alumni
- 0-250 alumni
- 251-500 alumni
- 501-1000 alumni
- 1001-2500 alumni
- 2500-5000 alumni
- 5000+ (unlimited)

File: `src/lib/alumni-quota.ts`

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

### Feedback Capture System
User feedback is collected through a friction feedback system:
- Users submit feedback via `FeedbackButton` component in `src/components/feedback/`
- Submissions processed through `POST /api/feedback/submit`
- Rate limits: 5/hour per user, 10/hour per IP
- Request schema: `{ message, screenshot_url?, page_url, user_agent, context, trigger }`
- Stored in `form_submissions` table with `FORM_ID = 00000000-0000-0000-0000-000000000001`
- Admin notification sent via Resend (email configured via `FROM_EMAIL`, `ADMIN_EMAIL` env vars)

**FeedbackButton Integration Points:**
- `src/app/app/create-org/page.tsx` - Organization creation flow
- `src/app/app/join/page.tsx` - Join organization flow
- `src/app/auth/login/LoginClient.tsx` - Login page

### Schema Validation System
Centralized Zod schemas in `src/lib/schemas/` for input validation:

**Available Domains:**
- `auth` - Login, signup, password reset forms
- `chat` - Chat message validation
- `common` - Shared utilities (`safeString`, `safeNumber`, etc.)
- `competition` - Competition and scoring schemas
- `content` - Events, announcements, workouts, records, expenses
- `donations` - Donation form validation
- `feedback` - Feedback submission validation
- `form-builder` - Dynamic form schemas
- `member` - Member profile schemas
- `organization` - Organization settings schemas
- `schedule` - Schedule import schemas

**Usage:**
```typescript
import { forgotPasswordSchema, type ForgotPasswordForm } from "@/lib/schemas";
const validated = forgotPasswordSchema.parse(input);
```

### Loading States
Route-level loading skeletons using Next.js `loading.tsx` convention:

**Page Skeletons (`src/components/skeletons/pages/`):**
- `ListPageSkeleton` - Generic list views
- `TablePageSkeleton` - Table-based pages
- `MembersPageSkeleton` - Members directory
- `EventsPageSkeleton` - Events listing
- `CompetitionPageSkeleton` - Competition leaderboard
- `MentorshipPageSkeleton` - Mentorship pairs

**Component Skeletons (`src/components/skeletons/`):**
- `SkeletonListItem`, `SkeletonTableRow` - Generic items
- `SkeletonMemberCard`, `SkeletonEventItem` - Feature-specific
- `SkeletonStatCard`, `SkeletonLeaderboardRow` - Dashboard components

Routes with loading states: alumni, announcements, chat, competition, donations, events, expenses, forms, members, mentorship, notifications, philanthropy, records, schedules, workouts

### Schedule Domain Allowlist & Security
External schedule URLs are validated before import to prevent SSRF and abuse:

**Domain Status Flow:**
- `denied` → Domain not recognized, cannot be imported
- `pending` → Needs admin approval (confidence 80-95%)
- `active` → Verified and allowed (confidence ≥95% or admin-approved)
- `blocked` → Explicitly blocked, cannot be imported

**Verification System:**
- Vendor fingerprinting via host patterns and HTML markers (Sidearm, Presto, Vantage, etc.)
- ICS/iCal content detection (auto-approved at 99% confidence)
- Race condition protection: prevents `active → pending` downgrades during concurrent requests
- Unique constraint handling for concurrent domain enrollment

**SSRF Protection (`safe-fetch.ts`):**
- Blocks localhost, private IPs (10.x, 172.16-31.x, 192.168.x, etc.)
- IPv6 private ranges blocked (fc00::/7, fe80::/10, ::1)
- Only HTTP/HTTPS on ports 80/443
- Max 2 redirects, response size limits (200KB)
- DNS resolution check to catch DNS rebinding

**Rate Limiting:**
- `/api/schedules/preview`: 15 req/min (IP), 8 req/min (user)
- `/api/schedules/events`: 30 req/min (IP), 20 req/min (user)
- IP-based limiting applied before auth to prevent unauthenticated abuse

Files: `src/lib/schedule-security/allowlist.ts`, `src/lib/schedule-security/verifyAndEnroll.ts`, `src/lib/schedule-security/safe-fetch.ts`

### Schedule Connectors
Modular system for importing events from external schedule sources:

**Connector Types:**
- `ics` - ICS/iCal feed parser (highest confidence)
- `vendorA` - Vantage/SectionXI athletics sites
- `vendorB` - Sidearm/CHSAA athletics sites
- `generic_html` - Fallback table-based HTML parser

**Event Processing Pipeline:**
1. Connector fetches HTML/ICS from allowlisted URL
2. Events extracted via JSON-LD, embedded JS data, or HTML tables
3. Titles sanitized (HTML stripped, entities decoded, XSS prevented)
4. Deterministic `external_uid` hash generated for deduplication
5. Events synced to database with upsert logic

**Hash Stability (`sanitize.ts`):**
- `rawTitle` (original text before sanitization) used for hashing to ensure stability
- `getTitleForHash(rawTitle, title)` helper trims whitespace and falls back to sanitized title
- Prevents hash changes when sanitization rules evolve
- Whitespace-only raw titles correctly fall back to sanitized title

**Title Sanitization:**
- `sanitizeEventTitle()` - Strips HTML, decodes safe entities (&amp; → &), preserves &lt;/&gt; for XSS safety
- `escapeHtml()` - Escapes for HTML output
- `sanitizeEventTitleForEmail()` - Combines both for email-safe output

Files: `src/lib/schedule-connectors/sanitize.ts`, `src/lib/schedule-connectors/html-utils.ts`, `src/lib/schedule-connectors/genericHtml.ts`, `src/lib/schedule-connectors/vendorA.ts`, `src/lib/schedule-connectors/vendorB.ts`, `src/lib/schedule-connectors/ics.ts`

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
- `FROM_EMAIL` - Sender email for notifications (default: noreply@myteamnetwork.com)
- `ADMIN_EMAIL` - Admin notification recipient (default: admin@myteamnetwork.com)

Stored in `.env.local` (never commit this file).

Use `SKIP_STRIPE_VALIDATION=true` in dev to skip Stripe price ID validation.

## Coding Conventions

From `AGENTS.md`:
- TypeScript with strict mode
- 2-space indentation, semicolons, double quotes
- PascalCase for components, camelCase for functions/variables
- `useX` naming for custom hooks
- Commit prefixes: `feat:`, `fix:`, `chore:`
- Test files: `*.test.ts` using Node's built-in test runner

## Test Strategy

Tests are located in the `tests/` directory with a coverage goal of 80%.

**Available test commands:**
- `npm run test:auth` - Authentication middleware tests
- `npm run test:payments` - Payment idempotency and Stripe webhook tests
- `npm run test:schedules` - Schedule domain verification and enrollment tests

**Test Structure:**
```
tests/
├── *.test.ts               # Unit tests (Node built-in runner)
├── routes/                 # API route integration tests
│   ├── admin/              # Admin endpoint tests
│   ├── calendar/           # Calendar/feed tests
│   ├── feedback/           # Feedback submission tests
│   ├── organizations/      # Org management tests
│   ├── schedules/          # Schedule import tests
│   └── stripe/             # Payment/webhook tests
├── e2e/                    # Playwright E2E tests
│   ├── auth.setup.ts       # Auth state setup
│   ├── fixtures/           # Test data fixtures
│   ├── page-objects/       # Page Object Model classes
│   └── specs/              # Test specifications
├── fixtures/               # Test fixtures (ICS files, etc.)
└── utils/                  # Test utilities (mocks, stubs)
```

**Running Tests:**
- Unit tests: `node --test tests/your-test.test.ts`
- E2E tests: `npx playwright test tests/e2e/specs/`
- With loader: Tests use `tests/ts-loader.js` for TypeScript support

## Key Files to Understand

- `src/middleware.ts` - Request interception, auth, org validation
- `src/app/[orgSlug]/layout.tsx` - Organization context provider
- `src/lib/auth/roles.ts` - Role checking utilities
- `src/lib/payments/idempotency.ts` - Payment deduplication logic
- `src/lib/navigation/nav-items.tsx` - Navigation structure and role filtering
- `src/lib/schedule-security/verifyAndEnroll.ts` - Domain verification and allowlist enrollment
- `src/lib/schedule-security/safe-fetch.ts` - SSRF-protected HTTP fetching
- `src/lib/schedule-connectors/sanitize.ts` - Event title sanitization and hash stability helpers
- `src/lib/schemas/index.ts` - Centralized Zod validation schemas
- `docs/db/schema-audit.md` - Database schema documentation and known issues

## Known Issues & Considerations

From `docs/db/schema-audit.md`:
- Announcement notifications are stubs (needs Resend API integration)
- Consider moving invite code generation to server-side RPC for security
- RLS policies use helper functions: `is_org_admin()`, `is_org_member()`, `has_active_role()`


## Bug Issues and Investigation

When I report a bug, don't start by trying to fix it. Instead, start by writing a test that reproduces the bug. Then, have subagents try to fix the bug and prove it with a passing test.