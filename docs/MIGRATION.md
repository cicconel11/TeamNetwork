# TeamMeet Monorepo Migration Progress

**Last Updated:** All phases complete. Mobile app MVP is functional with announcements feed.

## Quick Status

| Phase | Task | Status | Commit |
|-------|------|--------|--------|
| Phase 1 | Monorepo Setup | DONE | `a4ccedf` |
| Phase 2.1 | @teammeet/types | DONE | `0927533` |
| Phase 2.2 | @teammeet/validation | DONE | `06b3c1c` |
| Phase 2.3 | @teammeet/core | DONE | `b167c74` |
| Phase 3.1 | Expo App Init | DONE | - |
| Phase 3.2 | Mobile Auth Screens | DONE | - |
| Phase 4.1 | Org Selection Screen | DONE | - |
| Phase 4.2 | Members Directory + Tabs | DONE | - |
| Phase 4.3 | Announcements Feed | DONE | - |
| Phase 5.1 | Update CLAUDE.md | DONE | - |

## Full Plan Reference

`abundant-fluttering-codd.md` (root directory)

---

## Completed Work

### Phase 1: Monorepo Setup

**Commit:** `a4ccedf`

- Root `package.json` has workspaces: `["apps/*", "packages/*"]`
- Web app moved to `apps/web/`
- Scripts: `npm run dev`, `npm run build`

### Phase 2.1: @teammeet/types

**Commit:** `0927533`

**Package:** `packages/types/`
```
├── package.json
└── src/
    ├── database.ts    # Supabase generated types
    └── index.ts       # export * from "./database"
```

**Exports:** Database, Tables, Organization, UserRole, AnnouncementAudience, etc.

### Phase 2.2: @teammeet/validation

**Commit:** `06b3c1c`

**Package:** `packages/validation/`
```
├── package.json       # Has zod dependency
└── src/
    ├── schemas.ts     # Zod schemas
    └── index.ts       # Exports + re-exports z from zod
```

**Exports:** baseSchemas, safeString, optionalSafeString, uuidArray, validateOrgName, z

### Phase 2.3: @teammeet/core

**Commit:** `b167c74`

**Package:** `packages/core/`
```
├── package.json       # Depends on @teammeet/types
└── src/
    ├── index.ts       # Main exports
    ├── auth/
    │   ├── index.ts
    │   └── role-utils.ts
    ├── pricing/
    │   └── index.ts
    └── announcements/
        └── index.ts
```

**Exports:**
- Auth: `normalizeRole`, `roleFlags`, `OrgRole`
- Pricing: `BASE_PRICES`, `ALUMNI_ADD_ON_PRICES`, `ALUMNI_BUCKET_LABELS`, `ALUMNI_LIMITS`, `getTotalPrice`, `formatPrice`, `getAlumniLimit`, `normalizeBucket`
- Announcements: `filterAnnouncementsForUser`, `ViewerContext`

### Phase 3.1: Expo Mobile App Initialization

**Package:** `apps/mobile/`
```
├── package.json         # Expo dependencies + shared packages
├── app.json            # Expo config with deep linking
├── tsconfig.json       # TypeScript config with path aliases
├── .env.local          # Supabase env vars
├── src/
│   ├── lib/
│   │   └── supabase.ts # Supabase client with AsyncStorage
│   └── hooks/
│       ├── useAuth.ts
│       ├── useMembers.ts
│       └── useOrganizations.ts
└── app/
    ├── _layout.tsx     # Root layout with auth redirect
    ├── (auth)/
    │   ├── _layout.tsx
    │   ├── login.tsx
    │   └── signup.tsx
    └── (app)/
        ├── _layout.tsx
        ├── index.tsx    # Org selection
        └── [orgSlug]/
            ├── _layout.tsx   # Tab navigator
            └── (tabs)/
                ├── index.tsx        # Dashboard
                ├── members.tsx      # Members directory
                ├── alumni.tsx       # Alumni placeholder
                └── announcements.tsx # Announcements placeholder
```

### Phase 3.2: Mobile Auth Screens

**Files Created:**
- `apps/mobile/app/(auth)/_layout.tsx` - Stack layout, no header
- `apps/mobile/app/(auth)/login.tsx` - Google OAuth login with Supabase
- `apps/mobile/app/(auth)/signup.tsx` - Email/password signup with email confirmation
- `apps/mobile/src/hooks/useAuth.ts` - Auth state hook with unmount guard

