# Mobile App — CLAUDE.md

Self-contained reference for `apps/mobile/`. Root `CLAUDE.md` covers web app, payments, and database patterns.

## Commands

```bash
bun run start            # Expo dev server (web at localhost:8081)
bun run ios              # iOS simulator
bun run android          # Android emulator
bun run typecheck        # tsc --noEmit
bun test                 # All Jest tests
bun test -- --watch      # Watch mode
bun test -- --coverage   # Coverage report
```

## Architecture

**Stack:** Expo SDK 54, React Native 0.81, React 19, Expo Router 6
**Auth:** Supabase with AsyncStorage (not cookies)
**Styling:** React Native `StyleSheet` (not Tailwind/NativeWind)
**State:** React Context + hooks (no Redux/Zustand)

**Provider hierarchy:**
```
AuthProvider → GestureHandlerRootView → StripeProvider → Stack
  └─ (auth): login, signup, forgot-password, reset-password, callback
  └─ (app)/(drawer): org list, profile, terms
       └─ [orgSlug] (OrgProvider)
            └─ (tabs): home, members, alumni, announcements, calendar, menu
            └─ Feature stacks: chat, events, announcements, workouts, schedules, etc.
```

## Routing

| Route Group | Purpose |
|---|---|
| `(auth)` | Unauthenticated screens |
| `(app)/(drawer)` | Authenticated — org list, profile, terms |
| `(app)/(drawer)/[orgSlug]/(tabs)` | Org-scoped tab screens (primary nav) |
| `(app)/(drawer)/[orgSlug]/[feature]` | Org-scoped feature stacks |

Drawer = secondary nav (org logo tap). Tabs = primary nav.

## Styling

Use `StyleSheet.create()` for all styling. Design tokens in `src/lib/design-tokens.ts`:

- **NEUTRAL** — surface, background, foreground, border (app chrome)
- **SEMANTIC** — success, warning, error, info
- **ENERGY** — live indicators, achievements
- Also: `ROLE_COLORS`, `RSVP_COLORS`, `SPACING` (8pt grid), `RADIUS`, `SHADOWS`, `AVATAR_SIZES`

**APP_CHROME** (`src/lib/chrome.ts`): Fixed header gradient (`#0f172a` → `#020617`) and tab bar colors.

**Brand wordmark** (`assets/brand-logo.png`, `@2x.png`, `@3x.png`): Product logo sourced from the web app (`apps/web/public/TeamNetwor.png`). Use via `require()` with `expo-image`, `contentFit="contain"`, `transition={0}`, `cachePolicy="memory"`. Intended for dark surfaces only (`#0a0a0a`–`#0f172a` range) — the type is light-colored. NOT for use as launcher icon or splash; those are separate assets in `android/app/src/main/res/` and `assets/splash.png`.

## Screen UI Pattern

All org screens follow this layout:

```typescript
<View style={styles.container}>
  <LinearGradient colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}>
    <SafeAreaView edges={["top"]}>
      <Pressable onPress={handleDrawerToggle}>
        <Image source={{ uri: org.logo_url }} />
      </Pressable>
      <Text style={styles.headerTitle}>Screen Title</Text>
    </SafeAreaView>
  </LinearGradient>
  <View style={styles.contentSheet}>{/* content */}</View>
</View>
```

Requirements:
1. `headerShown: false` in screen options
2. Org logo opens drawer via `DrawerActions.toggleDrawer()`
3. Content sheet uses `NEUTRAL.surface` background
4. Web URLs: `https://www.myteamnetwork.com/[orgSlug]/[screen]` (not `app.teammeet.com`)

## Drawer Navigation

File: `src/navigation/DrawerContent.tsx`. Accessible via org logo tap.

Sections: Main (Home, Chat, Alumni*, Mentorship), Training, Money, Other (Forms). Pinned footer: Settings, Navigation, Organizations, Sign Out. *Alumni conditional on `permissions.canViewAlumni`.

Navigation: Home/Organizations use `router.push()`, everything else uses `router.replace()`.

## Data Fetching

Custom hooks in `src/hooks/` (e.g., `useEvents`, `useMembers`, `useAnnouncements`):

