# TeamMeet Monorepo + React Native Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert TeamMeet from a single Next.js app to an npm workspaces monorepo with shared packages, then build an Expo mobile app for iOS/Android with MVP features (auth, members directory, announcements).

**Architecture:** Incremental migration that refactors web first (apps/web), extracts shared business logic to packages/, then builds mobile (apps/mobile). Backend stays unchanged - Supabase DB/RLS + Vercel API routes.

**Tech Stack:** npm workspaces, Next.js 14 (web), Expo Router (mobile), Supabase, TypeScript, Zod

---

## Completion Status

| Phase | Task | Status |
|-------|------|--------|
| Phase 1 | Monorepo Setup | DONE |
| Phase 2.1 | @teammeet/types | DONE |
| Phase 2.2 | @teammeet/validation | DONE |
| Phase 2.3 | @teammeet/core | DONE |
| Phase 3.1 | Expo App Init | DONE |
| Phase 3.2 | Auth Screens | DONE |
| Phase 4.1 | Org Selection Screen | DONE |
| Phase 4.2 | Members Directory | DONE |
| Phase 4.3 | Announcements Feed | DONE |
| Phase 5.1 | Update CLAUDE.md | DONE |

**Additional Completed Work:**
- Alumni bucket migration (0-200 → 0-250, etc.) - Database constraint updated
- Migration SQL file created: `supabase/migrations/20260114100000_update_alumni_buckets.sql`
- BillingGate.tsx fixed: "1500+" → "5000+"
- MIGRATION.md updated with complete status

---

## Phase 1: Monorepo Setup

### Task 1.1: Create Root Workspace Configuration

**Files:**
- Modify: `/Users/mleonard/sandbox/TeamMeet/package.json`
- Create: `/Users/mleonard/sandbox/TeamMeet/apps/web/package.json`

**Step 1: Update root package.json for workspaces**

```json
{
  "name": "teammeet",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev": "npm run dev --workspace=apps/web",
    "dev:web": "npm run dev --workspace=apps/web",
    "dev:mobile": "npm run start --workspace=apps/mobile",
    "build": "npm run build --workspace=apps/web",
    "build:web": "npm run build --workspace=apps/web",
    "lint": "npm run lint --workspace=apps/web",
    "test:auth": "npm run test:auth --workspace=apps/web",
    "test:payments": "npm run test:payments --workspace=apps/web"
  }
}
```

**Step 2: Move current app to apps/web/**

```bash
mkdir -p apps/web
# Move all app files (src, public, next.config.mjs, tsconfig.json, tailwind.config.ts, postcss.config.mjs)
mv src apps/web/
mv public apps/web/
mv next.config.mjs apps/web/
mv tailwind.config.ts apps/web/
mv postcss.config.mjs apps/web/
mv tests apps/web/
```

**Step 3: Create apps/web/package.json**

```json
{
  "name": "@teammeet/web",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test:auth": "node --test tests/auth-flow.test.ts",
    "test:payments": "node --test tests/payment-idempotency.test.ts"
  },
  "dependencies": {
    "@supabase/auth-helpers-nextjs": "^0.15.0",
    "@supabase/ssr": "^0.8.0",
    "@supabase/supabase-js": "^2.86.2",
    "@hcaptcha/react-hcaptcha": "^1.17.4",
    "animejs": "^4.2.2",
    "googleapis": "^170.0.0",
    "lucide-react": "^0.483.0",
    "next": "14.2.35",
    "react": "^18",
    "react-dom": "^18",
    "resend": "^6.6.0",
    "stripe": "^20.1.2",
    "zod": "^4.3.5",
    "@teammeet/core": "*",
    "@teammeet/types": "*",
    "@teammeet/validation": "*"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "eslint": "^8",
    "eslint-config-next": "14.2.35",
    "fast-check": "^4.5.3",
    "postcss": "^8",
    "tailwindcss": "^3.4.1",
    "typescript": "^5"
  }
}
```

**Step 4: Create apps/web/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"],
      "@teammeet/core": ["../../packages/core/src"],
      "@teammeet/types": ["../../packages/types/src"],
      "@teammeet/validation": ["../../packages/validation/src"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "playwright.config.ts", "tests"]
}
```

**Step 5: Verify monorepo structure works**

```bash
cd /Users/mleonard/sandbox/TeamMeet
rm -rf node_modules package-lock.json apps/web/node_modules
npm install
npm run dev:web
```

Expected: Next.js dev server starts at localhost:3000

**Step 6: Commit monorepo setup**

```bash
git add -A
git commit -m "chore: convert to npm workspaces monorepo structure"
```

---

## Phase 2: Extract Shared Packages

### Task 2.1: Create @teammeet/types Package

**Files:**
- Create: `/Users/mleonard/sandbox/TeamMeet/packages/types/package.json`
- Create: `/Users/mleonard/sandbox/TeamMeet/packages/types/tsconfig.json`
- Create: `/Users/mleonard/sandbox/TeamMeet/packages/types/src/index.ts`
- Move: `apps/web/src/types/database.ts` → `packages/types/src/database.ts`

**Step 1: Create packages/types/package.json**

```json
{
  "name": "@teammeet/types",
  "version": "1.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

**Step 2: Create packages/types/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "composite": true,
    "outDir": "./dist"
  },
  "include": ["src/**/*"]
}
```

**Step 3: Move database.ts and create index.ts**

```bash
mkdir -p packages/types/src
mv apps/web/src/types/database.ts packages/types/src/
```

**Step 4: Create packages/types/src/index.ts**

```typescript
export type { Database } from "./database";

