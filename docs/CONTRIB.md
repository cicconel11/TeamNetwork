# Contributing Guide

## Prerequisites

- [Bun](https://bun.sh/) v1.3.6+ (package manager and runtime)
- Node.js 20+
- iOS Simulator (for mobile iOS development)
- Android Studio / Android Emulator (for mobile Android development)

## Getting Started

```bash
# Clone and install dependencies
git clone <repo-url>
cd TeamMeet
bun install

# Set up environment variables
cp .env.local.example .env.local          # Web app
cp apps/mobile/.env.example apps/mobile/.env.local  # Mobile app
# Edit both files with your actual keys
```

## Monorepo Structure

```
TeamMeet/
├── apps/
│   ├── web/          # Next.js 14 with App Router (@teammeet/web)
│   └── mobile/       # Expo SDK 54 with Expo Router (@teammeet/mobile)
├── packages/
│   ├── core/         # Shared business logic (@teammeet/core)
│   ├── types/        # Supabase-generated TypeScript types (@teammeet/types)
│   └── validation/   # Zod schemas (@teammeet/validation)
├── supabase/         # Database migrations
└── docs/             # Documentation
```

## Available Scripts

### Root (runs via Turborepo)

| Command | Description |
|---------|-------------|
| `bun dev` | Start Next.js dev server at localhost:3000 |
| `bun dev:web` | Same as `bun dev` |
| `bun dev:mobile` | Start Expo dev server at localhost:8081 |
| `bun build` | Build all packages (uses Turborepo caching) |
| `bun build:web` | Build web app only |
| `bun lint` | Run ESLint across packages |
| `bun typecheck` | Type-check all packages in parallel |
| `bun format` | Format code with Prettier |
| `bun format:check` | Check formatting without changes |
| `bun test` | Run all web tests |
| `bun test:auth` | Test authentication middleware |
| `bun test:payments` | Test payment idempotency and Stripe webhooks |
| `bun test:security` | Test security features (rate limiting, etc.) |

### Web App (`apps/web/`)

| Command | Description |
|---------|-------------|
| `bun run dev` | Start Next.js dev server |
| `bun run build` | Production build |
| `bun run start` | Start production server |
| `bun run lint` | Run ESLint |
| `bun run test` | Run all test suites |
| `bun run test:unit` | Middleware, cancellation, grace period tests |
| `bun run test:auth` | Authentication middleware tests |
| `bun run test:payments` | Payment idempotency, webhook dedup, platform fee tests |
| `bun run test:security` | Webhook rate limit tests |
| `bun run test:mobile` | Mobile permissions, routing, parity tests |
| `bun run typecheck` | TypeScript type checking |

### Mobile App (`apps/mobile/`)

| Command | Description |
|---------|-------------|
| `bun run start` | Start Expo dev server (web at localhost:8081) |
| `bun run ios` | Start and open in iOS Simulator |
| `bun run android` | Start and open in Android Emulator |
| `bun run web` | Start Expo web mode |
| `bun run typecheck` | TypeScript type checking |
| `bun run test` | Run Jest tests |
| `bun run test:watch` | Run Jest in watch mode |
| `bun run test:coverage` | Run Jest with coverage report |
| `bun run test:ci` | CI test runner with coverage |

### Shared Packages

All shared packages support `bun run typecheck` via `bunx tsc --noEmit`.

## Environment Variables

### Web App (`.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (admin operations) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Yes | Stripe publishable key |
| `STRIPE_SECRET_KEY` | Yes | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Yes | Stripe webhook signing secret |
| `STRIPE_BASE_PLAN_MONTHLY_PRICE_ID` | Yes | Stripe price ID (+ 7 tier/billing variants) |
| `RESEND_API_KEY` | Yes | Resend email API key |
| `NEXT_PUBLIC_APP_URL` | No | Application URL (default: www.myteamnetwork.com) |
| `SKIP_STRIPE_VALIDATION` | No | Set `true` in dev to skip Stripe price ID validation |

### Mobile App (`apps/mobile/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `EXPO_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `EXPO_PUBLIC_WEB_URL` | No | Web app URL for API calls |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | No | Google OAuth web client ID |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | No | Google OAuth iOS client ID |
| `EXPO_PUBLIC_POSTHOG_KEY` | No | PostHog product analytics key |
| `EXPO_PUBLIC_SENTRY_DSN` | No | Sentry error tracking DSN |
| `EXPO_PUBLIC_HCAPTCHA_SITE_KEY` | No | hCaptcha site key for donations |
| `EXPO_PUBLIC_HCAPTCHA_BASE_URL` | No | hCaptcha base URL |
| `EXPO_PUBLIC_DEV_EMAIL` | No | Dev login email (development only) |
| `EXPO_PUBLIC_DEV_PASSWORD` | No | Dev login password (development only) |

## Development Workflow

### Web Development

```bash
bun dev                    # Start dev server
# Make changes, hot reload is automatic
bun typecheck              # Check types before committing
bun lint                   # Check linting
bun test                   # Run tests
```

### Mobile Development

```bash
bun dev:mobile             # Start Expo dev server
# Press 'i' for iOS, 'a' for Android, 'w' for web

# Or run directly on platform:
cd apps/mobile
bun run ios                # iOS Simulator
bun run android            # Android Emulator
```

### Stripe Webhook Testing (Local)

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

## Build Pipeline

Turborepo manages task orchestration with these dependency chains:

- `build` depends on `^build` (packages build before apps)
- `lint` depends on `^typecheck`
- `typecheck` depends on `^typecheck`
- `test` depends on `^typecheck`
- `dev` and `start` are persistent (non-cacheable)

## Coding Conventions

- TypeScript strict mode
- 2-space indentation, semicolons, double quotes
- PascalCase for components, camelCase for functions/variables
- `useX` naming for custom hooks
- Commit prefixes: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- Web styling: Tailwind CSS
- Mobile styling: React Native `StyleSheet` (not Tailwind/NativeWind)
- Test files: `*.test.ts` using Node's built-in test runner (web) or Jest (mobile)

## Shared Packages

Import shared code using package names:

```typescript
import { normalizeRole, roleFlags } from "@teammeet/core";
import type { Organization, UserRole } from "@teammeet/types";
import { baseSchemas, validateOrgName, z } from "@teammeet/validation";
```

| Package | Exports |
|---------|---------|
| `@teammeet/core` | `normalizeRole()`, `roleFlags()`, `filterAnnouncementsForUser()`, pricing constants |
| `@teammeet/types` | `Database`, `Tables<T>`, `Enums<T>`, `Organization`, `UserRole` |
| `@teammeet/validation` | `baseSchemas`, `safeString()`, `uuidArray()`, Zod schemas |
