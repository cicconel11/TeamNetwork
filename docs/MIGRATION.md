# TeamMeet Monorepo Migration Progress

This document tracks the migration from a single Next.js app to an npm workspaces monorepo with React Native mobile support.

## Migration Plan Reference

Full plan available at: `.claude/plans/abundant-fluttering-codd.md`

## Current Status

### Completed

- [x] **Phase 1: Monorepo Setup**
  - Converted to npm workspaces
  - Moved web app to `apps/web/`
  - Created placeholder packages directory structure
  - Build and dev server verified working

- [x] **Phase 2.1: @teammeet/types Package**
  - Moved `database.ts` to `packages/types/src/`
  - Re-exports all Supabase types (Tables, Enums, entity types)
  - Updated 73 files to import from `@teammeet/types`
  - Build verified passing

### In Progress

- [ ] **Phase 2.2: @teammeet/validation Package**
- [ ] **Phase 2.3: @teammeet/core Package**

### Pending

- [ ] **Phase 3: Mobile App Foundation**
- [ ] **Phase 4: MVP Features**
- [ ] **Phase 5: Documentation Updates**

## Directory Structure

```
TeamMeet/
├── apps/
│   ├── web/                    # Next.js 14 web app (moved from root)
│   │   ├── src/
│   │   ├── tests/
│   │   ├── .env.local
│   │   ├── next.config.mjs
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── mobile/                 # Expo app (to be implemented)
│       └── .env.local          # Placeholder
├── packages/
│   ├── types/                  # @teammeet/types - DONE
│   │   ├── src/
│   │   │   ├── database.ts     # Supabase generated types
│   │   │   └── index.ts        # Re-exports all types
│   │   └── package.json
│   ├── validation/             # @teammeet/validation - IN PROGRESS
│   │   ├── src/
│   │   │   └── index.ts        # Placeholder
│   │   └── package.json
│   └── core/                   # @teammeet/core - PENDING
│       ├── src/
│       │   └── index.ts        # Placeholder
│       └── package.json
├── supabase/                   # Database migrations (unchanged)
├── docs/
│   └── MIGRATION.md            # This file
└── package.json                # Root workspace config
```

## Key Commands

```bash
# Development
npm run dev           # Start web dev server
npm run dev:web       # Same as above
npm run build         # Build web app

# Testing
npm run test          # Run all web tests
npm run test:auth     # Run auth tests
npm run test:payments # Run payment tests

# Package Management
npm install           # Install all workspace deps
```

## Import Pattern Changes

### Before (single app)
```typescript
import type { Database } from "@/types/database";
```

### After (monorepo)
```typescript
import type { Database, Organization, UserRole } from "@teammeet/types";
```

## Next Steps

1. **Create @teammeet/validation package** (Task 2.2)
   - Extract Zod schemas from `apps/web/src/lib/security/validation.ts`
   - Move validation helpers (org name, etc.)
   - Update web app imports

2. **Create @teammeet/core package** (Task 2.3)
   - Extract role utilities from `apps/web/src/lib/auth/role-utils.ts`
   - Extract pricing logic from `apps/web/src/lib/pricing.ts`
   - Extract navigation config from `apps/web/src/lib/navigation/`
   - Extract announcement filtering from `apps/web/src/lib/announcements.ts`

3. **Initialize Expo app** (Task 3.1)
   - Set up Expo Router
   - Configure Supabase with AsyncStorage
   - Implement auth flow

## Rollback

If issues arise, rollback branches exist:
- `pre-monorepo-backup` - State before any monorepo changes

To rollback:
```bash
git checkout pre-monorepo-backup
# or
git reset --hard <commit-hash>
```

## Notes

- Backend remains unchanged (Supabase DB/RLS + Vercel API routes)
- Web UI stays Tailwind CSS, mobile uses React Native StyleSheet
- Supabase auth: web uses cookies via @supabase/ssr, mobile will use AsyncStorage
- RLS policies work unchanged (JWT-based auth)
