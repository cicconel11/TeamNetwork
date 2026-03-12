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

### Audit System
```bash
npx playwright test --project=audit-crawler  # Only if a tests/audit suite exists
node scripts/audit/static-routes.js          # Analyze codebase for routes
node scripts/audit/backend-audit.js          # Audit database schema
node scripts/audit/report.js                 # Compile generated audit reports
```

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

### Prompt for Plan Mode

Review this plan thoroughly before making any code changes. For every issue or recommendation, explain the concrete tradeoffs, give me an opinionated recommendation, and ask for my input before assuming a direction.

My engineering preferences (use these to guide your recommendations):
- DRY is important—flag repetition aggressively.
- Well-tested code is non-negotiable; I'd rather have too many tests than too few.
- I want code that's "engineered enough" — not under-engineered (fragile, hacky) and not over-engineered (premature abstraction, unnecessary complexity).
- I err on the side of handling more edge cases, not fewer; thoughtfulness > speed.
- Bias toward explicit over clever.

## 1. Architecture review
Evaluate:
- Overall system design and component boundaries.
- Dependency graph and coupling concerns.
- Data flow patterns and potential bottlenecks.
- Scaling characteristics and single points of failure.
- Security architecture (auth, data access, API boundaries).

## 2. Code quality review
Evaluate:
- Code organization and module structure.
- DRY violations—be aggressive here.
- Error handling patterns and missing edge cases (call these out explicitly).
- Technical debt hotspots.
- Areas that are over-engineered or under-engineered relative to my preferences.

## 3. Test review
Evaluate:
- Test coverage gaps (unit, integration, e2e).
- Test quality and assertion strength.
- Missing edge case coverage—be thorough.
- Untested failure modes and error paths.

## 4. Performance review
Evaluate:
- N+1 queries and database access patterns.
- Memory-usage concerns.
- Caching opportunities.
- Slow or high-complexity code paths.

**For each issue you find**

For every specific issue (bug, smell, design concern, or risk):
- Describe the problem concretely, with file and line references.
- Present 2–3 options, including "do nothing" where that's reasonable.
- For each option, specify: implementation effort, risk, impact on other code, and maintenance burden.
- Give me your recommended option and why, mapped to my preferences above.
- Then explicitly ask whether I agree or want to choose a different direction before proceeding.

**Workflow and interaction**
- Do not assume my priorities on timeline or scale.
- After each section, pause and ask for my feedback before moving on.

---

BEFORE YOU START:
Ask if I want one of two options:
1/ BIG CHANGE: Work through this interactively, one section at a time (Architecture → Code Quality → Tests → Performance) with at most 4 top issues in each section.
2/ SMALL CHANGE: Work through interactively ONE question per review section

FOR EACH STAGE OF REVIEW: output the explanation and pros and cons of each stage's questions AND your opinionated recommendation and why, and then use AskUserQuestion. Also NUMBER issues and then give LETTERS for options and when using AskUserQuestion make sure each option clearly labels the issue NUMBER and option LETTER so the user doesn't get confused. Make the recommended option always the 1st option.

### Multi-Tenant SaaS Architecture
This is a multi-tenant application where organizations are first-class entities identified by slugs (e.g., `/[orgSlug]/members`). The middleware validates organization access on every request.

