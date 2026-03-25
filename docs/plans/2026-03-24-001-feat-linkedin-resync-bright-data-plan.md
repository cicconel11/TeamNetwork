# LinkedIn Re-Sync via Bright Data — Implementation Plan

## Context

Members' LinkedIn data (job title, company, location, school, major) goes stale after initial sync. Currently data only flows in on OIDC login or first OAuth connect. This plan adds on-demand re-sync via Bright Data (replacing Proxycurl for new syncs), a quarterly bulk cron, and an org admin toggle.

**Updated scope**: No job URL verification — Bright Data handles profile refresh only. (see origin: `docs/brainstorms/2026-03-24-linkedin-resync-requirements.md`)

---

## Phase 1: Migration — Org Toggle + Rate Limit Tracking

### Migration: `supabase/migrations/YYYYMMDD000000_linkedin_resync_feature.sql`

**Add to `organizations` table:**
```sql
ALTER TABLE public.organizations
  ADD COLUMN linkedin_resync_enabled boolean NOT NULL DEFAULT false;
```

**Add rate limit columns to `user_linkedin_connections`:**
```sql
ALTER TABLE public.user_linkedin_connections
  ADD COLUMN resync_count integer NOT NULL DEFAULT 0,
  ADD COLUMN resync_month text;  -- e.g. '2026-03'
```

Storing month as text + count is simpler than a separate table. Reset logic: if `resync_month != current_month`, reset count to 0 before incrementing.

**RPC for atomic rate-limited sync claim:**
```sql
CREATE OR REPLACE FUNCTION public.claim_linkedin_resync(p_user_id uuid, p_max_per_month integer DEFAULT 2)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_current_month text := to_char(now(), 'YYYY-MM');
  v_row public.user_linkedin_connections%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.user_linkedin_connections WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_connection');
  END IF;

  -- Reset count if new month
  IF v_row.resync_month IS DISTINCT FROM v_current_month THEN
    UPDATE public.user_linkedin_connections
    SET resync_count = 1, resync_month = v_current_month
    WHERE user_id = p_user_id;
    RETURN jsonb_build_object('allowed', true, 'remaining', p_max_per_month - 1);
  END IF;

  IF v_row.resync_count >= p_max_per_month THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'rate_limited', 'remaining', 0);
  END IF;

  UPDATE public.user_linkedin_connections
  SET resync_count = resync_count + 1
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object('allowed', true, 'remaining', p_max_per_month - v_row.resync_count - 1);
END;
$$;
```

---

## Phase 2: Bright Data Client

### New file: `src/lib/linkedin/bright-data.ts`

Mirror the Proxycurl pattern (`src/lib/linkedin/proxycurl.ts`) but target Bright Data's LinkedIn Profiles API.

**Env var**: `BRIGHT_DATA_API_KEY`

**Functions:**

```typescript
// Config
function getBrightDataApiKey(): string | null
export function isBrightDataConfigured(): boolean

// Single profile lookup by URL
export async function fetchBrightDataProfile(
  linkedinUrl: string
): Promise<BrightDataProfileResult | null>
// POST https://api.brightdata.com/linkedin/profiles/collect
// Auth: Bearer token
// Body: { url: linkedinUrl }

// Search by name + email (for members without URL)
export async function searchBrightDataProfile(
  firstName: string, lastName: string, email?: string
): Promise<BrightDataProfileResult | null>
// Uses discover endpoint or SERP API fallback

// Map to DB fields (reuse EnrichmentFields interface from proxycurl.ts)
export function mapBrightDataToFields(
  profile: BrightDataProfileResult
): EnrichmentFields
```

**Response mapping** (Bright Data → `EnrichmentFields`):
| Bright Data field | DB field |
|---|---|
| `experience[0].title` (current) | `job_title` |
| `current_company_name` | `current_company` |
| `city` | `current_city` |
| `education[0].school` | `school` |
| `education[0].field_of_study` | `major` |
| `experience[0].title` | `position_title` |

**Key design**: Reuse the existing `EnrichmentFields` interface and `sync_user_linkedin_enrichment` RPC — Bright Data is just a different data source feeding the same pipeline.

---

## Phase 3: Re-Sync API Route

### Modify: `src/app/api/user/linkedin/sync/route.ts`

