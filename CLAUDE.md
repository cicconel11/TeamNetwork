# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

This is an npm workspaces monorepo using Turborepo for task orchestration:

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
bun dev              # Start Next.js dev server at localhost:3000
bun dev:web          # Same as above
bun dev:mobile       # Start Expo dev server at localhost:8081
bun build            # Build all packages (uses Turborepo caching)
bun lint             # Run ESLint across packages
bun typecheck        # Type-check all packages in parallel
```

### Mobile Development
```bash
cd apps/mobile
bun run start            # Start Expo dev server (web at localhost:8081)
bun run ios              # Start and open in iOS simulator
bun run android          # Start and open in Android emulator
```

### Testing
```bash
bun run test:auth      # Test authentication middleware
bun run test:payments  # Test payment idempotency and Stripe webhooks
```

### Stripe Webhook Testing (Local)
```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

## Architecture

### Tech Stack
- **Web Framework**: Next.js 14 with App Router (TypeScript, React 18)
- **Mobile Framework**: Expo SDK 54 with Expo Router (TypeScript, React Native)
- **Database**: Supabase (PostgreSQL with RLS policies)
- **Authentication**: Supabase Auth (with SSR for web, AsyncStorage for mobile)
- **Payments**: Stripe (subscriptions + Stripe Connect for donations)
- **Email**: Resend
- **Package Manager**: Bun (replaces npm/yarn)
- **Build System**: Turborepo (task caching and parallel execution)
- **Web Styling**: Tailwind CSS
- **Mobile Styling**: React Native StyleSheet (not Tailwind)

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
- `EXPO_PUBLIC_POSTHOG_KEY` - PostHog project API key
- `EXPO_PUBLIC_SENTRY_DSN` - Sentry DSN for error tracking

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
- **Styling**: React Native `StyleSheet` API (not Tailwind or NativeWind)
- **Navigation**: File-based routing via Expo Router
- **Package Manager**: Bun (with local dependencies hoisted via Metro config)

### Mobile Styling

All mobile screens use React Native's native `StyleSheet` for styling:

```typescript
import { StyleSheet } from "react-native";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  text: { fontSize: 16, color: "#1a1a1a" },
});
```

**Why StyleSheet instead of Tailwind/NativeWind?**
- Metro bundler + Bun's module hoisting creates compatibility issues with CSS-in-JS frameworks
- StyleSheet is more performant and requires no additional transpilation
- Simpler dependency management without Tailwind/PostCSS
- All mobile screens have been migrated to this approach

### Mobile Design Tokens

All mobile screens use a unified design token system for consistent styling:

**Design Tokens File** (`apps/mobile/src/lib/design-tokens.ts`):
```typescript
import { NEUTRAL, SEMANTIC, ENERGY } from "@/lib/design-tokens";

// NEUTRAL - App chrome colors (backgrounds, text, borders)
NEUTRAL.surface      // #ffffff - content sheet backgrounds
NEUTRAL.background   // #f8fafc - main content areas
NEUTRAL.foreground   // #0f172a - primary text
NEUTRAL.border       // #e2e8f0 - borders and dividers

// SEMANTIC - Status colors (success, warning, error, info)
// ENERGY - Live indicators, achievements, online status
```

**APP_CHROME Colors** (`apps/mobile/src/lib/chrome.ts`):
- Header gradient and tab bar colors (fixed, not org-themed)
- Gradient: `#0f172a` (slate-900) → `#020617` (slate-950)
- Tab bar: dark slate with white active icons

### Mobile Screen UI Pattern

All 15 org screens (6 tabs + 9 sidebar) follow a consistent layout pattern:

**Screen Layout Structure:**
```typescript
<View style={styles.container}>
  {/* Gradient Header */}
  <LinearGradient colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}>
    <SafeAreaView edges={["top"]}>
      <View style={styles.headerContent}>
        {/* Org logo (opens drawer on press) */}
        <Pressable onPress={handleDrawerToggle}>
          <Image source={{ uri: org.logo_url }} />
        </Pressable>
        {/* Title + optional metadata */}
        <Text style={styles.headerTitle}>Screen Title</Text>
        {/* Optional: OverflowMenu for admin actions */}
      </View>
    </SafeAreaView>
  </LinearGradient>

  {/* Content Sheet */}
  <View style={styles.contentSheet}>
    {/* Screen content */}
  </View>
</View>
```

