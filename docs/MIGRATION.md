# TeamMeet Monorepo Migration Progress

This document tracks the migration from a single Next.js app to an npm workspaces monorepo with React Native mobile support. It's designed to allow anyone to pick up where we left off.

## Full Migration Plan

See `.claude/plans/abundant-fluttering-codd.md` for the complete implementation plan with code examples.

---

## Current Status Summary

| Phase | Task | Status | Commit |
|-------|------|--------|--------|
| Phase 1 | Monorepo Setup | DONE | `a4ccedf` |
| Phase 2.1 | @teammeet/types | DONE | `0927533` |
| Phase 2.2 | @teammeet/validation | DONE | `06b3c1c` |
| Phase 2.3 | @teammeet/core | **NEXT** | - |
| Phase 3.1 | Expo App Init | Pending | - |
| Phase 3.2 | Mobile Auth Screens | Pending | - |
| Phase 4.1 | Org Selection Screen | Pending | - |
| Phase 4.2 | Members Directory | Pending | - |
| Phase 4.3 | Announcements Feed | Pending | - |
| Phase 5.1 | Update CLAUDE.md | Pending | - |

---

## Completed Tasks

### Phase 1: Monorepo Setup (DONE)

**What was done:**
1. Created npm workspaces configuration in root `package.json`
2. Moved web app from root to `apps/web/`
3. Created `packages/` directory structure
4. Updated all build/dev scripts to use workspace commands

**Key files changed:**
- `package.json` - Added workspaces config
- `apps/web/package.json` - Web app dependencies
- `apps/web/tsconfig.json` - Path aliases for shared packages

**Verification:** `npm run build` passes

---

### Phase 2.1: @teammeet/types Package (DONE)

**What was done:**
1. Moved `database.ts` from `apps/web/src/types/` to `packages/types/src/`
2. Created `index.ts` that re-exports all types
3. Updated 73 files to import from `@teammeet/types` instead of `@/types/database`

**Package structure:**
```
packages/types/
├── package.json
└── src/
    ├── database.ts    # Supabase generated types (2500+ lines)
    └── index.ts       # Re-exports: export * from "./database"
```

**Key exports:**
- `Database` - Full Supabase schema type
- `Tables<T>`, `TablesInsert<T>`, `TablesUpdate<T>` - Table type helpers
- `Organization`, `UserOrganizationRole`, `Announcement`, etc. - Entity types
- `UserRole`, `MembershipStatus`, `AnnouncementAudience`, etc. - Enum types

**Verification:** `npm run build` passes

---

### Phase 2.2: @teammeet/validation Package (DONE)

**What was done:**
1. Created `packages/validation/src/schemas.ts` with portable Zod schemas
2. Kept Next.js-specific parts (`validateJson`, `ValidationError`) in web app
3. Web app now re-exports from `@teammeet/validation`

**Package structure:**
```
packages/validation/
├── package.json       # Has zod as dependency
└── src/
    ├── schemas.ts     # Zod schemas: baseSchemas, safeString, etc.
    └── index.ts       # Re-exports + re-exports zod
```

**Key exports:**
- `baseSchemas` - { uuid, slug, idempotencyKey, currency, email, hexColor }
- `safeString(max, min)` - Required string with length limits
- `optionalSafeString(max)` - Optional string that transforms "" to undefined
- `optionalEmail` - Optional email schema
- `uuidArray(max)` - Array of UUIDs with deduplication
- `orgNameSchema` - Organization name validation
- `validateOrgName(name)` - Returns { valid, error }
- `z` - Re-exported Zod for convenience

**Web app changes:**
- `apps/web/src/lib/security/validation.ts` - Imports from package, keeps Next.js parts
- `apps/web/src/lib/validation/org-name.ts` - Re-exports from package

**Verification:** `npm run build` passes

---

## Next Task: Phase 2.3 - @teammeet/core Package

**Goal:** Extract platform-agnostic business logic to a shared package.

### Files to Extract

1. **Role utilities** from `apps/web/src/lib/auth/role-utils.ts`:
   - `normalizeRole(role)` - Normalizes legacy roles (member → active_member)
   - `roleFlags(role)` - Returns { isAdmin, isActiveMember, isAlumni }