// Re-export commonly used table types
export type { Json } from "./database";

// Type helpers for Supabase tables
import type { Database } from "./database";

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type Enums<T extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][T];

// Common entity types
export type Organization = Tables<"organizations">;
export type UserOrganizationRole = Tables<"user_organization_roles">;
export type Announcement = Tables<"announcements">;
export type Event = Tables<"events">;
export type Expense = Tables<"expenses">;

// Enum types
export type UserRole = Enums<"user_role">;
export type MembershipStatus = Enums<"membership_status">;
export type AlumniBucket = Enums<"alumni_bucket">;
export type SubscriptionInterval = Enums<"subscription_interval">;
```

**Step 5: Update apps/web imports**

Update all files in `apps/web/src/` that import from `@/types/database` to use `@teammeet/types`:

```typescript
// Before
import type { Database } from "@/types/database";

// After
import type { Database, Tables, Organization } from "@teammeet/types";
```

**Step 6: Verify and commit**

```bash
npm run build:web
git add -A
git commit -m "feat: extract @teammeet/types package from web app"
```

---

### Task 2.2: Create @teammeet/validation Package

**Files:**
- Create: `/Users/mleonard/sandbox/TeamMeet/packages/validation/package.json`
- Create: `/Users/mleonard/sandbox/TeamMeet/packages/validation/tsconfig.json`
- Create: `/Users/mleonard/sandbox/TeamMeet/packages/validation/src/index.ts`
- Create: `/Users/mleonard/sandbox/TeamMeet/packages/validation/src/schemas.ts`

**Step 1: Create packages/validation/package.json**

```json
{
  "name": "@teammeet/validation",
  "version": "1.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "zod": "^4.3.5"
  }
}
```

**Step 2: Create packages/validation/src/schemas.ts**

Extract from `apps/web/src/lib/security/validation.ts`:

```typescript
import { z } from "zod";

// Base schemas for common types
export const baseSchemas = {
  uuid: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9-]{3,64}$/),
  idempotencyKey: z.string().min(8).max(120),
  currency: z.string().regex(/^[a-z]{3}$/),
  email: z.string().email().max(320),
  hexColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
} as const;

// String validators with length constraints
export const safeString = (max: number, min = 1) =>
  z.string().trim().min(min).max(max);

export const optionalSafeString = (max: number) =>
  z.string().trim().max(max).optional();

// UUID array with deduplication
export const uuidArray = (max = 200) =>
  z
    .array(baseSchemas.uuid)
    .max(max)
    .transform((arr) => [...new Set(arr)]);

// Org name validation (from lib/validation/org-name.ts)
export const orgNameSchema = z.string().trim().min(1).max(100);

export function validateOrgName(name: unknown): { valid: boolean; error?: string } {
  const result = orgNameSchema.safeParse(name);
  if (!result.success) {
    return { valid: false, error: result.error.issues[0]?.message };
  }
  return { valid: true };
}
```

**Step 3: Create packages/validation/src/index.ts**

```typescript
export {
  baseSchemas,
  safeString,
  optionalSafeString,
  uuidArray,
  orgNameSchema,
  validateOrgName,
} from "./schemas";

// Re-export zod for consumers
export { z } from "zod";
```

**Step 4: Update apps/web imports**

Update `apps/web/src/lib/security/validation.ts` and other files to import from `@teammeet/validation`.

**Step 5: Commit**

```bash
npm install
npm run build:web
git add -A
git commit -m "feat: extract @teammeet/validation package"
```

---

### Task 2.3: Create @teammeet/core Package

**Files:**
- Create: `/Users/mleonard/sandbox/TeamMeet/packages/core/package.json`
- Create: `/Users/mleonard/sandbox/TeamMeet/packages/core/src/index.ts`
- Create: `/Users/mleonard/sandbox/TeamMeet/packages/core/src/auth/role-utils.ts`
- Create: `/Users/mleonard/sandbox/TeamMeet/packages/core/src/pricing/index.ts`
- Create: `/Users/mleonard/sandbox/TeamMeet/packages/core/src/navigation/index.ts`
- Create: `/Users/mleonard/sandbox/TeamMeet/packages/core/src/announcements/index.ts`

**Step 1: Create packages/core/package.json**

```json
{
  "name": "@teammeet/core",
  "version": "1.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./auth": "./src/auth/index.ts",
    "./pricing": "./src/pricing/index.ts",
    "./navigation": "./src/navigation/index.ts",
    "./announcements": "./src/announcements/index.ts"
  },
  "dependencies": {
    "@teammeet/types": "*"
  }
}
```

**Step 2: Extract role utilities**

Move pure functions from `apps/web/src/lib/auth/role-utils.ts` to `packages/core/src/auth/role-utils.ts`:

```typescript
import type { UserRole } from "@teammeet/types";

// Normalize legacy roles to current roles
export function normalizeRole(role: string | null | undefined): UserRole {
  if (!role) return "alumni";
  const normalized = role.toLowerCase();
  switch (normalized) {
    case "admin":
      return "admin";
    case "member":
    case "active_member":
      return "active_member";
    case "viewer":
    case "alumni":
    default:
      return "alumni";
  }
}

// Get boolean flags for role checks
export function roleFlags(role: UserRole) {
  return {
    isAdmin: role === "admin",
    isActiveMember: role === "active_member" || role === "admin",
    isAlumni: role === "alumni",
  };
}
```

**Step 3: Extract pricing logic**

Move from `apps/web/src/lib/pricing.ts` and `apps/web/src/lib/alumni-quota.ts`:

```typescript
// packages/core/src/pricing/index.ts
import type { AlumniBucket, SubscriptionInterval } from "@teammeet/types";

export const BASE_PRICES: Record<SubscriptionInterval, number> = {
  month: 15,
  year: 150,
};

export const ALUMNI_ADD_ON_PRICES: Record<AlumniBucket, Record<SubscriptionInterval, number>> = {
  "none": { month: 0, year: 0 },
  "0-250": { month: 0, year: 0 },
  "251-500": { month: 10, year: 100 },
  "501-1000": { month: 25, year: 250 },
  "1001-2500": { month: 50, year: 500 },
  "2500-5000": { month: 100, year: 1000 },
  "5000+": { month: 200, year: 2000 },
};

export const ALUMNI_BUCKET_LABELS: Record<AlumniBucket, string> = {
  "none": "No alumni",
  "0-250": "Up to 250 alumni",
  "251-500": "251-500 alumni",
  "501-1000": "501-1,000 alumni",
  "1001-2500": "1,001-2,500 alumni",
  "2500-5000": "2,500-5,000 alumni",
  "5000+": "5,000+ alumni",
};

export function getTotalPrice(
  interval: SubscriptionInterval,
  alumniBucket: AlumniBucket
): number {
  return BASE_PRICES[interval] + ALUMNI_ADD_ON_PRICES[alumniBucket][interval];
}

export function formatPrice(cents: number): string {
  return `$${(cents).toFixed(0)}`;
}

