# TeamMeet Monorepo Migration Progress

> **Last Updated:** 2026-01-24 - Mobile app feature-complete with all screens implemented.

## Quick Status

| Phase | Task | Status |
|-------|------|--------|
| Phase 1 | Monorepo Setup | DONE |
| Phase 2 | Shared Packages | DONE |
| Phase 3 | Mobile Auth | DONE |
| Phase 4 | Mobile Core Screens | DONE |
| Phase 5 | Mobile Feature Screens | DONE |
| Phase 6 | Design System | DONE |
| Phase 7 | Drawer Navigation | DONE |

---

## Current Architecture

### Directory Structure

```
TeamMeet/
├── apps/
│   ├── web/                    # Next.js 14 web application
│   │   ├── src/
│   │   ├── tests/
│   │   └── package.json
│   └── mobile/                 # Expo SDK 54 mobile app
│       ├── app/                # Expo Router screens (60+ files)
│       │   ├── _layout.tsx     # Root layout
│       │   ├── (auth)/         # Login, Signup, Forgot Password
│       │   └── (app)/          # Protected screens
│       │       └── (drawer)/   # Drawer navigator
│       │           └── [orgSlug]/  # Org-scoped screens
│       │               ├── (tabs)/     # 6 tab screens
│       │               └── [feature]/  # Feature screens
│       ├── src/
│       │   ├── components/     # Shared UI components
│       │   ├── hooks/          # Data fetching hooks
│       │   ├── lib/            # Utilities, design tokens
│       │   └── navigation/     # Drawer, AppDrawer
│       └── package.json
├── packages/
│   ├── core/                   # @teammeet/core - business logic
│   ├── types/                  # @teammeet/types - TypeScript types
│   └── validation/             # @teammeet/validation - Zod schemas
├── supabase/                   # Database migrations
└── docs/                       # Documentation
```

### Mobile Screen Inventory

**Tab Screens (6):**
- Home, Events, Announcements, Members, Alumni, Menu

**Feature Screens (via Drawer):**
- Chat (list + room)
- Workouts (list + create + edit)
- Competition (standings + add team + add points)
- Schedules (list + create + edit)
- Records (list)
- Philanthropy (list + create)
- Donations (list + create)
- Expenses (list + create)
- Forms (list + detail + document viewer)
- Mentorship (overview)
- Settings + Navigation config

**Detail/Action Screens:**
- Event detail + edit + RSVPs + check-in
- Announcement detail + edit + create
- Member detail + invite
- Alumni detail

---

## Commands

```bash
bun install         # Install all workspace deps
bun dev             # Start web dev server (localhost:3000)
bun dev:mobile      # Start Expo dev server (localhost:8081)
bun build           # Build all packages
bun typecheck       # Type-check all packages
bun lint            # Lint all packages
```

---

## Import Patterns

```typescript
// Types
import type { Database, Organization, UserRole } from "@teammeet/types";

// Validation
import { baseSchemas, safeString, z } from "@teammeet/validation";

// Core business logic
import { normalizeRole, roleFlags, filterAnnouncementsForUser } from "@teammeet/core";

// Mobile design tokens
import { NEUTRAL, SEMANTIC, ENERGY } from "@/lib/design-tokens";
import { APP_CHROME } from "@/lib/chrome";
```

---

## Key Files

| File | Purpose |
|------|---------|
| `apps/mobile/src/navigation/DrawerContent.tsx` | Drawer menu with grouped sections |
| `apps/mobile/src/components/TabBar.tsx` | Custom tab bar component |
| `apps/mobile/src/lib/design-tokens.ts` | NEUTRAL, SEMANTIC, ENERGY colors |
| `apps/mobile/src/lib/chrome.ts` | APP_CHROME header/tab colors |
| `apps/mobile/src/hooks/useOrgRole.ts` | Role-based permissions hook |
| `packages/core/src/auth/role-utils.ts` | normalizeRole, roleFlags |

---

## Related Documentation

- `CLAUDE.md` - Development guidelines, mobile patterns
- `docs/MOBILE-PARITY.md` - Feature parity matrix
- `docs/MOBILE-TAP-VALIDATION.md` - Touch target requirements
- `docs/db/schema-audit.md` - Database documentation
