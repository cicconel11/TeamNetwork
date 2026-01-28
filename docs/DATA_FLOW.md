# How TeamMeet Works (End-to-End)

## The Big Picture

TeamMeet is a multi-tenant SaaS platform where organizations (fraternities, clubs, teams) manage their members, alumni, events, announcements, and donations. It has a Next.js web app and an Expo React Native mobile app, both backed by Supabase (PostgreSQL) with Stripe for payments.

---

## 1. Monorepo Structure

```
TeamMeet/
├── apps/web/            # Next.js web app
├── apps/mobile/         # Expo React Native app
├── packages/core/       # Shared business logic (roles, pricing, filtering)
├── packages/types/      # Supabase-generated TypeScript types
├── packages/validation/ # Zod schemas shared across web + mobile
├── packages/supabase/   # Platform-agnostic Supabase query functions
└── supabase/            # Database migrations
```

Both apps import from the shared packages. For example, role normalization (`member` -> `active_member`) and announcement audience filtering live in `@teammeet/core` so the logic is identical on web and mobile.

---

## 2. Authentication Flow

**Web:** Cookie-based sessions via Supabase Auth SSR. The OAuth callback at `/auth/callback` exchanges an auth code for a session and sets HTTP cookies. Password and magic link login also work.

**Mobile:** AsyncStorage-based sessions. Google OAuth uses the native Google Sign-In SDK and calls `signInWithIdToken()`. The root layout (`app/_layout.tsx`) listens for auth state changes and automatically redirects between `(auth)` and `(app)` route groups.

Both platforms call the same Supabase Auth API -- the difference is just where the session token is stored (cookies vs AsyncStorage).

---

## 3. Web Request Lifecycle

Every web request goes through `apps/web/src/middleware.ts`:

1. **Canonical domain** -- redirects `myteamnetwork.com` to `www.myteamnetwork.com`
2. **Public route check** -- `/`, `/auth/*`, `/terms` pass through without auth
3. **Auth validation** -- calls `supabase.auth.getUser()` to verify the JWT
4. **Protected route redirect** -- unauthenticated users go to `/auth/login?redirect=<original_path>`
5. **Org membership check** -- for `/[orgSlug]/*` routes, queries the `user_organization_roles` table to verify the user belongs to that org. Revoked users get redirected to `/app?error=access_revoked`. Pending users see a pending notice.

After middleware, the org layout (`apps/web/src/app/[orgSlug]/layout.tsx`) calls `getOrgContext()` which loads the org, user's role, subscription status, and grace period. It also applies the org's custom theme colors as CSS variables. The sidebar filters navigation items based on the user's role (admin / active_member / alumni).

---

## 4. Mobile App Startup & Navigation

The mobile navigation is layered:

```
Root Layout (_layout.tsx)
  └─ Auth check → redirect to (auth) or (app)
      └─ (app) layout → OrgProvider + Drawer
          └─ Drawer → Organizations list OR [orgSlug] screens
              └─ [orgSlug] Stack → (tabs) + modal screens
                  └─ 5 tabs: Home, Events, Announcements, Members, Menu
```

**Org context flow:** When a user taps into an org, `OrgContext` extracts `orgSlug` from the URL, fetches the org metadata and the user's role, normalizes the role, and provides it all via React Context. Every data hook (`useEvents`, `useMembers`, `useAnnouncements`) receives `orgId` from this context.

---

## 5. Data Fetching Pattern (Mobile)

All mobile data hooks follow the same pattern:

- Accept `orgId` from context
- Fetch from Supabase with org filter + soft-delete filter (`.is("deleted_at", null)`)
- Subscribe to real-time changes via Supabase channels (auto-refetch on INSERT/UPDATE/DELETE)
- Implement a 30-second stale window -- when a tab regains focus, it only refetches if data is older than 30 seconds
- Support pull-to-refresh for manual refetching

---

## 6. Role-Based Access Control

Three roles: **admin**, **active_member**, **alumni**

Roles are stored in `user_organization_roles` and normalized by `@teammeet/core`:
- `member` -> `active_member`
- `viewer` -> `alumni`