**Features:**
- Google OAuth authentication (signInWithOAuth)
- Email/password signup (signUp)
- Loading states with ActivityIndicator
- Error handling with Alerts

### Phase 4.1: Organization Selection Screen

**Files Created:**
- `apps/mobile/app/(app)/_layout.tsx` - Stack with org routes
- `apps/mobile/app/(app)/index.tsx` - FlatList of user's organizations

**Features:**
- Fetches organizations from `user_organization_roles` (status=active, no deleted_at column)
- Pull-to-refresh
- Sign out button
- Empty state for no organizations
- Navigates to org detail on tap

### Phase 4.2: Members Directory + Tabs

**Files Created:**
- `apps/mobile/app/(app)/[orgSlug]/_layout.tsx` - Tab navigator with 4 tabs
- `apps/mobile/app/(app)/[orgSlug]/(tabs)/index.tsx` - Dashboard placeholder
- `apps/mobile/app/(app)/[orgSlug]/(tabs)/members.tsx` - Members list
- `apps/mobile/app/(app)/[orgSlug]/(tabs)/alumni.tsx` - Alumni placeholder
- `apps/mobile/app/(app)/[orgSlug]/(tabs)/announcements.tsx` - Announcements placeholder
- `apps/mobile/src/hooks/useMembers.ts` - Members fetch hook

**Features:**
- Tab navigation: Home, Members, Alumni, News
- Members list with avatars (or initials fallback)
- Role badges (Admin/Member) using `@teammeet/core` normalizeRole
- Announcements placeholder (Phase 4.3)
- Pull-to-refresh on list screens
- Unmount guards (isMountedRef) on all async hooks

**Schema Notes:**
- `user_organization_roles` has **NO `deleted_at` column** - filter by `status` only
- `users` table has `name` (not `first_name`/`last_name`), `email`, `avatar_url`
- Join `user_organization_roles` → `users` (not `profiles`)

---

## Directory Structure

```
TeamMeet/
├── apps/
│   ├── web/                    # Next.js 14 (complete)
│   │   ├── src/
│   │   ├── tests/
│   │   ├── .env.local
│   │   └── package.json
│   └── mobile/                 # Expo (MVP complete)
│       ├── package.json        # Expo + shared package deps
│       ├── app.json            # Expo config
│       ├── tsconfig.json       # TypeScript config
│       ├── .env.local          # EXPO_PUBLIC_SUPABASE_* vars
│       ├── src/
│       │   ├── lib/
│       │   │   └── supabase.ts # Mobile Supabase client
│       │   └── hooks/
│       │       ├── useAnnouncements.ts
│       │       ├── useAuth.ts
│       │       └── useMembers.ts
│       └── app/
│           ├── _layout.tsx     # Root layout
│           ├── (auth)/         # Login, Signup
│           └── (app)/          # Protected screens
│               ├── index.tsx   # Org selection
│               └── [orgSlug]/  # Org-scoped tabs
├── packages/
│   ├── types/                  # @teammeet/types ✓
│   ├── validation/             # @teammeet/validation ✓
│   └── core/                   # @teammeet/core ✓
├── supabase/
├── docs/
│   └── MIGRATION.md
└── package.json
```

---

## Commands

```bash
npm install           # Install all workspace deps
npm run dev           # Start web dev server
npm run build         # Build web app
npm run dev:mobile    # Start Expo dev server
```

---

## Import Patterns

```typescript
// Types
import type { Database, Organization, UserRole, MembershipStatus } from "@teammeet/types";

// Validation
import { baseSchemas, safeString, validateOrgName, z } from "@teammeet/validation";

// Core business logic
import { normalizeRole, roleFlags, filterAnnouncementsForUser, ViewerContext } from "@teammeet/core";
```

---

## Future Enhancements (Post-MVP)

- Push notifications with Expo Notifications
- Events calendar with RSVP
- Offline support with Supabase realtime
- Dark mode toggle
- Alumni directory (currently placeholder)
- Profile editing
- Stripe subscription management in-app
- OAuth providers (Google, Apple)

---

## Rollback

```bash
git checkout pre-monorepo-backup  # Full rollback
git revert <commit>               # Revert specific commit
```