2. **Pricing logic** from `apps/web/src/lib/pricing.ts` and `apps/web/src/lib/alumni-quota.ts`:
   - `BASE_PRICES` - { month: 15, year: 150 }
   - `ALUMNI_ADD_ON_PRICES` - Tiered pricing by bucket
   - `getTotalPrice(interval, bucket)` - Calculate subscription cost
   - `formatPrice(cents)` - Format for display
   - `ALUMNI_LIMITS` - Max alumni per bucket
   - `getAlumniLimit(bucket)` - Get limit for bucket

3. **Navigation config** from `apps/web/src/lib/navigation/`:
   - `NavItem` type - { key, label, href, icon, allowedRoles }
   - `ORG_NAV_ITEMS` - Array of navigation items
   - `canAccessNavItem(item, role)` - Check if user can access
   - `getNavItemsForRole(role)` - Filter nav items by role

4. **Announcement filtering** from `apps/web/src/lib/announcements.ts`:
   - `filterAnnouncementsForUser(announcements, userId, role)` - Filter by audience

### Target Package Structure

```
packages/core/
├── package.json
└── src/
    ├── index.ts           # Main exports
    ├── auth/
    │   ├── index.ts
    │   └── role-utils.ts  # normalizeRole, roleFlags
    ├── pricing/
    │   └── index.ts       # Prices, getTotalPrice, alumni limits
    ├── navigation/
    │   └── index.ts       # NavItem type, ORG_NAV_ITEMS
    └── announcements/
        └── index.ts       # filterAnnouncementsForUser
```

### Steps to Complete

1. Read current files to understand exports
2. Create directory structure in packages/core/src/
3. Extract pure functions (no Next.js/server dependencies)
4. Create index.ts files with exports
5. Update web app imports
6. Test build
7. Commit

---

## Directory Structure (Current)

```
TeamMeet/
├── apps/
│   ├── web/                    # Next.js 14 web app
│   │   ├── src/
│   │   │   ├── app/            # App Router pages
│   │   │   ├── components/     # UI components
│   │   │   ├── lib/            # Business logic (some to extract)
│   │   │   └── hooks/          # React hooks
│   │   ├── tests/
│   │   ├── .env.local
│   │   ├── next.config.mjs
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── mobile/                 # Expo app (to be built)
│       └── .env.local
├── packages/
│   ├── types/                  # @teammeet/types ✓
│   │   └── src/
│   │       ├── database.ts
│   │       └── index.ts
│   ├── validation/             # @teammeet/validation ✓
│   │   └── src/
│   │       ├── schemas.ts
│   │       └── index.ts
│   └── core/                   # @teammeet/core (next)
│       └── src/
│           └── index.ts        # Placeholder
├── supabase/                   # Database migrations
├── docs/
│   └── MIGRATION.md            # This file
├── package.json                # Root workspace config
└── .claude/plans/              # Full migration plan
```

---

## Key Commands

```bash
# Development
npm run dev           # Start web dev server
npm run build         # Build web app

# Install after changes to packages
npm install

# Individual package testing (from package dir)
npx tsc --noEmit      # Type check
```

---

## Import Patterns

### Types
```typescript
import type { Database, Organization, UserRole, AnnouncementAudience } from "@teammeet/types";
```

### Validation
```typescript
import { baseSchemas, safeString, validateOrgName, z } from "@teammeet/validation";
```

### Core (after Phase 2.3)
```typescript
import { normalizeRole, roleFlags, BASE_PRICES, filterAnnouncementsForUser } from "@teammeet/core";
```

---

## Rollback

```bash
# Full rollback to before migration
git checkout pre-monorepo-backup

# Partial rollback (by commit)
git revert <commit-hash>

# Hard reset (destructive)
git reset --hard <commit-hash>
```

---

## Notes

- Backend unchanged (Supabase DB/RLS + Vercel API routes)
- RLS policies work unchanged (JWT-based)
- Web uses Tailwind CSS, mobile will use React Native StyleSheet
- Supabase auth: web = cookies via @supabase/ssr, mobile = AsyncStorage