Access is enforced at multiple layers:
- **Database:** PostgreSQL RLS policies using `is_org_admin()`, `is_org_member()` helper functions
- **Middleware:** Membership status check (active/pending/revoked)
- **Layout:** Billing gates for expired subscriptions
- **UI:** Navigation items declare which roles can see them; orgs can further customize visibility via `nav_config` JSONB

---

## 7. Payment System (Stripe)

**Subscriptions:** Orgs pay a base plan ($15/mo or $150/yr) plus alumni add-ons based on tier (0-250 alumni, 251-500, etc.). Checkout is initiated via `/api/organizations/[id]/start-checkout`.

**Idempotency:** The client generates a stable `idempotency_key` (stored in localStorage). The server inserts into `payment_attempts` with a UNIQUE constraint. Duplicate requests return the existing checkout URL instead of creating a new one.

**Webhooks:** Stripe sends events to `/api/stripe/webhook`. Each event is deduplicated via the `stripe_events` table (UNIQUE on `event_id`). Events update `organization_subscriptions`, `payment_attempts`, or `organization_donations`.

**Donations:** Use Stripe Connect so funds go directly to the org's connected Stripe account, never touching the platform.

---

## 8. Key Database Tables

| Table | Purpose |
|---|---|
| `organizations` | Org metadata (slug, name, colors, features) |
| `user_organization_roles` | Links users to orgs with role + status |
| `announcements` | Org announcements with audience targeting |
| `events` / `event_rsvps` | Events and RSVP tracking |
| `members` / `alumni` | Member and alumni directory data |
| `organization_subscriptions` | Stripe subscription state |
| `payment_attempts` | Idempotent payment tracking |
| `stripe_events` | Webhook deduplication |
| `organization_donations` | Donation records via Stripe Connect |

All content tables use soft deletes (`deleted_at` timestamp).

---

## 9. Analytics (Mobile)

PostHog for product analytics, Sentry for error tracking. An abstraction layer in `src/lib/analytics/` queues events before SDKs initialize, identifies users on login, tracks screen views automatically, updates org context as user properties, and resets everything on logout.

---

## 10. Mobile Screen Data Flow (Home Screen Example)

The mobile app has a 4-phase data loading process:

### Phase 1: Org Context Bootstraps Everything

When a user taps into an org, `OrgContext` (`apps/mobile/src/contexts/OrgContext.tsx:30`) kicks off:

```
Route: /(app)/(drawer)/[orgSlug]/(tabs)/
                          ↓
        useGlobalSearchParams() extracts orgSlug
                          ↓
        Two parallel queries:
        ├─ organizations table → orgId, orgName, orgLogoUrl
        └─ supabase.auth.getUser() → userId
                          ↓
        user_organization_roles table → raw role
                          ↓
        normalizeRole() from @teammeet/core
        ("member" → "active_member", "viewer" → "alumni")
                          ↓
        Context provides: { orgSlug, orgId, orgName, orgLogoUrl, userRole }
```

Every screen and hook under `[orgSlug]` reads from this context. The org is fetched once, not per-screen.

### Phase 2: Data Hooks Initialize in Parallel

The Home screen (`apps/mobile/app/(app)/(drawer)/[orgSlug]/(tabs)/index.tsx:72-74`) initializes three hooks simultaneously, all receiving `orgId` from context:

```
useEvents(orgId)         useAnnouncements(orgId)       useMembers(orgId)
     ↓                          ↓                            ↓
  events table            announcements table         user_organization_roles
  .eq("org_id")           .eq("org_id")               .eq("org_id")
  .is("deleted_at", null) .is("deleted_at", null)     .eq("status", "active")
  .order("start_date")    .order("created_at", desc)  .in("role", [admin, active_member, member])
                                  ↓                   joined to users table (name, email, avatar)
                           filterAnnouncementsForUser()
                           (client-side audience filter
                            using role from @teammeet/core)
```

Each hook returns: `{ data, loading, error, refetch, refetchIfStale }`

### Phase 3: Real-Time Subscriptions Keep Data Fresh

Each hook sets up Supabase Realtime channels:

| Hook | Channel | Watches | On Change |
|---|---|---|---|
| `useEvents` | `events:{orgId}` | events table (org-filtered) | Re-fetches all events |
| `useAnnouncements` | `announcements:{orgId}` | announcements table | Re-fetches + re-filters by audience |
| `useAnnouncements` | `announcement-roles:{orgId}:{userId}` | user_organization_roles | Re-fetches (role change = different audience) |
| `useMembers` | `members:{orgId}` | user_organization_roles (org-filtered) | Re-fetches member list |

