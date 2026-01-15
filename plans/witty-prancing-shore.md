# Plan: Fix "Organization not specified" Error on Web

## Problem Analysis

After adding debug logging and running investigation queries, we've identified the issue:

**Error:** `❌ [useMembers] Error: Organization not specified`

### Investigation Results

✅ **Data exists in database:**
- Fordham Prep org exists (slug: `fordham-prep-test`)
- 3 active members present
- Your user (mleonard1616@gmail.com) is an admin

✅ **RLS Policies are correct:**
```sql
-- user_organization_roles SELECT policy:
(user_id = auth.uid()) OR is_org_member(organization_id)
```

❌ **Root Cause - Timing Issues on Web:**

1. **orgSlug undefined on initial render**: `useLocalSearchParams()` returns undefined before route params are parsed
2. **Aggressive error throwing**: Hooks throw errors immediately if `orgSlug` is empty
3. **Auth session timing**: On web, auth session may not be ready when hooks first run

### Current Behavior
```typescript
// In hooks (useMembers.ts, useAlumni.ts, etc.)
if (!orgSlug) {
  throw new Error("Organization not specified");  // ❌ Throws before params load
}
```

### Expected Behavior
Hooks should gracefully handle:
- Empty orgSlug on initial render (wait for params)
- Uninitialized auth session (wait for auth)
- Then make authenticated API calls

## Implementation Plan

### Files to Modify

1. **`apps/mobile/src/hooks/useMembers.ts`**
2. **`apps/mobile/src/hooks/useAlumni.ts`**
3. **`apps/mobile/src/hooks/useEvents.ts`** (if exists)
4. **`apps/mobile/src/hooks/useAnnouncements.ts`** (if exists)

### Changes

**For each hook:**

1. **Remove aggressive error throwing** for empty orgSlug
2. **Add guard clause** to skip fetch when orgSlug is empty
3. **Keep error state** for actual API errors
4. **Ensure useEffect dependency** triggers refetch when orgSlug changes

**Pattern to implement:**

```typescript
const fetchData = async () => {
  try {
    setLoading(true);

    // Guard clause: Don't throw, just return early
    if (!orgSlug) {
      setData([]);
      setLoading(false);
      return;
    }

    // ... rest of fetch logic
  } catch (e) {
    // Only catch actual errors, not missing orgSlug
    setError((e as Error).message);
  } finally {
    setLoading(false);
  }
};

useEffect(() => {
  fetchData();
}, [orgSlug]);  // Re-fetch when orgSlug becomes available
```

### Additional Debugging & Auth Verification

**Add auth session logging** to verify the session is available:

```typescript
// At the start of fetchData in each hook
const { data: { session } } = await supabase.auth.getSession();
console.log("🔐 [useMembers] Auth session:", session ? "✅ Active" : "❌ None");
```

Keep existing console.log statements to track:
- When orgSlug becomes available
- Auth session status
- What data is returned
- Any actual API errors

This will verify:
1. Auth session is present when queries run
2. Data is successfully returned from database
3. All 3 Fordham Prep members appear

## Verification

1. **Start dev server**: `cd apps/mobile && bun expo start --web`
2. **Login**: Use dev login (mleonard1616@gmail.com / dev123)
3. **Navigate to org**: Click on "Fordham Prep" from organizations list
4. **Check console**: Should see debug logs showing:
   ```
   🔐 [useMembers] Auth session: ✅ Active
   🔍 [useMembers] Found org: { orgSlug: "fordham-prep-test", orgId: "74eee925-..." }
   🔍 [useMembers] Query result: { count: 3, data: [...] }
   ```
5. **Check screen**:
   - ❌ No "Organization not specified" error
   - ✅ Members tab shows 3 members:
     - Matt Leonard (admin)
     - Matthew McKillop (active_member)
     - Louis Ciccone (admin)

## Success Criteria

- ✅ No "Organization not specified" error on web
- ✅ App loads without throwing errors on initial render
- ✅ Auth session is active when queries run
- ✅ All 3 Fordham Prep members display correctly
- ✅ Data fetches successfully once orgSlug is available
- ✅ Debug logs confirm successful query with count: 3
