# Supabase Schema Audit

**Date**: December 16, 2025  
**Audited By**: Automated Analysis of Local Migrations

> **Note**: This audit is based on analysis of local migration files. Once Supabase MCP is connected, run live schema queries to verify drift between local migrations and production.

## Tables Summary

### Core Multi-Tenant Tables

| Table | RLS | Issues Found |
|-------|-----|--------------|
| `organizations` | Unknown | Need to verify RLS policies |
| `user_organization_roles` | ✅ | Has `status` enum (active/revoked/pending), `has_active_role()` helper exists |
| `users` | Unknown | **CRITICAL**: May be missing sync trigger from `auth.users` |

### Entity Tables (Org-Scoped)

| Table | RLS | `organization_id` Index | `deleted_at` | `updated_at` Trigger |
|-------|-----|------------------------|--------------|---------------------|
| `members` | Unknown | Need to verify | ✅ | Need to verify |
| `alumni` | Unknown | ✅ (partial: WHERE deleted_at IS NULL) | ✅ | Need to verify |
| `events` | ✅ | Need to verify | ✅ | Need to verify |
| `announcements` | ✅ | Need to verify | ✅ | Need to verify |
| `donations` | Unknown | Need to verify | ✅ | Need to verify |
| `notifications` | Unknown | Need to verify | ✅ | Need to verify |
| `philanthropy_events` | Unknown | Need to verify | ✅ | Need to verify |

### Feature Tables

| Table | RLS | Issues |
|-------|-----|--------|
| `organization_invites` | ✅ | Code generated client-side (security risk), needs server-side RPC |
| `org_philanthropy_embeds` | ✅ | Has `updated_at` trigger, HTTPS validation |
| `org_donation_embeds` | ✅ | Has `updated_at` trigger, HTTPS validation |
| `notification_preferences` | Unknown | Need to verify |
| `mentorship_pairs` | ✅ | Has RLS policies |
| `mentorship_logs` | ✅ | Has RLS policies |
| `workouts` | ✅ | Has RLS policies |
| `workout_logs` | ✅ | Has RLS policies |
| `competitions` | Unknown | Need to verify |
| `competition_points` | ✅ | Has RLS policies |
| `competition_teams` | ✅ | Has RLS policies |

---

## Critical Issues Identified

### 1. Missing `public.users` Sync Trigger

**Problem**: The codebase queries `users(name, email)` via joins (e.g., in invites page line 121), but there's no trigger to automatically populate `public.users` when a new `auth.users` row is created.

**Evidence**: No migration contains `CREATE TRIGGER ... ON auth.users`.

**Impact**: User name/email data missing, causing NULL values in member lists.

**Fix Required**: Add `handle_new_user()` trigger function.

### 2. Invite Codes Generated Client-Side

**Location**: `src/app/[orgSlug]/settings/invites/page.tsx` lines 28-44

**Problem**: 
```typescript
function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  // ... client-side generation
}
```

**Security Risk**: Predictable codes, no server-side validation at creation time.

**Fix Required**: Replace with `create_org_invite()` RPC.

### 3. Invite Redemption Direct Inserts May Fail

**Location**: `src/app/app/join/page.tsx` lines 123-125

**Problem**: Direct insert into `user_organization_roles` depends on RLS policy allowing self-insert.

**Current Policy** (from migration):
```sql
CREATE POLICY user_org_roles_insert ON public.user_organization_roles
  FOR INSERT WITH CHECK (user_id = auth.uid());
```

**Risk**: If policy is missing or different in production, joins silently fail.

**Fix Required**: Replace with `redeem_org_invite()` RPC (SECURITY DEFINER).

### 4. Announcement Notifications Not Actually Sent

**Location**: `src/lib/notifications.ts` lines 64-71

**Problem**: `sendEmail()` is a stub that only logs:
```typescript
export async function sendEmail(params: EmailParams): Promise<NotificationResult> {
  console.log("[STUB] Sending email:", { ... });
  return { success: true, messageId: `email_${Date.now()}_...` };
}
```

