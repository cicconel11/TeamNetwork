# Web App — CLAUDE.md

> See the root [CLAUDE.md](../../CLAUDE.md) for monorepo structure, shared packages, env vars, coding conventions, payment idempotency, RBAC, middleware overview, and mobile-specific details.

## Commands

```bash
bun dev                # Next.js dev server at localhost:3000
bun build              # Production build
bun lint               # ESLint
bun run typecheck      # TypeScript strict check (tsc --noEmit)
bun run test           # All tests (unit + security + payments + mobile)
bun run test:unit      # middleware, cancel-subscription, grace-period
bun run test:auth      # Middleware auth tests
bun run test:payments  # Payment idempotency, webhook dedupe, platform fee
bun run test:security  # Webhook rate limiting
bun run test:mobile    # Mobile permissions, routing, menu parity
```

Run a single test file:

```bash
node --test --loader ./tests/ts-loader.js tests/<file>.test.ts
```

## Testing

- **Runner**: Node.js built-in test runner (`node:test`, `node:assert`)
- **TypeScript**: Custom `tests/ts-loader.js` transpiles via `ts.transpileModule`
- **Property-based testing**: `fast-check` (dev dependency)
- **Test files**: `tests/*.test.ts`

No Jest or Vitest — all tests use `import { describe, it } from "node:test"`.

## Tailwind Theming

Colors are CSS-variable-driven, not static values. Defined in `tailwind.config.ts`:

**Org brand colors** (injected per-org at runtime):
- `org-primary`, `org-primary-light`, `org-primary-dark`
- `org-secondary`, `org-secondary-light`, `org-secondary-dark`, `org-secondary-foreground`
- CSS vars: `--color-org-primary`, `--color-org-secondary`, etc.

**Surface tokens** (re-mapped to org colors inside `[orgSlug]` layout):
- `background`, `foreground`, `card`, `card-foreground`
- `muted`, `muted-foreground`, `border`, `ring`

**Landing page colors** (RGB variables with alpha support):
- `landing-navy`, `landing-cream`, `landing-green` + light/dark variants
- Use: `rgb(var(--landing-navy-rgb) / <alpha-value>)`

**Semantic colors**: `success`, `warning`, `error`, `info`

**Font families**:
- `font-sans` — Plus Jakarta Sans
- `font-display` — Bitter (serif)
- `font-mono` — Space Mono

**Custom utilities**: `shadow-soft`, `rounded-2xl` (1rem), `rounded-3xl` (1.5rem)

## Org Layout and CSS Variable Injection

`src/app/[orgSlug]/layout.tsx` is the entry point for all org-scoped pages.

**Color injection flow:**
1. Reads `organization.primary_color` and `organization.secondary_color` from DB
2. `adjustColor(hex, amount)` derives light/dark variants
3. `isColorDark(hex)` detects luminance to choose foreground text color (light vs dark)
4. Sets CSS variables on the layout `div` via inline `style`
5. Mirrors variables to `:root` via `<style>` tag so portals/modals inherit org colors

**Access gates** (checked in order, renders error UI or redirects):
1. Organization not found → `notFound()`
2. No user session → redirect to `/auth/login?redirect=/${orgSlug}`
3. Status revoked → "Access removed" message
4. No role → "No membership found" message
5. Grace period expired → `<BillingGate>` with `gracePeriodExpired`
6. Inactive subscription (not in grace period) → `<BillingGate>`

## Supabase Client Selection

| Wrapper | File | Context | Notes |
|---------|------|---------|-------|
| `createClient` | `lib/supabase/server.ts` | Server Components, layouts, route handlers | Uses `cookies()` |
| `createBrowserClient` | `lib/supabase/client.ts` | Client Components | Singleton, browser-only |
| `createMiddlewareClient` | `lib/supabase/middleware.ts` | Edge runtime middleware | Manual cookie management |
| `createServiceClient` | `lib/supabase/service.ts` | Admin operations | Bypasses RLS (webhooks, subscription mgmt) |

Config validation in `lib/supabase/config.ts` checks env vars and project ref.

## API Route Patterns

Common patterns across the 20+ routes in `src/app/api/`:

