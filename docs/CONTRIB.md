# Contributing Guide

Development workflow and setup for TeamMeet monorepo.

## Prerequisites

- **Node.js** 20+
- **Bun** 1.3.6+ (package manager)
- **Xcode** (for iOS development)
- **Android Studio** (for Android development)

## Initial Setup

```bash
# Clone and install dependencies
git clone <repo-url>
cd TeamMeet
bun install

# Copy environment files
cp apps/web/.env.example apps/web/.env.local
cp apps/mobile/.env.example apps/mobile/.env.local
```

## Available Scripts

### Root (Monorepo)

| Script | Description |
|--------|-------------|
| `bun dev` | Start Next.js web dev server (localhost:3000) |
| `bun dev:web` | Same as above |
| `bun dev:mobile` | Start Expo dev server (localhost:8081) |
| `bun build` | Build all packages (Turborepo cached) |
| `bun build:web` | Build web app only |
| `bun lint` | Run ESLint across all packages |
| `bun typecheck` | Type-check all packages in parallel |
| `bun format` | Format code with Prettier |
| `bun format:check` | Check formatting without changes |
| `bun test` | Run web app tests |
| `bun test:auth` | Test authentication middleware |
| `bun test:payments` | Test payment idempotency and Stripe webhooks |
| `bun test:security` | Run security tests |

### Mobile App (`apps/mobile`)

| Script | Description |
|--------|-------------|
| `bun start` | Start Expo dev server |
| `bun dev:mobile` | Same as above |
| `bun ios` | Start and open in iOS simulator |
| `bun android` | Start and open in Android emulator |
| `bun web` | Start Expo web version |
| `bun typecheck` | Type-check mobile app |
| `bun test` | Run Jest tests |
| `bun test:watch` | Run tests in watch mode |
| `bun test:coverage` | Run tests with coverage report |
| `bun test:ci` | Run tests in CI mode |

## Environment Variables

### Mobile App (`apps/mobile/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `EXPO_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `EXPO_PUBLIC_WEB_URL` | Yes | Web app URL for API calls |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | No | Google OAuth web client ID |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | No | Google OAuth iOS client ID |
| `EXPO_PUBLIC_POSTHOG_KEY` | No | PostHog analytics API key |
| `EXPO_PUBLIC_SENTRY_DSN` | No | Sentry error tracking DSN |
| `EXPO_PUBLIC_HCAPTCHA_SITE_KEY` | No | hCaptcha site key for donations |
| `EXPO_PUBLIC_HCAPTCHA_BASE_URL` | No | hCaptcha base URL |

## Development Workflow

### 1. Create Feature Branch

```bash
git checkout -b feat/your-feature-name
```

### 2. Start Development Server

```bash
# Web
bun dev

# Mobile
cd apps/mobile && bun start
```

### 3. Run Tests

```bash
# Web tests
bun test

# Mobile tests
cd apps/mobile && bun test
```

### 4. Type Check

```bash
bun typecheck
```

### 5. Format and Lint

```bash
bun format
bun lint
```

### 6. Commit Changes

```bash
git add .
git commit -m "feat: your feature description"
```

## Testing

### Mobile App Testing

The mobile app uses Jest with file-specific coverage thresholds:

```bash
cd apps/mobile

# Run all tests
bun test

# Run with coverage
bun test:coverage

# Run in watch mode
bun test:watch
```

**Coverage Thresholds:**

| File | Statements | Lines |
|------|------------|-------|
| `lib/theme.ts` | 90% | 90% |
| `lib/featureFlags.ts` | 100% | 100% |
| `lib/analytics/index.ts` | 75% | 80% |
| `lib/chrome.ts` | 100% | 100% |
| `lib/design-tokens.ts` | 100% | 100% |
| `lib/typography.ts` | 100% | 100% |

**Note:** React Native components and hooks require the full Expo environment. Unit tests cover pure functions only. For full component testing, use E2E tools like Detox or Maestro.

### Web App Testing

```bash
bun test           # All tests
bun test:auth      # Auth middleware
bun test:payments  # Stripe/payments
bun test:security  # Security tests
```

## Project Structure

```
TeamMeet/
├── apps/
│   ├── web/                 # Next.js 14 web app
│   └── mobile/              # Expo React Native app
├── packages/
│   ├── core/                # Shared business logic
│   ├── types/               # TypeScript types
│   └── validation/          # Zod schemas
├── supabase/                # Database migrations
└── docs/                    # Documentation
```

## Code Style

- **TypeScript** strict mode
- **2-space** indentation
- **Semicolons** required
- **Double quotes** for strings
- **PascalCase** for components
- **camelCase** for functions/variables
- **useX** naming for hooks

## Commit Conventions

Format: `type: description`

Types:
- `feat:` - New feature
- `fix:` - Bug fix
- `refactor:` - Code refactoring
- `docs:` - Documentation
- `test:` - Tests
- `chore:` - Maintenance
- `perf:` - Performance
- `ci:` - CI/CD changes