export const ALUMNI_LIMITS: Record<AlumniBucket, number> = {
  "none": 0,
  "0-250": 250,
  "251-500": 500,
  "501-1000": 1000,
  "1001-2500": 2500,
  "2500-5000": 5000,
  "5000+": Infinity,
};

export function getAlumniLimit(bucket: AlumniBucket): number {
  return ALUMNI_LIMITS[bucket];
}
```

**Step 4: Extract navigation config**

Move pure data structures from `apps/web/src/lib/navigation/`:

```typescript
// packages/core/src/navigation/index.ts
import type { UserRole } from "@teammeet/types";

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: string; // Icon name, not component
  allowedRoles: UserRole[];
}

export const ORG_NAV_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "", icon: "LayoutDashboard", allowedRoles: ["admin", "active_member", "alumni"] },
  { key: "members", label: "Members", href: "/members", icon: "Users", allowedRoles: ["admin", "active_member", "alumni"] },
  { key: "alumni", label: "Alumni", href: "/alumni", icon: "GraduationCap", allowedRoles: ["admin", "active_member", "alumni"] },
  { key: "announcements", label: "Announcements", href: "/announcements", icon: "Megaphone", allowedRoles: ["admin", "active_member", "alumni"] },
  // ... other items
];

export function canAccessNavItem(item: NavItem, userRole: UserRole): boolean {
  return item.allowedRoles.includes(userRole);
}

export function getNavItemsForRole(role: UserRole): NavItem[] {
  return ORG_NAV_ITEMS.filter((item) => canAccessNavItem(item, role));
}
```

**Step 5: Extract announcement filtering**

Move from `apps/web/src/lib/announcements.ts`:

```typescript
// packages/core/src/announcements/index.ts
import type { Announcement, UserRole } from "@teammeet/types";

export type AudienceType = "all" | "members" | "active_members" | "alumni" | "individuals";