**Rate limiting** (nearly all routes):
```typescript
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";

const rateLimit = checkRateLimit(req, { userId, feature: "feature-name" });
if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);
// Include rateLimit.headers in all responses
```

**Zod validation** (mutation routes):
```typescript
import { validateJson, ValidationError } from "@/lib/security/validation";

const body = await validateJson(req, schema, { maxBodyBytes: 10_000 });
```

**Auth + role check**:
```typescript
const { data: { user } } = await supabase.auth.getUser();
if (!user) return respond({ error: "Unauthorized" }, 401);
// Then check role via user_organization_roles table
```

**Read-only guard** (mutation routes in orgs with canceled subscriptions):
```typescript
import { checkOrgReadOnly, readOnlyResponse } from "@/lib/subscription/read-only-guard";

const { isReadOnly } = await checkOrgReadOnly(organizationId);
if (isReadOnly) return respond(readOnlyResponse(), 403);
```

**Webhook idempotency** (Stripe webhook):
```typescript
import { registerStripeEvent, markStripeEventProcessed } from "@/lib/payments/stripe-events";

const alreadyProcessed = await registerStripeEvent(supabase, event.id);
if (alreadyProcessed) return NextResponse.json({ received: true });
```

**Structured responses**: `{ success, data }` or `{ error, details? }` with appropriate status codes.

## Key Hooks

| Hook | Purpose |
|------|---------|
| `useIdempotencyKey` | Stable payment key in localStorage; returns `{ idempotencyKey, refreshKey }` |
| `useCaptcha` | hCaptcha state management; returns `{ token, isVerified, onVerify, reset, ... }` |
| `useDistinctValues` | Generic distinct-value fetcher for org tables |
| `useOrgRole` | Current user's role + boolean flags (`isAdmin`, `canEdit`, etc.) |

**Domain-specific variants** (all from `useDistinctValues`):
`useIndustries`, `useCompanies`, `useCities`, `usePositions`, `useMajors`, `useGraduationYears`

All exported from `src/hooks/index.ts`.

## Key Files

| File | Purpose |
|------|---------|
| `src/app/[orgSlug]/layout.tsx` | Org context, CSS variable injection, access gates |
| `src/lib/supabase/` | Four client wrappers + config validation |
| `src/lib/security/rate-limit.ts` | Per-IP + per-user rate limiting (in-memory) |
| `src/lib/security/webhook-rate-limit.ts` | Webhook-specific rate limiting |
| `src/lib/security/cors.ts` | CORS headers (origin-aware) |
| `src/lib/security/captcha.ts` | Server-side hCaptcha verification |
| `src/lib/security/validation.ts` | `validateJson()` helper, Zod + `@teammeet/validation` re-exports |
| `src/lib/subscription/grace-period.ts` | 30-day grace period calculation |
| `src/lib/subscription/read-only-guard.ts` | Blocks mutations during grace period |
| `src/lib/subscription/delete-organization.ts` | Cascading org deletion (20+ tables) |
| `src/lib/google/oauth.ts` | Google OAuth flow, token encryption (AES-256-GCM) |
| `src/lib/google/calendar-sync.ts` | Google Calendar CRUD + sync orchestration |
| `src/hooks/` | Client-side hooks (see Key Hooks above) |
| `src/components/ui/` | Base UI primitives (Button, Card, Input, etc.) |
| `src/components/layout/` | OrgSidebar, MobileNav, GracePeriodBanner, BillingGate |
| `tailwind.config.ts` | CSS variable theme system |
| `next.config.mjs` | Env validation at build time, image domains |
| `vercel.json` | Deployment config |

## Deployment

- **Platform**: Vercel with Turborepo
- **Build**: `cd ../.. && bun turbo build --filter=@teammeet/web`
- **Install**: `cd ../.. && bun install` (runs from monorepo root)
- **Env validation**: `next.config.mjs` validates Supabase + Stripe vars at build time; use `SKIP_STRIPE_VALIDATION=true` in dev
- **Remote images**: `lh3.googleusercontent.com`, `avatars.githubusercontent.com`, Supabase storage