**Content Sheet Styling (REQUIRED):**
```typescript
import { NEUTRAL } from "@/lib/design-tokens";

contentSheet: {
  flex: 1,
  backgroundColor: NEUTRAL.surface,  // Always use NEUTRAL.surface (#ffffff)
}
```

**Key Requirements:**
1. **`headerShown: false`** in `Tabs.Screen` options - prevents double headers
2. **Drawer toggle** - Org logo in header opens drawer via `DrawerActions.toggleDrawer()`
3. **Content sheet** - Always use `NEUTRAL.surface` for backgroundColor (unified across all screens)
4. **Screen-local colors** - Each screen can define `*_COLORS` for cards/text/borders, but contentSheet must use shared tokens

**Web URLs:**
- "Open in Web" links must use `https://www.myteamnetwork.com/[orgSlug]/[screen]`
- NOT `app.teammeet.com` (legacy domain)

**Files:**
- `apps/mobile/src/lib/design-tokens.ts` - Unified design tokens (NEUTRAL, SEMANTIC, ENERGY)
- `apps/mobile/src/lib/chrome.ts` - APP_CHROME header/tab bar colors
- `apps/mobile/app/(app)/(drawer)/[orgSlug]/(tabs)/_layout.tsx` - Tab navigator
- `apps/mobile/app/(app)/(drawer)/[orgSlug]/(tabs)/index.tsx` - Home screen (reference implementation)

### Mobile Drawer Navigation

The mobile app uses a drawer navigator for secondary navigation. The drawer is accessible by tapping the org logo in any screen header.

**File:** `apps/mobile/src/navigation/DrawerContent.tsx`

**Drawer Structure:**
- **Profile Card** - User avatar, name, email (transparent background)
- **Grouped Sections** with uppercase headers:
  - **Main** (no header): Home, Chat, Alumni*, Mentorship
  - **Training**: Workouts, Competition, Schedules, Records
  - **Money**: Philanthropy, Donations, Expenses
  - **Other**: Forms
- **Pinned Footer** (always visible at bottom):
  - Settings, Navigation, Organizations, Sign Out

*Alumni appears conditionally based on `permissions.canViewAlumni`

**Styling:**
- Uber-style flat design (no pill backgrounds on items)
- 44px row height, 18px icons, 15px font
- Active route gets subtle highlight (`rgba(255,255,255,0.06)`)
- Section headers: 11px uppercase, muted color, 0.5 letter-spacing
- Hairline dividers between profile/content and content/footer
- Safe area insets for bottom padding

**Navigation Behavior:**
- Home and Organizations use `router.push()` (preserves back navigation)
- All other items use `router.replace()` (avoids stacking)
- Web links open via `Linking.openURL()`

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

### Mobile Analytics & Observability

The mobile app uses PostHog for product analytics and Sentry for error tracking.

**Stack:**
- **PostHog**: Screen tracking, user identification, user properties
- **Sentry**: Crash reporting, error tracking with context

**Architecture:**
- `apps/mobile/src/lib/analytics/index.ts` - Abstraction layer with event queue, lazy SDK init
- `apps/mobile/src/lib/analytics/posthog.ts` - PostHog wrapper
- `apps/mobile/src/lib/analytics/sentry.ts` - Sentry wrapper
- `apps/mobile/src/hooks/useScreenTracking.ts` - Automatic screen tracking via Expo Router
- `apps/mobile/app/_layout.tsx` - Init analytics on app launch, identify on login/logout

**Configuration:**
- Keys stored in `apps/mobile/.env.local`: `EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_SENTRY_DSN`
- Disabled by default in `__DEV__` mode (set `setEnabled(true)` to test locally)
- Pre-init event queue buffers calls before SDKs initialize
- Config validation warns if keys missing in production
- Enabled state persisted to AsyncStorage across app restarts

#### What Gets Tracked

**App Launch:**
- Analytics SDKs initialize if enabled and config valid
- Queued events flush

**User Login:**
- `identify()` event with user ID, email, auth provider
- Session tracking begins

**Screen Navigation:**
- `$screen` event for each route change (via `useScreenTracking` hook)
- Properties: screen name, pathname
- Derived from Expo Router segments

**Organization Context Change:**
- `setUserProperties()` updates when org or role changes
- Tracks: currentOrgSlug, currentOrgId, role (admin/member/alumni/unknown)
- Role normalized via `normalizeRole()` from @teammeet/core

**Errors:**
- Logged to console (dev visibility) and Sentry simultaneously
- Captured via `captureException()` with context (screen name, org, etc.)
- Full stack traces sent to Sentry with request/response data