export function filterAnnouncementsForUser(
  announcements: Announcement[],
  userId: string,
  userRole: UserRole
): Announcement[] {
  return announcements.filter((announcement) => {
    const audience = announcement.audience as AudienceType;

    switch (audience) {
      case "all":
        return true;
      case "members":
      case "active_members":
        return userRole === "admin" || userRole === "active_member";
      case "alumni":
        return userRole === "alumni";
      case "individuals":
        const targets = announcement.target_user_ids as string[] | null;
        return targets?.includes(userId) ?? false;
      default:
        return true;
    }
  });
}
```

**Step 6: Create main index.ts**

```typescript
// packages/core/src/index.ts
export * from "./auth/role-utils";
export * from "./pricing";
export * from "./navigation";
export * from "./announcements";
```

**Step 7: Update apps/web imports and commit**

```bash
npm install
npm run build:web
git add -A
git commit -m "feat: extract @teammeet/core package with shared business logic"
```

---

## Phase 3: Mobile App Foundation

### Task 3.1: Initialize Expo App

**Files:**
- Create: `/Users/mleonard/sandbox/TeamMeet/apps/mobile/package.json`
- Create: `/Users/mleonard/sandbox/TeamMeet/apps/mobile/app.json`
- Create: `/Users/mleonard/sandbox/TeamMeet/apps/mobile/tsconfig.json`
- Create: `/Users/mleonard/sandbox/TeamMeet/apps/mobile/app/_layout.tsx`

**Step 1: Create apps/mobile/package.json**

```json
{
  "name": "@teammeet/mobile",
  "version": "1.0.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start",
    "ios": "expo run:ios",
    "android": "expo run:android",
    "prebuild": "expo prebuild"
  },
  "dependencies": {
    "@react-native-async-storage/async-storage": "^1.23.1",
    "@supabase/supabase-js": "^2.86.2",
    "expo": "~52.0.0",
    "expo-auth-session": "~6.0.0",
    "expo-linking": "~7.0.0",
    "expo-router": "~4.0.0",
    "expo-secure-store": "~14.0.0",
    "expo-status-bar": "~2.0.0",
    "expo-web-browser": "~14.0.0",
    "react": "18.3.1",
    "react-native": "0.76.6",
    "react-native-safe-area-context": "^4.14.0",
    "react-native-screens": "~4.4.0",
    "@teammeet/core": "*",
    "@teammeet/types": "*",
    "@teammeet/validation": "*"
  },
  "devDependencies": {
    "@babel/core": "^7.24.0",
    "@types/react": "~18.3.0",
    "typescript": "~5.3.3"
  }
}
```

**Step 2: Create apps/mobile/app.json**

```json
{
  "expo": {
    "name": "TeamMeet",
    "slug": "teammeet",
    "version": "1.0.0",
    "orientation": "portrait",
    "scheme": "teammeet",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "automatic",
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#ffffff"
    },
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.myteamnetwork.teammeet"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#ffffff"
      },
      "package": "com.myteamnetwork.teammeet"
    },
    "plugins": [
      "expo-router",
      "expo-secure-store"
    ]
  }
}
```

**Step 3: Create Supabase client for React Native**

```typescript
// apps/mobile/src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Database } from "@teammeet/types";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
```

**Step 4: Create root layout with auth provider**

```typescript
// apps/mobile/app/_layout.tsx
import { Slot, useRouter, useSegments } from "expo-router";
import { useEffect, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "../src/lib/supabase";
import { View, ActivityIndicator } from "react-native";

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === "(auth)";

    if (!session && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (session && inAuthGroup) {
      router.replace("/(app)");
    }
  }, [session, loading, segments]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return <Slot />;
}
```

**Step 5: Install dependencies and test**

```bash
cd /Users/mleonard/sandbox/TeamMeet
npm install
cd apps/mobile
npx expo start
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: initialize Expo mobile app with Supabase auth"
```

---

### Task 3.2: Implement Authentication Screens

**Files:**
- Create: `/Users/mleonard/sandbox/TeamMeet/apps/mobile/app/(auth)/_layout.tsx`
- Create: `/Users/mleonard/sandbox/TeamMeet/apps/mobile/app/(auth)/login.tsx`
- Create: `/Users/mleonard/sandbox/TeamMeet/apps/mobile/src/lib/auth.ts`

**Step 1: Create auth layout**

```typescript
// apps/mobile/app/(auth)/_layout.tsx
import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
    </Stack>
  );
}
```

**Step 2: Create login screen with OAuth**

```typescript
// apps/mobile/app/(auth)/login.tsx
import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { makeRedirectUri } from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "../../src/lib/supabase";

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);

  const signInWithGoogle = async () => {
    setLoading(true);
    try {
      const redirectUri = makeRedirectUri({ scheme: "teammeet" });

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectUri,
          skipBrowserRedirect: true,
        },
      });

      if (error) throw error;
      if (data.url) {
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);

        if (result.type === "success") {
          const params = new URL(result.url).searchParams;
          const accessToken = params.get("access_token");
          const refreshToken = params.get("refresh_token");

          if (accessToken && refreshToken) {
            await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          }
        }
      }
    } catch (error) {
      Alert.alert("Error", (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>TeamMeet</Text>
      <Text style={styles.subtitle}>Sign in to continue</Text>

      <TouchableOpacity
        style={styles.button}
        onPress={signInWithGoogle}
        disabled={loading}
      >
        <Text style={styles.buttonText}>
          {loading ? "Signing in..." : "Sign in with Google"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  title: { fontSize: 32, fontWeight: "bold", marginBottom: 8 },
  subtitle: { fontSize: 16, color: "#666", marginBottom: 32 },
  button: { backgroundColor: "#4285F4", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  buttonText: { color: "white", fontSize: 16, fontWeight: "600" },
});
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add mobile auth screens with Google OAuth"
```

---

## Phase 4: MVP Features

### Task 4.1: Organization Selection Screen

**Files:**
- Create: `/Users/mleonard/sandbox/TeamMeet/apps/mobile/app/(app)/_layout.tsx`
- Create: `/Users/mleonard/sandbox/TeamMeet/apps/mobile/app/(app)/index.tsx`
- Create: `/Users/mleonard/sandbox/TeamMeet/apps/mobile/src/hooks/useOrganizations.ts`

**Schema notes (verified in Supabase SQL):**
- `user_organization_roles` has no `deleted_at` column; filter by `status` only.

**Step 1: Create app layout with org context**

```typescript
// apps/mobile/app/(app)/_layout.tsx
import { Stack } from "expo-router";

export default function AppLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "My Organizations" }} />
      <Stack.Screen name="[orgSlug]" options={{ headerShown: false }} />
    </Stack>
  );
}
```

**Step 2: Create organizations hook**

```typescript
// apps/mobile/src/hooks/useOrganizations.ts
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Organization } from "@teammeet/types";