- **Stale-while-revalidate:** 30s stale time. `refetchIfStale()` on tab focus, `refetch()` on pull-to-refresh.
- **Realtime:** Supabase `postgres_changes` channel subscriptions auto-refetch.
- **Cleanup:** `isMountedRef` prevents updates after unmount.
- **Soft deletes:** Always filter `.is("deleted_at", null)`.

## Adding a New Screen

1. Create file in appropriate route group
2. Follow gradient header + content sheet pattern
3. Set `headerShown: false`
4. Use `useOrg()` for org context
5. Create data hook in `src/hooks/` following `useEvents` pattern
6. Use `useFocusEffect` with `refetchIfStale()`

## Component Patterns

- **Pressable** over TouchableOpacity
- **expo-image** Image over RN Image
- **lucide-react-native** for icons
- **@gorhom/bottom-sheet** for bottom sheets
- **SafeAreaView** from react-native-safe-area-context
- **LinearGradient** from expo-linear-gradient

## Supabase Client

`src/lib/supabase.ts` uses AsyncStorage (not cookies): `autoRefreshToken: true`, `persistSession: true`, `detectSessionInUrl: false`.

## TypeScript Patterns

**Database Nullability:** Always handle nulls from Supabase. Provide defaults when displaying.

**RPC Parameters:** Use `undefined` (not `null`) for optional params: `p_uses: usesValue ?? undefined`.

**React Navigation Types:** Use `any` for nav props due to Expo Router / React Navigation type conflicts.

**Expo SDK 54 APIs:**
- Notifications: Include `shouldShowBanner` and `shouldShowList` in handler
- Application: Use `Application.getAndroidId()` (not `.androidId`)
- FileSystem: Use string `"base64"` (not `FileSystem.EncodingType.Base64`)

**ThemeColors:** Screen-local `*_COLORS` must include all ThemeColors properties (background, foreground, card, border, muted, primary/secondary variants, success, warning, error, etc.).

## Analytics

PostHog (product analytics) + Sentry (error tracking). Abstraction in `src/lib/analytics/`. Auto screen tracking via `src/hooks/useScreenTracking.ts`. Disabled in `__DEV__` by default. Init in `app/_layout.tsx`.

## Environment Variables

In `.env.local` (never commit): `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`.

## Testing

- **Runner:** Jest 29 with `babel-jest` + `babel-preset-expo`
- **Environment:** `node` (not jsdom)
- **Location:** `__tests__/` mirroring `src/`
- **Scope:** Pure function tests only (components/hooks need Detox/Maestro for E2E)
- **Module aliases:** `@/` and `@teammeet/*` mapped in `jest.config.js`
- **Coverage:** Per-file thresholds in `jest.config.js`

## Shared Packages

```typescript
import { normalizeRole, roleFlags } from "@teammeet/core";
import type { Organization, UserRole } from "@teammeet/types";
import { baseSchemas, z } from "@teammeet/validation";
```

## Monorepo Integration

- `@/*` → `./src/*` (tsconfig.json + jest.config.js)
- Metro config: `watchFolders` includes workspace root, `extraNodeModules` pins react/react-native to local copies

## Key Files

| File | Purpose |
|---|---|
| `app/_layout.tsx` | Root layout, auth, Stripe, analytics init |
| `app/(app)/(drawer)/[orgSlug]/(tabs)/_layout.tsx` | Tab navigator |
| `app/(app)/(drawer)/[orgSlug]/(tabs)/index.tsx` | Home screen (reference impl) |
| `src/contexts/AuthContext.tsx` | Auth state |
| `src/contexts/OrgContext.tsx` | Org scope |
| `src/navigation/DrawerContent.tsx` | Drawer sections |
| `src/lib/design-tokens.ts` | Design tokens |
| `src/lib/chrome.ts` | Header/tab bar colors |
| `metro.config.js` | Metro monorepo config |

## Coding Conventions

TypeScript strict, 2-space indent, semicolons, double quotes. PascalCase components, camelCase functions. `useX` hooks. Commits: `feat:`, `fix:`, `chore:`.