**Fix Required**: Integrate Resend API.

### 5. Missing Helper Functions for Cleaner RLS

**Current State**: `has_active_role(org uuid, allowed_roles text[])` exists.

**Missing**: 
- `is_org_member(org_id uuid) returns boolean`
- `is_org_admin(org_id uuid) returns boolean`

These would simplify policy definitions and RPC checks.

---

## Existing RLS Policies (from migrations)

### `user_organization_roles`
- SELECT: `user_id = auth.uid() OR has_active_role(organization_id, array['admin'])`
- INSERT: `user_id = auth.uid()` (allows self-insert for join flow)
- UPDATE: `has_active_role(organization_id, array['admin'])`
- DELETE: `has_active_role(organization_id, array['admin'])`

### `organization_invites`
- SELECT: `has_active_role(organization_id, array['admin']) OR (token IS NOT NULL AND revoked_at IS NULL)`
- INSERT: `has_active_role(organization_id, array['admin'])`
- UPDATE: `has_active_role(organization_id, array['admin'])`
- DELETE: `has_active_role(organization_id, array['admin'])`

### `announcements`
- SELECT: `can_view_announcement(announcements)` (audience-based visibility)
- INSERT/UPDATE/DELETE: `has_active_role(organization_id, array['admin'])`

### `events`
- SELECT: `has_active_role(organization_id, array['admin','active_member','alumni'])`
- INSERT/UPDATE/DELETE: `has_active_role(organization_id, array['admin'])`

### `org_philanthropy_embeds` / `org_donation_embeds`
- SELECT: `has_active_role(organization_id, array['admin','active_member','alumni'])`
- INSERT/UPDATE/DELETE: `has_active_role(organization_id, array['admin'])`

---

## Indexes Found (from migrations)

### Alumni Table
- `alumni_graduation_year_idx`
- `alumni_industry_idx`
- `alumni_current_company_idx`
- `alumni_current_city_idx`
- `alumni_position_title_idx`
- `alumni_org_deleted_idx` (partial: WHERE deleted_at IS NULL)

### Organization Invites
- `organization_invites_org_code_idx` (unique: organization_id, code)
- `organization_invites_token_idx` (WHERE token IS NOT NULL)
- `organization_invites_org_id_idx`

### Embeds
- `org_philanthropy_embeds_org_idx`
- `org_philanthropy_embeds_org_order_idx`
- `org_donation_embeds_org_idx`
- `org_donation_embeds_org_order_idx`

### Missing Indexes (Need to Add)
- `members_org_id_idx` on `members(organization_id)`
- `events_org_id_idx` on `events(organization_id)`
- `announcements_org_id_idx` on `announcements(organization_id)`
- `donations_org_id_idx` on `donations(organization_id)`
- `notifications_org_id_idx` on `notifications(organization_id)`

---

## Migration Plan

Create `supabase/migrations/20251217100000_schema_fixes.sql` with:

1. **User sync trigger** - `handle_new_user()` function and trigger on `auth.users`
2. **Helper functions** - `is_org_member()`, `is_org_admin()`
3. **Invite RPCs** - `create_org_invite()`, `redeem_org_invite()`
4. **Dropdown RPC** - `get_dropdown_options()`
5. **Missing indexes** - on `organization_id` for core tables
6. **Ensure `updated_at` triggers** - for all entity tables

---

## Verification Queries (Run via MCP after connection)

```sql
-- Check if public.users trigger exists
SELECT tgname, tgrelid::regclass, tgtype
FROM pg_trigger
WHERE tgname LIKE '%user%';

-- Check RLS status for all tables
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public';

-- List all policies
SELECT schemaname, tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public';

-- Check foreign keys
SELECT
    tc.table_name, 
    kcu.column_name, 
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    rc.delete_rule
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.referential_constraints AS rc
    ON tc.constraint_name = rc.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public';

-- Check indexes on organization_id
SELECT indexname, tablename, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
    AND indexdef LIKE '%organization_id%';
```

