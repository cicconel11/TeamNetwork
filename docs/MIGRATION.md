# TeamMeet Monorepo Migration Progress

**Last Updated:** Phase 3.1 completed. Next: Phase 3.2 (Mobile auth screens)

## Quick Status

| Phase | Task | Status | Commit |
|-------|------|--------|--------|
| Phase 1 | Monorepo Setup | DONE | `a4ccedf` |
| Phase 2.1 | @teammeet/types | DONE | `0927533` |
| Phase 2.2 | @teammeet/validation | DONE | `06b3c1c` |
| Phase 2.3 | @teammeet/core | DONE | `b167c74` |
| Phase 3.1 | Expo App Init | DONE | - |
| Phase 3.2 | Mobile Auth Screens | **NEXT** | - |
| Phase 4.1 | Org Selection Screen | Pending | - |
| Phase 4.2 | Members Directory | Pending | - |
| Phase 4.3 | Announcements Feed | Pending | - |
| Phase 5.1 | Update CLAUDE.md | Pending | - |

## Full Plan Reference

`.claude/plans/abundant-fluttering-codd.md`

---

## NEXT TASK: Phase 3.2 - Mobile Auth Screens

### What to do

1. Create auth layout at `apps/mobile/app/(auth)/_layout.tsx`
   - Simple stack layout without header
   - No back button on first screen

2. Create login screen at `apps/mobile/app/(auth)/login.tsx`
   - Email/password input
   - Sign up link
   - Calls `supabase.auth.signInWithPassword()`

3. Create sign up screen at `apps/mobile/app/(auth)/signup.tsx`
   - Email/password input
   - Login link
   - Calls `supabase.auth.signUp()`

4. Create app layout at `apps/mobile/app/(app)/_layout.tsx`
   - Tab-based navigation (placeholder for Phase 4+)
   - Protected route (user must be authenticated)

5. Create loading indicator during auth state check
   - Show splash screen or loading spinner
   - File: `apps/mobile/src/components/LoadingScreen.tsx`

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
│   └── components/     # (for future screens)
└── app/
    ├── _layout.tsx     # Root layout with auth redirect
    ├── (auth)/         # Auth screens group (Phase 3.2)
    └── (app)/          # Protected app screens group (Phase 4+)
```

**Key Files:**
- `apps/mobile/src/lib/supabase.ts` - Supabase client configured for mobile
- `apps/mobile/app/_layout.tsx` - Root navigation with auth check
- Uses AsyncStorage for session persistence (mobile requirement)
- Integrates with `@supabase/supabase-js` (not SSR)
- Ready for Phase 3.2 (login/signup screens)

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
│   └── mobile/                 # Expo (Phases 3+)
│       ├── package.json        # Expo + shared package deps
│       ├── app.json            # Expo config
│       ├── tsconfig.json       # TypeScript config
│       ├── .env.local          # EXPO_PUBLIC_SUPABASE_* vars
│       ├── src/
│       │   └── lib/
│       │       └── supabase.ts # Mobile Supabase client
│       └── app/
│           └── _layout.tsx     # Root layout
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

# After Phase 3:
npm run dev:mobile    # Start Expo dev server
```

---

## Import Patterns

```typescript
// Types
import type { Database, Organization, UserRole } from "@teammeet/types";

// Validation
import { baseSchemas, safeString, validateOrgName, z } from "@teammeet/validation";

// Core business logic
import { normalizeRole, roleFlags, BASE_PRICES, filterAnnouncementsForUser } from "@teammeet/core";
```

---

## Rollback

```bash
git checkout pre-monorepo-backup  # Full rollback
git revert <commit>               # Revert specific commit
```