### Project Structure
```
src/
├── app/                    # Next.js App Router
│   ├── [orgSlug]/          # Dynamic org-scoped routes
│   ├── app/                # Platform routes (/app/join, /app/create-org, /app/create-enterprise)
│   ├── auth/               # Auth flows (login, signup, callback)
│   ├── api/                # API routes (Stripe webhooks, org APIs)
│   ├── enterprise/         # Enterprise dashboard routes
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

Important org-scoped feature areas now include calendar, chat, discussions, feed, forms, jobs, media, parents, philanthropy, and enterprise-linked admin flows under `src/app/[orgSlug]/`.

### Supabase Client Wrappers
Use the appropriate wrapper for different contexts:
- `lib/supabase/server.ts` - Server Components (uses cookies)
- `lib/supabase/client.ts` - Client Components (browser)
- `lib/supabase/middleware.ts` - Middleware (edge runtime)
- `lib/supabase/service.ts` - Admin operations (service role key)

### Role-Based Access Control
Four main roles control access throughout the app:
- **admin**: Full access, can manage settings/invites/navigation
- **active_member**: Access to most features (events, workouts, etc.)
- **alumni**: Read-only access to most content, limited features
- **parent**: Access to selected org features for parents/guardians; requires org-level parents feature flag

Role normalization happens in the system: `member` → `active_member`, `viewer` → `alumni`

### Middleware Request Flow
Every request flows through `src/middleware.ts`:
1. Parse auth cookies and validate JWT
2. Refresh session if needed
3. Check if route is public vs. protected
4. Validate org membership for `[orgSlug]` routes
5. Redirect revoked users to `/app` with error
6. Enforce canonical domain (myteamnetwork.com → www.myteamnetwork.com)

Public routes now include `/`, `/demos`, `/terms`, `/privacy`, `/app/parents-join`, and `/auth/*`. Middleware also bypasses `/api/stripe/webhook`, `/api/stripe/webhook-connect`, `/api/auth/validate-age`, `/api/telemetry/error`, and the parent invite accept endpoint. Middleware handles auth refresh plus revoked/pending membership redirects; org existence and no-membership gating are finalized in `src/app/[orgSlug]/layout.tsx`.

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
- Each nav item in `src/lib/navigation/nav-items.tsx` declares allowed roles and a `group` property
- `group` is a `NavGroupId`: `people | community | schedule | activity | finance | admin`
- `src/lib/navigation/sidebar-groups.ts` handles grouping logic (`bucketItemsByGroup()`, `buildSectionOrder()`)
- `OrgSidebar` renders collapsible `NavGroupSection` components, one per group
- The nav `group` field controls sidebar collapsible grouping; it is separate from role visibility
- Organizations can customize labels/visibility via `nav_config` JSONB column
- Sidebar dynamically filters based on user role
- Current nav coverage is broader than the original core set and includes Feed, Parents, Calendar, Discussions, Jobs, Forms, Media Archive, Customization, Settings, and Navigation alongside the legacy feature areas

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

### Chat Groups (Polls & Inline Forms)
Group-based chat with moderation workflow and interactive message types:
- Groups: `chat_groups` table; membership in `chat_group_members` (soft-delete via `removed_at`)
- Messages: `chat_messages` with `message_type: "text" | "poll" | "form"` and JSONB `metadata`
- Polls: votes in `chat_poll_votes` (upsert); `allow_change` metadata flag controls re-voting
- Forms: responses in `chat_form_responses` (one per user, immutable)
- Auth helper: `getChatGroupContext()` in `src/lib/auth/chat-helpers.ts` — validates group existence, org membership, group membership, moderator status
- Realtime: `useChatRealtime` hook in `src/hooks/useChatRealtime.ts` subscribes to Supabase realtime channels
- Components: `PollComposer`, `PollMessage`, `FormComposer`, `InlineFormMessage` in `src/components/chat/`

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
- `src/app/auth/signup/SignupClient.tsx` - Signup error flow
- `src/components/auth/AgeGate.tsx` - Age-gate error flow

### Schema Validation System
Centralized Zod schemas in `src/lib/schemas/` for input validation:

**Available Domains:**
- `auth` - Login, signup, password reset forms
- `chat` - Chat message validation
- `chat-polls` - Chat polls, forms, votes/responses validation
- `common` - Shared utilities (`safeString`, `safeNumber`, etc.)
- `competition` - Competition and scoring schemas
- `content` - Events, announcements, workouts, records, expenses
- `calendar` - Calendar sync and feed validation
- `donations` - Donation form validation
- `feedback` - Feedback submission validation
- `form-builder` - Dynamic form schemas
- `feed` - Feed post/comment validation
- `media` - Media upload and moderation validation
- `member` - Member profile schemas
- `mentorship` - Mentorship pair and log validation
- `jobs` - Job posting validation
- `organization` - Organization settings schemas
- `schedule` - Schedule import schemas
- `discussion` - Discussion thread and reply validation
- `telemetry` - Client/server error payloads
- `errors` - Error tracking/admin schemas
- `analytics` - Analytics ingest and profile schemas
- `enterprise` - Enterprise validation schemas

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

Routes with loading states currently include alumni, announcements, calendar, chat, competition, discussions, donations, events, expenses, feed, forms, jobs, media, members, mentorship, notifications, parents, philanthropy, records, and workouts.

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
- `googleCalendar` - Connector for `google://` Google Calendar sources
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

### Cron Jobs
Automated background jobs scheduled via Vercel Cron (configured in `vercel.json`). All cron endpoints require authentication using the `CRON_SECRET` environment variable passed as `Authorization: Bearer <secret>` header.

**Authentication:**
- Cron routes use `validateCronAuth()` from `src/lib/security/cron-auth.ts`
- Returns 401 Unauthorized if secret doesn't match
- Returns 500 if CRON_SECRET not configured

**Active Cron Jobs:**
- `/api/cron/error-baselines` - Hourly (0 * * * *): Updates error group rolling baselines and resets hourly counts for spike detection
- `/api/cron/graduation-check` - Daily at 8 AM UTC (0 8 * * *): Processes member graduations, sends 30-day warnings, transitions members to alumni or revokes access based on capacity, auto-reinstates members with updated graduation dates
- `/api/cron/analytics-aggregate` - Weekly on Sunday at 2 AM UTC (0 2 * * 0): Legacy analytics aggregate job, still scheduled in `vercel.json`
- `/api/cron/analytics-purge` - Daily at 3 AM UTC (0 3 * * *): Purges expired analytics and ops events using `purge_analytics_events()` and `purge_ops_events()` RPC functions
- `/api/cron/analytics-rate-limit-cleanup` - Daily at 3 AM UTC (0 3 * * *): Deletes expired rate limit records older than 24 hours from `rate_limit_analytics` table
- `/api/cron/calendar-sync` - Hourly: Syncs active calendar feeds not updated in 60 minutes
- `/api/cron/schedules-sync` - Daily: Syncs active schedule sources that haven't been updated in 24 hours
- `/api/cron/media-cleanup` - Daily: Cleans up stale pending media uploads

**Inactive / unscheduled cron endpoints:**
- `/api/cron/error-alerts` - Sends email notifications for new error groups and error spikes to ALERT_EMAIL_TO (or ADMIN_EMAIL)

## Environment Variables

Required variables (validated at build time in `next.config.mjs`):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_BASE_MONTHLY`
- `STRIPE_PRICE_BASE_YEARLY`
- `STRIPE_PRICE_ALUMNI_0_250_MONTHLY`
- `STRIPE_PRICE_ALUMNI_0_250_YEARLY`
- `STRIPE_PRICE_ALUMNI_251_500_MONTHLY`
- `STRIPE_PRICE_ALUMNI_251_500_YEARLY`
- `STRIPE_PRICE_ALUMNI_501_1000_MONTHLY`
- `STRIPE_PRICE_ALUMNI_501_1000_YEARLY`
- `STRIPE_PRICE_ALUMNI_1001_2500_MONTHLY`
- `STRIPE_PRICE_ALUMNI_1001_2500_YEARLY`
- `STRIPE_PRICE_ALUMNI_2500_5000_MONTHLY`
- `STRIPE_PRICE_ALUMNI_2500_5000_YEARLY`
- `STRIPE_PRICE_ENTERPRISE_ALUMNI_BUCKET_MONTHLY`
- `STRIPE_PRICE_ENTERPRISE_ALUMNI_BUCKET_YEARLY`
- `STRIPE_PRICE_ENTERPRISE_SUB_ORG_MONTHLY`
- `STRIPE_PRICE_ENTERPRISE_SUB_ORG_YEARLY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_WEBHOOK_SECRET_CONNECT` - Required on Vercel production for donation webhooks; otherwise the build warns
- `CRON_SECRET` - Required on Vercel production for cron auth; otherwise the build warns

Optional variables:
- `RESEND_API_KEY` - Enables real email delivery; local/dev falls back to stub logging
- `FROM_EMAIL` - Sender email for notifications (default: noreply@myteamnetwork.com)
- `ADMIN_EMAIL` - Admin notification recipient (default: admin@myteamnetwork.com)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY` - Google Calendar integration
- `ALERT_EMAIL_TO` - Comma-separated list of emails for error alerts (defaults to ADMIN_EMAIL)
- `NEXT_PUBLIC_SITE_URL` - Canonical site URL used in auth and deployment checks

Stored in `.env.local` (never commit this file).

Use `SKIP_STRIPE_VALIDATION=true` in dev to skip Stripe price ID validation.

## Coding Conventions

- TypeScript with strict mode
- 2-space indentation, semicolons, double quotes
- PascalCase for components, camelCase for functions/variables
- `useX` naming for custom hooks
- Commit prefixes: `feat:`, `fix:`, `chore:`
- Test files: `*.test.ts` using Node's built-in test runner

## Test Strategy

Tests are located in the `tests/` directory with a coverage goal of 80%.

**Available test commands:**
- `npm run test` - Run unit + security + payment + route suites
- `npm run test:unit` - Focused unit and integration suites
- `npm run test:security` - Security-specific suites
- `npm run test:payments` - Payment idempotency and Stripe webhook tests
- `npm run test:schedules` - Schedule domain verification and enrollment tests
- `npm run test:routes` - API route simulation suites
- `npm run test:jobs` - Job route tests
- `npm run test:media` - Media tests
- `npm run test:qrcode` - QR code tests
- `npm run test:e2e`, `npm run test:e2e:ui`, `npm run test:e2e:debug` - Playwright suites

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
- `src/lib/auth/roles.ts` - Role checking utilities (`getOrgContext()`, `isOrgAdmin()`)
- `src/lib/auth/enterprise-api-context.ts` - Enterprise API auth helper (`getEnterpriseApiContext()`, role presets)
- `src/lib/auth/chat-helpers.ts` - Chat group access validation (`getChatGroupContext()`, discriminated union `ChatGroupContext`)
- `src/lib/enterprise/quota.ts` - Enterprise seat/alumni quota enforcement (fail-closed pattern)
- `src/lib/enterprise/adoption.ts` - Adoption request lifecycle with structured error status
- `src/lib/security/validation.ts` - Zod schemas, `sanitizeIlikeInput()` for safe ilike queries
- `src/lib/payments/idempotency.ts` - Payment deduplication logic
- `src/lib/navigation/nav-items.tsx` - Navigation structure and role filtering
- `src/lib/navigation/sidebar-groups.ts` - Grouped sidebar layout helpers (`bucketItemsByGroup()`, `buildSectionOrder()`)
- `src/lib/schedule-security/verifyAndEnroll.ts` - Domain verification and allowlist enrollment
- `src/lib/schedule-security/safe-fetch.ts` - SSRF-protected HTTP fetching
- `src/lib/schedule-connectors/sanitize.ts` - Event title sanitization and hash stability helpers
- `src/lib/schemas/index.ts` - Centralized Zod validation schemas
- `docs/db/schema-audit.md` - Database schema documentation and known issues

## Known Issues & Considerations

From `docs/db/schema-audit.md`:
- Announcement emails use Resend when configured; SMS delivery remains a stub
- Consider moving invite code generation to server-side RPC for security
- RLS policies use helper functions: `is_org_admin()`, `is_org_member()`, `has_active_role()`

### Enterprise Accounts System
Enterprise accounts allow managing multiple organizations under a single billing entity.

**Database Tables:**
- `enterprises` - Core enterprise data (id, name, slug, logo, billing_contact_email)
- `enterprise_subscriptions` - Billing & subscription (status, pricing_model, sub_org_quantity, alumni_tier)
- `user_enterprise_roles` - User roles (owner, billing_admin, org_admin)
- `enterprise_adoption_requests` - Pending requests for enterprises to adopt existing orgs
- `enterprise_alumni_counts` (view) - Source of truth for org/alumni counts per enterprise

**Pricing Models (Hybrid):**
- `per_sub_org` - Current model: 3 free sub-orgs, paid at $150/yr each beyond free tier
- Alumni capacity: 2,500 per bucket, self-serve up to 4 buckets (10,000), 5+ is sales-led
- `alumni_tier` - Legacy tier-based pricing (tier_1: 5000, tier_2: 10000, tier_3/sentinel 999: unlimited)

**RLS Helper Functions:**
- `is_enterprise_member(ent_id)` - Check if current user has any role in enterprise
- `is_enterprise_admin(ent_id)` - Check if user is owner/billing_admin/org_admin

**Key Library Modules:**
- `src/lib/auth/enterprise-context.ts` - Enterprise context & `getUserEnterprises()`
- `src/lib/auth/enterprise-api-context.ts` - `getEnterpriseApiContext()` consolidated auth helper with role presets (`ENTERPRISE_ANY_ROLE`, `ENTERPRISE_BILLING_ROLE`, `ENTERPRISE_CREATE_ORG_ROLE`, `ENTERPRISE_OWNER_ROLE`)
- `src/lib/auth/enterprise-ownership-check.ts` - Block account deletion if user owns enterprise
- `src/lib/enterprise/quota.ts` - DB layer for `canEnterpriseAddSubOrg()`, `checkAdoptionQuota()`
- `src/lib/enterprise/quota-logic.ts` - Pure computation: `evaluateSubOrgCapacity()`, `evaluateAdoptionQuota()`, `SeatQuotaInfo` interface
- `src/lib/enterprise/pricing.ts` - `getSubOrgPricing()`, `getAlumniBucketPricing()`, `isSalesLed()`
- `src/lib/enterprise/adoption.ts` - `createAdoptionRequest()`, `acceptAdoptionRequest()`, `rejectAdoptionRequest()`
- `src/lib/enterprise/resolve-enterprise.ts` - Resolves slug-or-UUID enterprise params

**API Routes (`src/app/api/enterprise/[enterpriseId]/`):**
- `route.ts` - GET/PATCH enterprise details
- `admins/route.ts` - GET list admins, POST invite admin, DELETE remove admin
- `settings/route.ts` - GET enterprise settings with admin details
- `billing/route.ts` - GET billing info; `billing/adjust/route.ts` - POST adjust subscription; `billing/portal/route.ts` - POST Stripe portal
- `organizations/route.ts` - GET sub-orgs; `organizations/create/route.ts` - POST create sub-org; `organizations/create-with-upgrade/route.ts` - POST create with seat upgrade
- `adopt/route.ts` - POST create adoption request; `adopt/preview/route.ts` - GET preview adoption (accepts `?slug=` query param)
- `adoption-requests/route.ts` - GET list; `adoption-requests/[requestId]/route.ts` - GET/DELETE specific request
- `alumni/route.ts` - GET alumni; `alumni/stats/route.ts` - GET alumni stats; `alumni/export/route.ts` - GET export
- `invites/route.ts` - GET/POST; `invites/bulk/route.ts` - POST bulk upload; `invites/[inviteId]/route.ts` - DELETE
- `navigation/route.ts` - GET/POST nav config; `navigation/sync/route.ts` - POST sync to sub-orgs
- `audit-logs/route.ts` - GET audit trail
- `by-slug/[slug]/route.ts` - GET resolve slug to UUID

**UI Routes (`src/app/enterprise/[enterpriseSlug]/`):**
- Server components with auth gates → client components for interactivity
- Pages: dashboard, alumni, billing, invites, navigation, organizations, settings
- Layout: `layout.tsx` provides sidebar + responsive header with enterprise context

**Enterprise Error Handling Patterns:**

1. **Fail-closed quota checks:** `SeatQuotaInfo` has `error?: string`. When DB errors occur, `canEnterpriseAddSubOrg()` returns `{ currentCount: 0, maxAllowed: null, error: "internal_error" }`. Callers check only `seatQuota.error` (there is no hard cap — `allowed` was removed in the hybrid pricing model):
```typescript
if (seatQuota.error) return respond({ error: "Unable to verify seat limit..." }, 503);
```

2. **Structured error status on adoption:** `acceptAdoptionRequest()` returns `{ success: boolean; error?: string; status?: number }`. Routes use `result.status ?? 400` — no string matching.

3. **Case-insensitive email lookup:** Admin invite uses `(serviceSupabase as any).schema("auth").from("users").ilike("email", sanitizeIlikeInput(email))`. Always use `sanitizeIlikeInput()` from `src/lib/security/validation.ts` to escape `%`, `_`, `\` before `.ilike()`.

4. **Enterprise `as any` cast pattern:** Generated types now include enterprise tables, but some service-role and auth-schema queries still use casts for ergonomics or incomplete regeneration coverage.

5. **getUserById logging:** GET handlers that fetch user details via `Promise.all(userIds.map(id => getUserById(id)))` log failures before filtering: `userFetches.forEach((r, i) => { if (r.error) console.error(...) })`.

**Test Enterprise (Development):**
A test enterprise exists for development without Stripe payment:
- Slug: `test-enterprise`
- ID: `aaaaaaaa-0000-0000-0000-000000000001`
- Status: `active` with 10 sub-org seats
- Created via: `supabase/migrations/20260202200000_seed_test_enterprise.sql`

**Enterprise Tests:**
```bash
node --test --loader ./tests/ts-loader.js tests/enterprise/*.test.ts tests/routes/enterprise/*.test.ts
```
Coverage: quota logic, adoption flows, roles/permissions, billing adjustments, checkout, delete-account ownership, quantity pricing, admin invite lookup, create-with-upgrade quota.

### Enterprise Independent Billing (Incomplete)
The "Independent Billing" option for enterprise sub-organizations is partially implemented but **not functional**. Current state:
- Sub-orgs created with `billingType: "independent"` get `subscription.status: "pending"`
- **Missing**: No checkout flow exists for independent sub-orgs to complete billing setup
- **Missing**: Stripe webhook doesn't handle independent sub-org payments
- **Missing**: No mechanism to transition from `pending` → `active` status
- **Missing**: No UI prompt to "Complete Billing Setup" after creation

**Impact**: Users who select "Independent Billing" will get a non-functional organization.

**Workaround**: Always select "Enterprise Billing (Recommended)" when creating sub-orgs. UI option is marked "Coming Soon" in `CreateSubOrgForm.tsx`.


## File Placement Rules

- **Plan files**: NEVER create plan/design documents inside the repo (e.g., `docs/plans/`). Use `~/.claude/plans/` instead.
- **Server actions**: Place in existing `src/lib/` modules (e.g., `src/lib/cache.ts`). Do NOT create a `src/lib/actions/` directory.

## Bug Issues and Investigation

When I report a bug, don't start by trying to fix it. Instead, start by writing a test that reproduces the bug. Then, have subagents try to fix the bug and prove it with a passing test.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
