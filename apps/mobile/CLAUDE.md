# Mobile App — CLAUDE.md

Self-contained reference for working in `apps/mobile/`. The root `CLAUDE.md` covers the full monorepo, web app, payment systems, and database patterns.

## Commands

```bash
bun run start                            # Expo dev server (web at localhost:8081)
bun run ios                              # Open in iOS simulator
bun run android                          # Open in Android emulator
bun run typecheck                        # tsc --noEmit
bun test                                 # Run all Jest tests
bun test -- --watch                      # Watch mode
bun test -- --coverage                   # Coverage report
bun test -- __tests__/lib/theme.test.ts  # Single test file
```

## Architecture

**Stack:** Expo SDK 54, React Native 0.81, React 19, Expo Router 6

**Auth:** Supabase with AsyncStorage (not cookies)
**Styling:** React Native `StyleSheet` API (not Tailwind or NativeWind)
**Navigation:** File-based routing via Expo Router
**Package Manager:** Bun (with local dependencies hoisted via Metro config)

**Provider hierarchy:**
```
AuthProvider → GestureHandlerRootView → StripeProvider → Stack
  └─ (auth) group: login, signup, forgot-password, reset-password, callback
  └─ (app) group
       └─ (drawer) — org list, profile, terms
            └─ [orgSlug] — OrgProvider
                 └─ (tabs) — 6 tab screens (home, members, alumni, announcements, events, menu)
                 └─ Feature stacks: chat, events, announcements, workouts, schedules, etc.
```

**State management:** React Context + custom hooks (no Redux/Zustand). `AuthContext` for session/user/signOut. `OrgContext` for orgSlug, orgId, name, logo, colors, userRole.

## Routing Structure

| Route Group | Purpose |
|---|---|
| `(auth)` | Unauthenticated screens (login, signup, forgot/reset password, OAuth callback) |
| `(app)/(drawer)` | Authenticated — org list at root (`index.tsx`), profile, terms |
| `(app)/(drawer)/[orgSlug]/(tabs)` | Org-scoped tab screens (primary nav) |
| `(app)/(drawer)/[orgSlug]/[feature]` | Org-scoped feature stacks (events/new, members/[id], etc.) |

The `[orgSlug]` dynamic segment scopes all org content. Drawer is secondary nav (org logo tap toggles it). Tabs are primary nav.

## Styling

All mobile screens use React Native's native `StyleSheet`:

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

### Design Tokens

Unified design token system in `src/lib/design-tokens.ts`:

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

Also exports: `ROLE_COLORS`, `RSVP_COLORS`, `SPACING` (8pt grid), `RADIUS`, `SHADOWS`, `AVATAR_SIZES`, `ANIMATION`.

### APP_CHROME Colors

Fixed header/tab bar colors in `src/lib/chrome.ts` (not org-themed):
- Header gradient: `#0f172a` (slate-900) → `#020617` (slate-950)
- Tab bar: dark slate (`#020617`) with white active icons, slate-400 inactive
- Action button: white background, slate-900 icon

## Screen UI Pattern

All org screens follow a consistent layout:

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
1. **`headerShown: false`** in screen options — prevents double headers
2. **Drawer toggle** — Org logo in header opens drawer via `DrawerActions.toggleDrawer()`
3. **Content sheet** — Always use `NEUTRAL.surface` for backgroundColor
4. **Screen-local colors** — Each screen can define `*_COLORS` for cards/text/borders, but contentSheet must use shared tokens

**Web URLs:**
- "Open in Web" links must use `https://www.myteamnetwork.com/[orgSlug]/[screen]`
- NOT `app.teammeet.com` (legacy domain)

## Drawer Navigation

File: `src/navigation/DrawerContent.tsx`

The drawer is accessible by tapping the org logo in any screen header.

**Structure:**
- **Profile Card** — User avatar, name, email (transparent background)
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
- Active route: subtle highlight (`rgba(255,255,255,0.06)`)
- Section headers: 11px uppercase, muted color, 0.5 letter-spacing
- Hairline dividers between profile/content and content/footer
- Safe area insets for bottom padding

**Navigation Behavior:**
- Home and Organizations use `router.push()` (preserves back navigation)
- All other items use `router.replace()` (avoids stacking)
- Web links open via `Linking.openURL()`

## Data Fetching Pattern

Custom hooks in `src/hooks/` (e.g., `useEvents`, `useMembers`, `useAnnouncements`, `useDonations`):

- **Stale-while-revalidate:** 30s stale time via `lastFetchTimeRef`. Call `refetchIfStale()` on tab focus, `refetch()` on pull-to-refresh.
- **Realtime:** Supabase `postgres_changes` channel subscriptions auto-refetch on INSERT/UPDATE/DELETE.
- **Cleanup:** `isMountedRef` pattern prevents state updates after unmount.
- **Soft deletes:** All queries must filter `.is("deleted_at", null)`.

```typescript
// Typical usage in a screen
const { events, loading, error, refetch, refetchIfStale } = useEvents(orgId);

useFocusEffect(
  useCallback(() => { refetchIfStale(); }, [refetchIfStale])
);
```

## Adding a New Screen

1. Create file in the appropriate route group (file-based routing)
2. Follow gradient header + content sheet pattern (see Screen UI Pattern above)
3. Set `headerShown: false` in screen options
4. Use `useOrg()` for org context (orgId, orgSlug, userRole, orgName, orgLogoUrl)
5. Create a data hook in `src/hooks/` following the `useEvents` pattern if fetching data
6. Use `useFocusEffect` with `refetchIfStale()` for data freshness on tab focus

## Component Patterns

- **Pressable** over `TouchableOpacity` for press interactions
- **expo-image** `Image` over React Native's `Image` for network images
- **lucide-react-native** for icons
- **@gorhom/bottom-sheet** for bottom sheets
- **react-native-safe-area-context** `SafeAreaView` for safe areas
- **expo-linear-gradient** `LinearGradient` for header gradients

## Supabase Client

Mobile uses AsyncStorage instead of cookies (`src/lib/supabase.ts`):

```typescript
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

## Role-Based Access Control

Three roles control access:
- **admin**: Full access, manage settings/invites/navigation
- **active_member**: Access to most features (events, workouts, etc.)
- **alumni**: Read-only access, limited features

Role normalization: `member` → `active_member`, `viewer` → `alumni` (via `normalizeRole()` from `@teammeet/core`).

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

## TypeScript Patterns

**Database Nullability:** Supabase returns nullable fields. Always handle nulls:
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

**React Navigation Types:** Expo Router and React Navigation have duplicate type definitions. Use `any` assertions for navigation props:
```typescript
// Tab bar render prop
const renderTabBar = useCallback(
  (props: any) => <TabBar {...props} onActionPress={handleActionPress} />,
  [handleActionPress]
);

// Drawer content
drawerContent={(props: any) => <DrawerContent {...props} />}
```

**Generic Filter Components:** Use `unknown` for mixed-type filter components:
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

## Analytics & Observability

PostHog for product analytics, Sentry for error tracking.

**Architecture:**
- `src/lib/analytics/index.ts` — Abstraction layer with event queue, lazy SDK init
- `src/lib/analytics/posthog.ts` — PostHog wrapper
- `src/lib/analytics/sentry.ts` — Sentry wrapper
- `src/hooks/useScreenTracking.ts` — Automatic screen tracking via Expo Router
- `app/_layout.tsx` — Init analytics on app launch, identify on login/logout

**Configuration:**
- Keys in `.env.local`: `EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_SENTRY_DSN`
- Disabled by default in `__DEV__` mode (set `setEnabled(true)` to test locally)
- Pre-init event queue buffers calls before SDKs initialize
- Config validation warns if keys missing in production
- Enabled state persisted to AsyncStorage across app restarts

**What Gets Tracked:**

| Event | Trigger | Details |
|---|---|---|
| SDK init | App launch | Initialize if enabled and config valid, flush queued events |
| `identify()` | User login | User ID, email, auth provider |
| `$screen` | Route change | Screen name, pathname (via `useScreenTracking`) |
| `setUserProperties()` | Org context change | currentOrgSlug, currentOrgId, role |
| `captureException()` | Error | Stack trace + context (screen, org) sent to Sentry |
| `reset()` | User logout | Clears identity, queued events, analytics state |

## Environment Variables

Stored in `.env.local` (never commit):

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `EXPO_PUBLIC_POSTHOG_KEY` | PostHog project API key |
| `EXPO_PUBLIC_SENTRY_DSN` | Sentry DSN for error tracking |
| `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key |
| `EXPO_PUBLIC_DEV_EMAIL` | Dev login email (development only) |
| `EXPO_PUBLIC_DEV_PASSWORD` | Dev login password (development only) |

## Testing