Update the existing sync endpoint to:
1. Check if org has `linkedin_resync_enabled` (query org via user's membership)
2. Call `claim_linkedin_resync` RPC to enforce rate limit
3. Use Bright Data instead of Proxycurl for enrichment
4. Return remaining sync count in response

**Flow:**
```
POST /api/user/linkedin/sync
  1. Auth check (existing)
  2. syncLinkedInProfile() — OAuth profile sync (existing, unchanged)
  3. Query user's org → check linkedin_resync_enabled
  4. If enabled: call claim_linkedin_resync RPC
  5. If allowed: run Bright Data enrichment (replaces Proxycurl)
  6. Return { message, remaining_syncs }
```

**Fallback**: If Bright Data is not configured (`BRIGHT_DATA_API_KEY` missing), fall back to existing Proxycurl enrichment. This keeps backward compatibility.

### New endpoint for rate limit status:

Add to existing `src/app/api/user/linkedin/status/route.ts`:
- Return `resync_count`, `resync_month`, `remaining_syncs`, `resync_enabled` (org toggle)

---

## Phase 4: Quarterly Cron Job

### New file: `src/app/api/cron/linkedin-bulk-sync/route.ts`

Follow existing cron pattern from `src/app/api/cron/integrations-sync/route.ts`:

```
GET /api/cron/linkedin-bulk-sync
  1. validateCronAuth(request)
  2. createServiceClient()
  3. Query orgs WHERE linkedin_resync_enabled = true
  4. For each org:
     a. Query all members/alumni with user_linkedin_connections
     b. Batch by MAX_CONCURRENCY = 5
     c. For each user:
        - If linkedin_url exists → fetchBrightDataProfile(url)
        - Else → searchBrightDataProfile(first_name, last_name, email)
        - mapBrightDataToFields() → sync_user_linkedin_enrichment RPC
     d. Track: { userId, status: 'ok'|'not_found'|'error', source: 'url'|'search' }
  5. Return { processed, results }
```

**Vercel cron config** (`vercel.json`): Run quarterly — `0 2 1 1,4,7,10 *` (1st of Jan/Apr/Jul/Oct at 2am UTC)

**Concurrency**: Process 5 profiles at a time per org to avoid Bright Data rate limits. Sequential across orgs.

**Does NOT count against user's 2/month rate limit** — the cron operates with service client and bypasses the `claim_linkedin_resync` RPC.

---

## Phase 5: Org Settings Toggle UI

### Modify: `src/app/api/organizations/[organizationId]/route.ts`

Add `linkedin_resync_enabled` to the PATCH schema and update handler. Follow the existing pattern for `job_post_roles`, `feed_post_roles`, etc.

### Modify: Org settings UI page

Add a toggle switch for "LinkedIn Re-Sync" in the org settings page where other feature toggles live. Show descriptive text: "Allow members to refresh their LinkedIn profile data (2 syncs/month per member)".

---

## Phase 6: UI — Sync Button + Status

### Modify: `src/components/settings/LinkedInSettingsPanel.tsx`

Update the existing "Sync Now" button to show:
- Remaining syncs this month (e.g., "2 of 2 remaining")
- Disabled state when rate limited, with tooltip "Limit reached — resets next month"
- Disabled when org hasn't enabled the feature
- Loading/success/error states

### Modify: `src/hooks/useLinkedIn.ts`

Update `onSync()` response handling to capture and display `remaining_syncs` from the API response.

### Modify: `src/app/api/user/linkedin/status/route.ts`

Add `resyncEnabled`, `resyncRemaining` fields to the status response so the UI can show the correct state on load.

---

## Files Summary

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/YYYYMMDD_linkedin_resync.sql` | New | Org toggle column + rate limit columns + RPC |
| `src/lib/linkedin/bright-data.ts` | New | Bright Data API client |
| `src/app/api/user/linkedin/sync/route.ts` | Modify | Add rate limit + Bright Data enrichment |
| `src/app/api/user/linkedin/status/route.ts` | Modify | Add resync status fields |
| `src/app/api/cron/linkedin-bulk-sync/route.ts` | New | Quarterly bulk sync cron |
| `src/app/api/organizations/[organizationId]/route.ts` | Modify | Add toggle to PATCH handler |
| `src/components/settings/LinkedInSettingsPanel.tsx` | Modify | Sync button with rate limit display |
| `src/hooks/useLinkedIn.ts` | Modify | Handle resync status in hook |
| `vercel.json` | Modify | Add quarterly cron schedule |

## Reusable Existing Code

- `EnrichmentFields` interface → `src/lib/linkedin/proxycurl.ts:42`
- `sync_user_linkedin_enrichment` RPC → existing migration
- `syncLinkedInProfile()` → `src/lib/linkedin/oauth.ts`
- `getLinkedInUrlForUser()` → `src/lib/linkedin/oauth.ts`
- `validateCronAuth()` → cron auth helper
- `checkRateLimit()` + `buildRateLimitResponse()` → `src/lib/security/rate-limit.ts`
- `checkOrgReadOnly()` → existing org helper
- Cron batching pattern → `src/app/api/cron/integrations-sync/route.ts`

## Verification

1. **Unit tests**: Bright Data client (mock fetch), rate limit RPC logic, field mapping
2. **Route tests**: Sync endpoint (rate limit enforcement, toggle check, fallback to Proxycurl)
3. **Cron tests**: Bulk sync (batching, error handling, org filter)
4. **Integration**: Toggle feature on → sync → verify fields updated → check remaining count
5. `npm run test` — full suite passes
6. `npm run lint` — clean
7. `npm run build` — no type errors