**User Logout:**
- `reset()` clears user identity, queued events, and analytics state
- Next session appears as new anonymous user

#### Future Work

- [ ] Sentry performance monitoring (API response times, screen render times)
- [ ] Custom event tracking for feature usage (events created, members invited, donations made)
- [ ] Session replay via PostHog (recording user sessions)
- [ ] A/B testing via PostHog feature flags
- [ ] In-app settings toggle for analytics opt-in/opt-out
- [ ] Funnel analysis for key user flows (signup, first event, first donation)

## Coding Conventions

From `AGENTS.md`:
- TypeScript with strict mode
- 2-space indentation, semicolons, double quotes
- PascalCase for components, camelCase for functions/variables
- `useX` naming for custom hooks
- Commit prefixes: `feat:`, `fix:`, `chore:`
- Test files: `*.test.ts` using Node's built-in test runner

### Mobile TypeScript Patterns

**Database Nullability:** Supabase returns nullable fields. Always handle nulls in interfaces:
```typescript
// Good - matches database reality
interface Membership {
  created_at: string | null;
  role: string | null;
}

// When displaying, provide defaults
{member.created_at ? formatDate(member.created_at) : ""}
{getRoleLabel(invite.role || "active_member")}
```

**RPC Parameters:** Supabase RPC functions expect `undefined` (not `null`) for optional params:
```typescript
// Good
await supabase.rpc("create_org_invite", {
  p_uses: usesValue ?? undefined,
  p_expires_at: expiresAt ?? undefined,
});

// Bad - will cause type errors
p_uses: usesValue ?? null,
```

**React Navigation Types:** Expo Router and React Navigation have duplicate type definitions that conflict. Use `any` assertions for navigation props:
```typescript
// Tab bar render prop
const renderTabBar = useCallback(
  (props: any) => <TabBar {...props} onActionPress={handleActionPress} />,
  [handleActionPress]
);

// Drawer content
drawerContent={(props: any) => <DrawerContent {...props} />}
```

**Generic Filter Components:** When building filter components that accept mixed types, use `unknown`:
```typescript
interface FilterGroup {
  options: unknown[];
  selected: unknown | null;
  onSelect: (value: unknown | null) => void;
}

// At call site, cast appropriately
onSelect: (v) => setSelectedYear(v as number | null)
```

**Expo SDK 54 APIs:**
- Notifications: Include `shouldShowBanner` and `shouldShowList` in handler
- Application: Use `Application.getAndroidId()` (not `Application.androidId`)
- FileSystem: Use string `"base64"` (not `FileSystem.EncodingType.Base64`)

**ThemeColors Interface:** Screen-local color constants must include all ThemeColors properties:
```typescript
const SCREEN_COLORS = {
  // Required base colors
  background, foreground, card, border, muted, mutedForeground,
  primary, primaryLight, primaryDark, primaryForeground,
  secondary, secondaryLight, secondaryDark, secondaryForeground,
  mutedSurface, success, warning, error,
};
```

## Key Files to Understand

### Web App
- `apps/web/src/middleware.ts` - Request interception, auth, org validation
- `apps/web/src/app/[orgSlug]/layout.tsx` - Organization context provider
- `apps/web/src/lib/auth/roles.ts` - Role checking utilities
- `apps/web/src/lib/payments/idempotency.ts` - Payment deduplication logic
- `apps/web/src/lib/navigation/nav-items.tsx` - Navigation structure and role filtering

### Mobile App
- `apps/mobile/app/_layout.tsx` - Root layout with auth state management
- `apps/mobile/app/(auth)/login.tsx` - Login screen (email/password + Google OAuth)
- `apps/mobile/app/(app)/index.tsx` - Organizations list
- `apps/mobile/app/(app)/(drawer)/[orgSlug]/(tabs)/` - Org-specific screens (members, alumni, announcements, events)
- `apps/mobile/metro.config.js` - Metro bundler config with monorepo support

### Documentation
- `docs/db/schema-audit.md` - Database schema documentation and known issues

## Known Issues & Considerations

From `docs/db/schema-audit.md`:
- Announcement notifications are stubs (needs Resend API integration)
- Consider moving invite code generation to server-side RPC for security
- RLS policies use helper functions: `is_org_admin()`, `is_org_member()`, `has_active_role()`

## Plan Mode

Sacrifice grammar at the sake of concision” is the stupidest advice possible. I saw opus thinking about this line and it took it to mean be efficient. Which meant building bullshit. Take it out of your stuff immediately.

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:
1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes