# TeamMeet Monorepo Migration Progress

**Last Updated:** Phase 2.3 completed. Next: Phase 3.1 (Expo mobile app init)

## Quick Status

| Phase | Task | Status | Commit |
|-------|------|--------|--------|
| Phase 1 | Monorepo Setup | DONE | `a4ccedf` |
| Phase 2.1 | @teammeet/types | DONE | `0927533` |
| Phase 2.2 | @teammeet/validation | DONE | `06b3c1c` |
| Phase 2.3 | @teammeet/core | DONE | `b167c74` |
| Phase 3.1 | Expo App Init | **NEXT** | - |
| Phase 3.2 | Mobile Auth Screens | Pending | - |
| Phase 4.1 | Org Selection Screen | Pending | - |
| Phase 4.2 | Members Directory | Pending | - |
| Phase 4.3 | Announcements Feed | Pending | - |
| Phase 5.1 | Update CLAUDE.md | Pending | - |

## Full Plan Reference

`.claude/plans/abundant-fluttering-codd.md`

---

## NEXT TASK: Phase 3.1 - Initialize Expo Mobile App

### What to do

1. Create `apps/mobile/package.json` with Expo dependencies:
   - expo, expo-router, expo-auth-session, expo-web-browser
   - @react-native-async-storage/async-storage
   - @supabase/supabase-js
   - @teammeet/core, @teammeet/types, @teammeet/validation

2. Create `apps/mobile/app.json` with Expo config:
   - scheme: "teammeet" (for deep linking)
   - bundleIdentifier: "com.myteamnetwork.teammeet"

3. Create `apps/mobile/tsconfig.json`

4. Create Supabase client with AsyncStorage:
   - File: `apps/mobile/src/lib/supabase.ts`
   - Uses AsyncStorage instead of cookies

5. Create root layout with auth redirect:
   - File: `apps/mobile/app/_layout.tsx`
   - Redirects to login if not authenticated

### Key Difference from Web

- Web uses `@supabase/ssr` with cookies
- Mobile uses `@supabase/supabase-js` with AsyncStorage
- RLS policies work unchanged (JWT-based)

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
│   └── mobile/                 # Expo (to build in Phase 3)
│       └── .env.local          # Has EXPO_PUBLIC_SUPABASE_* vars
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