export function useOrganizations() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchOrganizations() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        const { data, error } = await supabase
          .from("user_organization_roles")
          .select("organization:organizations(*)")
          .eq("user_id", user.id)
          .eq("status", "active");

        if (error) throw error;

        const orgs = data
          .map((row) => row.organization)
          .filter((org): org is Organization => org !== null);

        setOrganizations(orgs);
      } catch (e) {
        setError(e as Error);
      } finally {
        setLoading(false);
      }
    }

    fetchOrganizations();
  }, []);

  return { organizations, loading, error };
}
```

**Step 3: Create org selection screen**

```typescript
// apps/mobile/app/(app)/index.tsx
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useOrganizations } from "../../src/hooks/useOrganizations";
import type { Organization } from "@teammeet/types";

export default function OrganizationsScreen() {
  const { organizations, loading, error } = useOrganizations();
  const router = useRouter();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error.message}</Text>
      </View>
    );
  }

  const renderOrg = ({ item }: { item: Organization }) => (
    <TouchableOpacity
      style={styles.orgCard}
      onPress={() => router.push(`/(app)/${item.slug}`)}
    >
      <Text style={styles.orgName}>{item.name}</Text>
      <Text style={styles.orgSlug}>@{item.slug}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={organizations}
        keyExtractor={(item) => item.id}
        renderItem={renderOrg}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text>No organizations found</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  error: { color: "red" },
  orgCard: { backgroundColor: "white", padding: 16, marginHorizontal: 16, marginVertical: 8, borderRadius: 12 },
  orgName: { fontSize: 18, fontWeight: "600" },
  orgSlug: { fontSize: 14, color: "#666", marginTop: 4 },
});
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add organization selection screen"
```

---

### Task 4.2: Members Directory Screen

**Files:**
- Create: `/Users/mleonard/sandbox/TeamMeet/apps/mobile/app/(app)/[orgSlug]/_layout.tsx`
- Create: `/Users/mleonard/sandbox/TeamMeet/apps/mobile/app/(app)/[orgSlug]/(tabs)/members.tsx`
- Create: `/Users/mleonard/sandbox/TeamMeet/apps/mobile/src/hooks/useMembers.ts`

**Schema notes (verified in Supabase SQL):**
- `profiles` table does not exist; join `user_organization_roles` → `users`.
- `users` has `name`, `email`, `avatar_url`.

**Step 1: Create org-scoped layout with tabs**

```typescript
// apps/mobile/app/(app)/[orgSlug]/_layout.tsx
import { Tabs } from "expo-router";
import { useLocalSearchParams } from "expo-router";

export default function OrgLayout() {
  const { orgSlug } = useLocalSearchParams<{ orgSlug: string }>();

  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen name="(tabs)/index" options={{ title: "Dashboard", tabBarLabel: "Home" }} />
      <Tabs.Screen name="(tabs)/members" options={{ title: "Members", tabBarLabel: "Members" }} />
      <Tabs.Screen name="(tabs)/alumni" options={{ title: "Alumni", tabBarLabel: "Alumni" }} />
      <Tabs.Screen name="(tabs)/announcements" options={{ title: "Announcements", tabBarLabel: "News" }} />
    </Tabs>
  );
}
```

**Step 2: Create members hook**

```typescript
// apps/mobile/src/hooks/useMembers.ts
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

interface Member {
  id: string;
  user_id: string;
  role: string;
  status: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    avatar_url: string | null;
  } | null;
}