If an admin creates a new event on the web app, the mobile Home screen updates automatically without polling.

### Phase 4: Stale-Time Optimization on Tab Focus

Every hook tracks its last fetch time. When a user switches tabs and comes back:

```
useFocusEffect → refetchEventsIfStale()
               → refetchAnnouncementsIfStale()
               → refetchMembersIfStale()

refetchIfStale() checks:
  Date.now() - lastFetchTime > 30_000ms?
    YES → fetch from Supabase
    NO  → skip (data is fresh enough)
```

Pull-to-refresh bypasses this check and forces all hooks to refetch in parallel via `Promise.all()`.

---

## 11. Web Screen Data Flow (Members Page Example)

The web app is fundamentally different: 100% server-rendered with minimal client JavaScript.

### The Request Pipeline

```
Browser: GET /alumni-group/members?status=inactive
                    ↓
┌─────────────────────────────────────────────────┐
│ MIDDLEWARE (src/middleware.ts)                    │
│                                                  │
│  1. Canonical domain redirect                    │
│  2. supabase.auth.getUser() → validate JWT       │
│  3. Is route public? → No, continue              │
│  4. Is org route? → Yes, check membership:       │
│     └─ Query user_organization_roles             │
│        ├─ revoked → redirect /app?error=revoked  │
│        ├─ pending → redirect /app?pending=slug   │
│        └─ active → pass through ✓                │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ ORG LAYOUT (src/app/[orgSlug]/layout.tsx)        │
│                                                  │
│  getOrgContext(orgSlug) runs 3 queries:           │
│  ├─ organizations → org record + colors          │
│  ├─ organization_subscriptions → billing status  │
│  └─ user_organization_roles → role + status      │
│                                                  │
│  Gate checks:                                    │
│  ├─ No org → 404                                 │
│  ├─ Revoked → "Access removed" page              │
│  ├─ No role → "No membership" page               │
│  ├─ Grace expired → BillingGate component        │
│  └─ Sub inactive → BillingGate component         │
│                                                  │
│  Apply org theme colors as CSS variables         │
│  Render OrgSidebar (filtered by user's role)     │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ MEMBERS PAGE (src/app/[orgSlug]/members/page.tsx)│
│                                                  │
│  1. Get org by slug (for org.id)                 │
│  2. isOrgAdmin() → controls "Add Member" button  │
│  3. Query members table:                         │
│     WHERE org_id = [id]                          │
│     AND deleted_at IS NULL                       │
│     AND status = searchParams.status ("inactive")│
│     ORDER BY last_name                           │
│  4. Get unique roles for filter dropdown         │
│  5. Resolve nav labels from org's nav_config     │
│  6. Render server HTML → send to browser         │
└─────────────────────────────────────────────────┘
```

### URL-Based Filtering (Key Difference from Mobile)

The `MembersFilter` component is the only client component on the page, and it does zero data fetching. When a user clicks "Inactive":

```
Click "Inactive" → Link navigates to /alumni-group/members?status=inactive
                 → Full server re-render with new searchParams
                 → Members query adds AND status = "inactive"
                 → New HTML sent to browser
```

No API calls from the client. No React state for member data. The URL is the state.

---

## 12. Side-by-Side: Mobile vs Web

| Aspect | Mobile | Web |
|---|---|---|
| Data fetching | Client-side hooks (`useEvents`, `useMembers`) | Server components (async functions) |
| Auth storage | AsyncStorage | HTTP cookies |
| Real-time updates | Supabase Realtime channels | None (server-rendered) |
| Filtering | In-memory (client-side) | URL query params → server re-render |
| Loading states | ActivityIndicator spinner per hook | Full page load (streaming HTML) |
| Refresh | Pull-to-refresh + stale-time check | Browser refresh or filter navigation |
| Org context | React Context (`useOrg()` hook) | Server function (`getOrgContext()`) per request |
| Role enforcement | Context provides userRole to screens | Middleware + layout gate checks |
| Shared logic | `@teammeet/core` (`normalizeRole`, `filterAnnouncements`) | Same package, same functions |
