# Database RLS and Schema Fixes

## Summary

This document outlines the fixes applied to resolve PostgREST "schema cache" errors and RLS (Row Level Security) insert failures in the TeamMeet application.

## Issues Fixed

### 1. Schema Cache Errors

**A) Missing RPC Function: `create_org_invite`**
- **Problem**: `Could not find function public.create_org_invite(p_expires_at, p_organization_id, p_role, p_uses) in schema cache`
- **Root Cause**: The function existed in migration files but hadn't been applied to the database
- **Fix**: Applied the `20251217100000_schema_fixes.sql` migration which includes the complete `create_org_invite` function

**B) Missing Columns**
- **Problem**: `Could not find the 'audience' column of 'events'` and `Could not find the 'current_city' column of 'alumni'`
- **Root Cause**: Frontend code expected these columns but they didn't exist in the database schema
- **Fix**: Added missing columns via migration:
  - `alumni.current_city text`
  - `events.audience text DEFAULT 'both'`
  - `events.target_user_ids uuid[]`

### 2. RLS Insert Failures

**Problem**: `new row violates row-level security policy` for announcements, competitions, members, workouts tables

**Root Cause**: Conflicting RLS policies from multiple migrations created inconsistent security rules

**Fix**: Cleaned up conflicting policies and ensured consistent admin-only insert permissions for all tables:
- announcements: INSERT allowed only for admins
- competitions: INSERT allowed only for admins
- members: INSERT allowed only for admins
- workouts: INSERT allowed only for admins

## Technical Details

### Applied Migrations

1. **`20251217100000_schema_fixes.sql`** - Applied missing functions and RLS policies
2. **`20251216121000_cleanup_rls_policies.sql`** - Removed conflicting old policies
3. **`20251216120000_add_missing_columns.sql`** - Added alumni.current_city and events.audience/target_user_ids

### RLS Policy Structure

All affected tables now have consistent policies:
- **SELECT**: Admins, active members, and alumni can read
- **INSERT**: Only admins can create new records (enforced via WITH CHECK)
- **UPDATE**: Only admins can modify
- **DELETE**: Only admins can delete

### Helper Functions

The fixes rely on these SECURITY DEFINER functions:
- `is_org_admin(org_id uuid)` - Checks if current user is admin
- `is_org_member(org_id uuid)` - Checks if current user is member
- `has_active_role(org_id uuid, allowed_roles text[])` - Checks role membership

### Schema Cache Reload

After applying migrations, forced PostgREST schema cache reload:
```sql
select pg_notify('pgrst', 'reload schema');
```

### TypeScript Types

Regenerated database types to match the updated schema, ensuring:
- `alumni.current_city` is properly typed as `string | null`
- `events.audience` and `events.target_user_ids` are properly typed
- `create_org_invite` function signature matches database

## Testing Verification

### Schema Cache Errors
✅ `create_org_invite` function exists and is callable
✅ `events.audience` column exists
✅ `alumni.current_city` column exists

### RLS Insert Permissions
✅ Announcements: INSERT works for admins, fails for non-admins
✅ Competitions: INSERT works for admins, fails for non-admins
✅ Members: INSERT works for admins, fails for non-admins
✅ Workouts: INSERT works for admins, fails for non-admins

## Files Modified

- `supabase/migrations/20251216120000_add_missing_columns.sql` (new)
- `supabase/migrations/20251216121000_cleanup_rls_policies.sql` (new)
- `src/types/database.ts` (regenerated)

## Performance Advisor Follow-Up (RLS)

Supabase Performance Advisor may flag RLS policy performance issues when `auth.uid()`, `auth.role()`, or `current_setting()` are called directly in `USING`/`WITH CHECK` expressions. These functions can be re-evaluated per-row, which becomes expensive at scale.

**Guidelines**

- Prefer `(select auth.uid())` over `auth.uid()` in RLS policies.
- Prefer `(select auth.role())` over `auth.role()` in RLS policies.
- Avoid multiple permissive policies for the same table + role + action; merge conditions into a single policy where feasible.
- Be careful with admin policies declared as `FOR ALL` if you also have a separate `FOR SELECT` policy: `FOR ALL` includes `SELECT` and can reintroduce the “multiple permissive policies” performance warning. Prefer separate `FOR INSERT` / `FOR UPDATE` / `FOR DELETE` policies for write access.

## Next Steps

1. Keep database changes in `supabase/migrations/` to avoid production drift
2. Run Supabase Performance Advisor after schema/RLS work
3. Consider adding database tests for RLS policies
4. Document the expected behavior for admin-only operations in the UI

## Prevention

- Always apply migrations immediately after creation
- Use `pg_notify('pgrst', 'reload schema')` after schema changes
- Regenerate TypeScript types after any database schema changes
- Test RLS policies thoroughly when adding new tables or modifying permissions