export function useMembers(orgSlug: string) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchMembers() {
      try {
        // First get org ID from slug
        const { data: org, error: orgError } = await supabase
          .from("organizations")
          .select("id")
          .eq("slug", orgSlug)
          .single();

        if (orgError) throw orgError;

        // Then get members with users
        const { data, error } = await supabase
          .from("user_organization_roles")
          .select(`
            id,
            user_id,
            role,
            status,
            user:users(id, email, name, avatar_url)
          `)
          .eq("organization_id", org.id)
          .eq("status", "active")
          .in("role", ["admin", "active_member", "member"])
          .order("role", { ascending: true });

        if (error) throw error;
        setMembers(data as Member[]);
      } catch (e) {
        setError(e as Error);
      } finally {
        setLoading(false);
      }
    }

    fetchMembers();
  }, [orgSlug]);

  return { members, loading, error };
}
```

**Step 3: Create members screen**

```typescript
// apps/mobile/app/(app)/[orgSlug]/(tabs)/members.tsx
import { View, Text, FlatList, StyleSheet, ActivityIndicator, Image } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useMembers } from "../../../../src/hooks/useMembers";
import { normalizeRole, roleFlags } from "@teammeet/core";

export default function MembersScreen() {
  const { orgSlug } = useLocalSearchParams<{ orgSlug: string }>();
  const { members, loading, error } = useMembers(orgSlug);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" /></View>;
  }

  if (error) {
    return <View style={styles.center}><Text style={styles.error}>{error.message}</Text></View>;
  }

  return (
    <FlatList
      data={members}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => {
        const role = normalizeRole(item.role);
        const { isAdmin } = roleFlags(role);

        return (
          <View style={styles.memberCard}>
            {item.user?.avatar_url ? (
              <Image source={{ uri: item.user.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Text style={styles.avatarText}>
                  {item.user?.name?.[0] || item.user?.email?.[0] || "?"}
                </Text>
              </View>
            )}
            <View style={styles.memberInfo}>
              <Text style={styles.memberName}>
                {item.user?.name || item.user?.email || "Unknown"}
              </Text>
              <Text style={styles.memberRole}>
                {isAdmin ? "Admin" : "Member"}
              </Text>
            </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  error: { color: "red" },
  list: { padding: 16 },
  memberCard: { flexDirection: "row", alignItems: "center", backgroundColor: "white", padding: 12, borderRadius: 12, marginBottom: 8 },
  avatar: { width: 48, height: 48, borderRadius: 24, marginRight: 12 },
  avatarPlaceholder: { backgroundColor: "#e0e0e0", justifyContent: "center", alignItems: "center" },
  avatarText: { fontSize: 18, fontWeight: "600", color: "#666" },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 16, fontWeight: "600" },
  memberRole: { fontSize: 14, color: "#666", marginTop: 2 },
});
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add members directory with users"
```

---

### Task 4.3: Announcements Feed Screen

**Files:**
- Create: `/Users/mleonard/sandbox/TeamMeet/apps/mobile/app/(app)/[orgSlug]/(tabs)/announcements.tsx`
- Create: `/Users/mleonard/sandbox/TeamMeet/apps/mobile/src/hooks/useAnnouncements.ts`

**Step 1: Create announcements hook**

```typescript
// apps/mobile/src/hooks/useAnnouncements.ts
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { filterAnnouncementsForUser, normalizeRole } from "@teammeet/core";
import type { Announcement } from "@teammeet/types";

export function useAnnouncements(orgSlug: string) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchAnnouncements() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        // Get org and user's role
        const { data: org } = await supabase
          .from("organizations")
          .select("id")
          .eq("slug", orgSlug)
          .single();

        if (!org) throw new Error("Organization not found");

        const { data: roleData } = await supabase
          .from("user_organization_roles")
          .select("role")
          .eq("organization_id", org.id)
          .eq("user_id", user.id)
          .eq("status", "active")
          .single();

        const userRole = normalizeRole(roleData?.role);

        // Fetch announcements
        const { data, error } = await supabase
          .from("announcements")
          .select("*")
          .eq("organization_id", org.id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false });

        if (error) throw error;

        // Filter based on audience targeting
        const filtered = filterAnnouncementsForUser(data || [], user.id, userRole);
        setAnnouncements(filtered);
      } catch (e) {
        setError(e as Error);
      } finally {
        setLoading(false);
      }
    }

    fetchAnnouncements();
  }, [orgSlug]);

  return { announcements, loading, error };
}
```

**Step 2: Create announcements screen**

```typescript
// apps/mobile/app/(app)/[orgSlug]/(tabs)/announcements.tsx
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useAnnouncements } from "../../../../src/hooks/useAnnouncements";
import type { Announcement } from "@teammeet/types";