- **Runner:** Jest 29 with `babel-jest` + `babel-preset-expo` (NOT Node test runner)
- **Environment:** `node` (not jsdom)
- **Location:** `__tests__/` directory, mirroring `src/` structure
- **Scope:** Pure function tests only — React Native components/hooks need Detox/Maestro for E2E
- **Module aliases:** `@/` and `@teammeet/*` mapped in `jest.config.js` via `moduleNameMapper`
- **Mocks:** `__mocks__/` directory and `jest.setup.js`
- **Coverage thresholds:** Per-file (see `jest.config.js`), not global

Existing test files:
```
__tests__/analytics.test.ts
__tests__/contexts/OrgContext.test.ts
__tests__/featureFlags.test.ts
__tests__/hooks/useInvites.test.ts
__tests__/hooks/useMemberships.test.ts
__tests__/lib/chrome.test.ts
__tests__/lib/design-tokens.test.ts
__tests__/lib/notifications.test.ts
__tests__/lib/theme.test.ts
__tests__/lib/typography.test.ts
__tests__/permissions.test.ts
```

### iOS Simulator Testing

```bash
# Check available simulators
xcrun simctl list devices available | grep iPhone

# Boot a simulator
xcrun simctl boot "iPhone 15"

# Run Expo on iOS
bun run ios
```

**VoiceOver Testing (Manual):**
1. Open iOS Simulator
2. Settings → Accessibility → VoiceOver → ON
3. Swipe right to navigate between elements
4. Verify focus order and announcements

**Note:** iOS simulator runtimes may not be installed. Check with `xcrun simctl list runtimes`.

## Shared Packages

```typescript
import { normalizeRole, roleFlags } from "@teammeet/core";
import type { Organization, UserRole } from "@teammeet/types";
import { baseSchemas, validateOrgName, z } from "@teammeet/validation";
```

**@teammeet/core** — `normalizeRole()`, `roleFlags()`, `filterAnnouncementsForUser()`, pricing constants (`BASE_PRICES`, `ALUMNI_ADD_ON_PRICES`, `ALUMNI_LIMITS`)

**@teammeet/types** — Supabase-generated types: `Database`, `Tables<T>`, `Enums<T>`, `Organization`, `UserRole`, `AlumniBucket`

**@teammeet/validation** — Zod schemas: `baseSchemas` (uuid, slug, email), `safeString()`, `uuidArray()`

## Monorepo Integration

- **Path alias:** `@/*` resolves to `./src/*` (configured in `tsconfig.json` and `jest.config.js`)
- **Metro config** (`metro.config.js`):
  - `watchFolders` includes workspace root for shared package changes
  - `nodeModulesPaths` resolves from both local and root `node_modules`
  - `extraNodeModules` pins `react`, `react-dom`, `react-native`, `react-native-web` to local copies to avoid duplicate React instances

## Key Files

| File | Purpose |
|---|---|
| `app/_layout.tsx` | Root layout: AuthProvider, Stripe, deep linking, analytics init |
| `app/(auth)/login.tsx` | Login screen (email/password + Google OAuth) |
| `app/(app)/(drawer)/index.tsx` | Organizations list |
| `app/(app)/(drawer)/[orgSlug]/(tabs)/_layout.tsx` | Tab navigator with action sheet |
| `app/(app)/(drawer)/[orgSlug]/(tabs)/index.tsx` | Home screen (reference implementation) |
| `src/contexts/AuthContext.tsx` | Auth state (session, user, signOut) |
| `src/contexts/OrgContext.tsx` | Org scope (orgId, name, logo, colors, userRole) |
| `src/navigation/DrawerContent.tsx` | Drawer sections with role-based visibility |
| `src/lib/supabase.ts` | Supabase client with AsyncStorage |
| `src/lib/design-tokens.ts` | NEUTRAL, SEMANTIC, ENERGY, SPACING, RADIUS, SHADOWS |
| `src/lib/chrome.ts` | APP_CHROME header/tab bar colors |
| `src/lib/analytics/index.ts` | Analytics abstraction layer |
| `src/hooks/useScreenTracking.ts` | Automatic screen tracking |
| `metro.config.js` | Metro bundler monorepo configuration |
| `jest.config.js` | Jest config with module aliases and per-file coverage |

## Coding Conventions

- TypeScript with strict mode
- 2-space indentation, semicolons, double quotes
- PascalCase for components, camelCase for functions/variables
- `useX` naming for custom hooks
- Commit prefixes: `feat:`, `fix:`, `chore:`
- Test files: `*.test.ts` in `__tests__/`
