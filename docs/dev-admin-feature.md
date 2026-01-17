# Dev-Admin Feature Documentation

## Overview
The **Dev-Admin** feature provides "God Mode" access for specific developers, allowing them to view, debug, and manage any organization within the platform without requiring explicit membership or admin roles in those organizations.

## Configuration

### Allowlist
Access is controlled via a hardcoded email allowlist in `src/lib/auth/dev-admin.ts`.
**Current Admins:**
- `mleonard1616@gmail.com`
- `lociccone11@gmail.com`

### capabilities
Dev-Admins can:
1.  **Ghost Access:** View the dashboard and internal pages of **any** organization (even if not a member).
2.  **Dev Panel:** Access a floating diagnostic panel (bottom-right) showing:
    - Organization ID & Slug
    - Raw Stripe Customer & Subscription IDs
    - Subscription Status (Active, Past Due, Canceled, etc.)
    - Member count (real-time from DB)
3.  **Actions:**
    - **Reconcile Subscription:** Force-sync Stripe status to the database.
    - **Billing Portal:** Open the Stripe Billing Portal for the org.
    - **Delete Organization:** (API enabled, UI pending) Permanently delete the org.
4.  **Invisibility:**
    - Dev-admins do **not** appear in the "Members" list of any organization.
    - Dev-admins have a visible "Dev Admin" badge in the navigation sidebar/mobile drawer.

## Architecture

### 1. Authentication Layer
- **`isDevAdmin(user)`:** Helper function to check if the current user is in the allowlist.
- **`canDevAdminPerform(user, action)`:** Gatekeeper function used in API routes and UI components.

### 2. Layout Integration (`src/app/[orgSlug]/layout.tsx`)
- The layout checks if the user is a Dev-Admin.
- **Bypass:** If `isDevAdmin` is true, it skips the standard "membership required" redirects (403/404).
- **Service Client:** It attempts to initialize a Supabase Service Client (`createServiceClient`) to fetch raw data (Stripe IDs) that regular RLS policies might hide.

### 3. API Route Protection
The following API routes have been patched to accept `isDevAdmin` authorization:
- `POST /api/organizations/[id]/reconcile-subscription`
- `POST /api/stripe/billing-portal`
- `DELETE /api/organizations/[id]`

## Current Status & Known Issues

### ✅ Working
- **Role Detection:** The app correctly identifies `mleonard1616@gmail.com` as a dev-admin.
- **UI Indicators:** The "Dev Admin" badge appears in the sidebar and mobile drawer.
- **Panel Rendering:** The Dev Panel renders correctly for organizations where the user is already a member.
- **Member Filtering:** Dev-admins are successfully filtered out of the `/members` list.

### ❌ Not Working / Issues

#### 1. "Internal Server Error" (500) on Ghost Access
**Symptom:** Visiting an org you are not a member of crashes the page.
**Cause:** The layout attempts to call `createServiceClient()` to fetch advanced stats. If the `SUPABASE_SERVICE_ROLE_KEY` environment variable is missing in `.env.local`, this function throws a hard error, crashing the React server component.
**Fix:** Wrap the service client initialization in a `try/catch` block or ensure the env var is set.

#### 2. "Page Not Found" (404) on Ghost Access
**Symptom:** Visiting `localhost:3000/beta-theta-pi` returns a 404.
**Cause:** The slug `beta-theta-pi` likely does not exist in the local database `organizations` table. Ghost access only works for *existing* organizations.
**Fix:** Query the database (`SELECT slug FROM organizations`) to find a valid slug to test.

## Troubleshooting

### How to Fix the 500 Crash
In `src/app/[orgSlug]/layout.tsx`, the service client creation must be defensive:

```typescript
let serviceSupabase = null;
if (isDevAdmin) {
  try {
    serviceSupabase = createServiceClient();
  } catch (e) {
    console.warn("DevAdmin: Failed to create service client (missing key?)", e);
  }
}
```

### How to Verify Ghost Access
1.  **Find a valid slug:**
    Run this SQL in Supabase Dashboard:
    ```sql
    SELECT name, slug FROM organizations LIMIT 5;
    ```
2.  **Visit the URL:** `http://localhost:3000/<valid-slug>`