export default function AnnouncementsScreen() {
  const { orgSlug } = useLocalSearchParams<{ orgSlug: string }>();
  const { announcements, loading, error } = useAnnouncements(orgSlug);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" /></View>;
  }

  if (error) {
    return <View style={styles.center}><Text style={styles.error}>{error.message}</Text></View>;
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const renderAnnouncement = ({ item }: { item: Announcement }) => (
    <View style={styles.card}>
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.date}>{formatDate(item.created_at)}</Text>
      <Text style={styles.body} numberOfLines={4}>{item.body}</Text>
    </View>
  );

  return (
    <FlatList
      data={announcements}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      renderItem={renderAnnouncement}
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.empty}>No announcements yet</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  error: { color: "red" },
  empty: { color: "#666" },
  list: { padding: 16 },
  card: { backgroundColor: "white", padding: 16, borderRadius: 12, marginBottom: 12 },
  title: { fontSize: 18, fontWeight: "600", marginBottom: 4 },
  date: { fontSize: 12, color: "#999", marginBottom: 8 },
  body: { fontSize: 14, color: "#333", lineHeight: 20 },
});
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add announcements feed with audience filtering"
```

---

## Phase 5: Documentation Updates

### Task 5.1: Update CLAUDE.md

**Files:**
- Modify: `/Users/mleonard/sandbox/TeamMeet/CLAUDE.md`

**Add the following sections:**

```markdown
## Monorepo Structure

This is an npm workspaces monorepo with the following structure:

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
│   ├── core/                   # Shared business logic
│   ├── types/                  # TypeScript types (database.ts)
│   └── validation/             # Zod schemas
├── supabase/                   # Database migrations
├── docs/                       # Documentation
└── package.json                # Root workspace config
```

### Commands

#### Development
```bash
npm run dev           # Start web dev server (localhost:3000)
npm run dev:web       # Same as above
npm run dev:mobile    # Start Expo dev server

# From apps/mobile/
npx expo start        # Start Expo dev server
npx expo run:ios      # Build and run on iOS simulator
npx expo run:android  # Build and run on Android emulator
```

#### Building
```bash
npm run build         # Build web app
npm run build:web     # Same as above

# Mobile builds use EAS Build (see Expo docs)
cd apps/mobile && eas build --platform ios
cd apps/mobile && eas build --platform android
```

### Shared Packages

Import shared code using package names:

```typescript
// In apps/web or apps/mobile
import { normalizeRole, roleFlags } from "@teammeet/core";
import type { Organization, UserRole } from "@teammeet/types";
import { baseSchemas, validateOrgName } from "@teammeet/validation";
```

### Mobile App Architecture

- **Framework**: Expo SDK 52 with Expo Router
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

### Environment Variables

#### Web (apps/web/.env.local)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- (all existing vars)

#### Mobile (apps/mobile/.env.local)
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
```

**Step 1: Commit documentation update**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with monorepo structure and mobile app info"
```

---

## Verification Checklist

After completing all phases, verify:

1. **Monorepo works**: `npm install` from root installs all dependencies
2. **Web still works**: `npm run dev:web` starts Next.js at localhost:3000
3. **Mobile starts**: `npm run dev:mobile` starts Expo dev server
4. **Shared packages import**: Both apps can import from @teammeet/core, @teammeet/types, @teammeet/validation
5. **Auth works on mobile**: Can sign in with Google OAuth
6. **Org selection works**: After login, see list of user's organizations
7. **Members screen works**: Tapping an org shows members list
8. **Announcements work**: News tab shows filtered announcements
9. **Types are shared**: Changes to packages/types/ reflect in both apps
10. **Build passes**: `npm run build:web` completes without errors

---

## Rollback Plan

If issues arise:

1. **Git reset**: `git reset --hard HEAD~N` to undo commits
2. **Keep backup**: Before starting, create branch `git checkout -b pre-monorepo-backup`
3. **Incremental commits**: Each task has a commit, can revert individually
4. **Package isolation**: If shared package breaks web, temporarily inline the code back

---

## Future Enhancements (Post-MVP)

- Push notifications with Expo Notifications
- Events calendar with RSVP
- Offline support with Supabase realtime
- Dark mode toggle
- Alumni directory tab
- Profile editing
- Stripe subscription management in-app
