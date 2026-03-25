---
title: "feat: Replace ProxyCurl with Bright Data for LinkedIn Enrichment"
type: feat
status: active
date: 2026-03-24
origin: docs/brainstorms/2026-03-24-bright-data-enrichment-requirements.md
---

# Replace ProxyCurl with Bright Data for LinkedIn Enrichment

## Overview

Replace ProxyCurl with Bright Data as the sole LinkedIn enrichment provider. Add background enrichment after bulk CSV import so admin-uploaded alumni with LinkedIn URLs are automatically enriched with full profile data (job history, descriptions, education, skills, headline, summary). Enable email-based account claiming so alumni can sign up and inherit their pre-populated, enriched profile.

## Problem Statement / Motivation

Org admins bulk-import alumni via spreadsheets with LinkedIn URLs, but imported records lack live professional data. ProxyCurl only enriches one-at-a-time during OAuth — never during bulk import. Admins want data-rich alumni profiles available immediately, and alumni should claim pre-existing profiles on signup rather than starting from scratch. (see origin: `docs/brainstorms/2026-03-24-bright-data-enrichment-requirements.md`)

## Proposed Solution

### Phase 1: Bright Data Adapter + ProxyCurl Replacement

Create `src/lib/linkedin/bright-data.ts` as the new enrichment provider. Replace all ProxyCurl references across the codebase. Use Bright Data's **sync endpoint** (`POST /datasets/v3/scrape`) for individual enrichment (OAuth connect, manual sync, URL save) and **async trigger endpoint** (`POST /datasets/v3/trigger`) for bulk enrichment.

**Bright Data API details:**
- Dataset ID: `gd_l1viktl72bvl7bjuj0` (LinkedIn Profiles)
- Auth: `Authorization: Bearer <BRIGHT_DATA_API_KEY>`
- Sync: `POST https://api.brightdata.com/datasets/v3/scrape?dataset_id=gd_l1viktl72bvl7bjuj0&format=json` — returns results inline (1-min timeout, falls back to 202 + snapshot_id)
- Async: `POST https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_l1viktl72bvl7bjuj0&format=json` — returns `{snapshot_id}`, poll via `GET /datasets/v3/progress/{snapshot_id}` and `GET /datasets/v3/snapshot/{snapshot_id}`
- Request body: JSON array of `[{"url": "https://linkedin.com/in/..."}]`
- Rate limits: up to 1,500 concurrent requests (≤20 URLs each), 100 concurrent (>20 URLs each)

### Phase 2: Database Schema for Extended Enrichment

New migration adding columns to `alumni` table:
- `headline text` — LinkedIn headline
- `summary text` — About/summary section
- `skills text[]` — Skills list
- `work_history jsonb` — Full work history array `[{title, company, description, start_date, end_date, location}]`
- `education_history jsonb` — Full education history array `[{school, degree, field, start_year, end_year, description}]`
- `enrichment_status text` — `'pending' | 'enriched' | 'failed' | 'skipped'`, default NULL
- `enriched_at timestamptz` — When enrichment last completed
- `enrichment_error text` — Error message if failed

New RPC: `enrich_alumni_by_id(p_alumni_id uuid, p_organization_id uuid, p_headline text, p_summary text, ...)` — updates a single alumni record by ID (not user_id), scoped to org. Required because bulk-imported alumni have `user_id IS NULL`.

Update existing RPC: `sync_user_linkedin_enrichment` — add new fields (headline, summary, skills, work_history, education_history) and optional `p_overwrite boolean DEFAULT false` so manual sync can force-refresh stale data.

### Phase 3: Background Enrichment via Cron

Follow the existing `ai-embed-process` pattern — a cron job that polls for unprocessed records:

1. During CSV/LinkedIn import: set `enrichment_status = 'pending'` for rows with `linkedin_url`
2. New cron endpoint: `POST /api/cron/enrichment-process` (every 5 minutes via Vercel cron)
3. Cron picks up batches of `pending` alumni records (batch size ~20-50)
4. Calls Bright Data async trigger for the batch
5. Polls for results (or processes inline if fast enough within serverless timeout)
6. Updates alumni records with enrichment data, sets `enrichment_status = 'enriched'` and `enriched_at`
7. On failure: sets `enrichment_status = 'failed'` and `enrichment_error`, allows retry on next cron run (max 3 attempts)

### Phase 4: Account Claiming

The existing `handle_org_member_sync` DB trigger already handles this:
- When a user joins an org with `role = 'alumni'`, the trigger looks up alumni records by email
- If found with `user_id IS NULL`: links `user_id` to the existing alumni record
- The alumni then sees their pre-populated, enriched profile

**No new code needed for claiming.** The existing trigger covers this flow. Verify it works correctly with enriched records.

## Technical Considerations

### Architecture

- **Bright Data adapter** (`src/lib/linkedin/bright-data.ts`) mirrors ProxyCurl's interface: `fetchLinkedInEnrichment(linkedinUrl)` for sync, `triggerBulkEnrichment(urls)` for async, `mapBrightDataToFields(response)` for field mapping
- **Enrichment orchestrator** (`src/lib/linkedin/enrichment.ts`) — rename from `runProxycurlEnrichment` to `runEnrichment`, update all call sites
- **Cron worker** follows `ai-embed-process` pattern: `validateCronAuth` → query pending records → process batch → update status

### Bright Data Response Field Mapping

| Bright Data Field | Alumni Column |
|---|---|
| `position` / `current_company.title` | `job_title` |
| `current_company_name` / `current_company.name` | `current_company` |
| `city` / `location` | `current_city` |
| `position` (headline) | `headline` (new) |
| `about` | `summary` (new) |
| `experience[]` | `work_history` (new, JSONB) |
| `education[]` | `education_history` (new, JSONB) |
| (not reliably available) | `skills` (new, may be empty) |
| `experience[0].title` (current, no end_date) | `position_title` |
| `education[0].field` | `major` |
| `education[0].title` | `school` |

### Performance

- Sync enrichment (individual): ~1-3 seconds per call, acceptable for OAuth/manual sync
- Async enrichment (bulk): batched via cron, no user-facing latency impact
- Cron runs every 5 min, processes 20-50 records per run → 200-500 records/hour throughput

### Security

- `BRIGHT_DATA_API_KEY` stored as env var, never exposed client-side
- Cron endpoint protected by `CRON_SECRET` (existing pattern)
- Enrichment RPC uses `SECURITY DEFINER` with `SET search_path = ''` (existing pattern)
- Bulk enrichment scoped to importing org only (not cross-org)

### Multi-Tenant Considerations

- Bulk enrichment (cron): org-scoped — updates only the alumni record in the importing org
- Individual enrichment (OAuth/sync): continues updating all orgs for the user (existing behavior, user-initiated)
- `enrich_alumni_by_id` RPC requires both `p_alumni_id` AND `p_organization_id` for tenant isolation

## System-Wide Impact

### Interaction Graph

Import API → sets `enrichment_status = 'pending'` → Cron picks up → calls Bright Data → `enrich_alumni_by_id` RPC → updates alumni row. Separately: OAuth callback → `runEnrichment()` → Bright Data sync → `sync_user_linkedin_enrichment` RPC → updates members + alumni rows.

### Error Propagation

- Bright Data 429 → log warning, skip record, retry on next cron run
- Bright Data 400/404 → mark `enrichment_status = 'failed'`, set `enrichment_error`
- Bright Data timeout (202 on sync) → fall back to async polling pattern
- Network errors → catch, mark failed, retry on next cron run (max 3 attempts tracked via `enrichment_error`)

### State Lifecycle Risks

- **Race condition: enrichment vs. account claim** — Enrichment writes by `alumni.id`, not `user_id`. The claim trigger sets `user_id`. These are independent columns on the same row — no conflict. Both can happen concurrently without data loss.
- **Partial batch failure** — Each record is updated individually within the batch. Failures are per-record, not per-batch. The cron re-picks any `pending` or retryable `failed` records.

### API Surface Parity

- `src/lib/linkedin/proxycurl.ts` → replaced by `src/lib/linkedin/bright-data.ts`
- `runProxycurlEnrichment()` → renamed to `runEnrichment()` in `src/lib/linkedin/enrichment.ts`
- All 4 call sites updated: `callback.ts:177`, `sync/route.ts:40`, `url/route.ts:55`, `oauth.ts:564`

## Acceptance Criteria

### Functional Requirements

- [ ] `src/lib/linkedin/proxycurl.ts` is deleted; no references to `PROXYCURL_API_KEY` remain
- [ ] `src/lib/linkedin/bright-data.ts` implements `fetchLinkedInEnrichment()` and `mapBrightDataToFields()`
- [ ] Individual enrichment (OAuth connect, manual sync, URL save) uses Bright Data sync endpoint
- [ ] Bulk CSV import sets `enrichment_status = 'pending'` for rows with `linkedin_url`
- [ ] Cron job `/api/cron/enrichment-process` processes pending alumni in batches
- [ ] Alumni records are enriched with: job_title, current_company, current_city, headline, summary, work_history, education_history, school, major, position_title
- [ ] `enrichment_status` column shows `pending`, `enriched`, `failed`, or `skipped`
- [ ] Admin can see enrichment status in alumni directory
- [ ] Manual sync (Flow 4) force-refreshes all enrichable fields (overwrites non-NULL)
- [ ] Signup with matching email auto-links to existing enriched alumni record (existing trigger, verify)

### Non-Functional Requirements

- [ ] `BRIGHT_DATA_API_KEY` is optional — enrichment silently skips if not configured
- [ ] Enrichment failures do not block or break import
- [ ] Failed enrichments retry up to 3 times via cron
- [ ] Cron processes ≤50 records per run to stay within serverless timeout

### Quality Gates

- [ ] Tests for `mapBrightDataToFields()` mapping logic
- [ ] Tests for enrichment status transitions
- [ ] Tests for `enrich_alumni_by_id` RPC behavior
- [ ] Existing `proxycurl-enrichment.test.ts` updated/replaced for Bright Data
- [ ] Build passes with `SKIP_STRIPE_VALIDATION=true` and without `BRIGHT_DATA_API_KEY`

## Implementation Phases

### Phase 1: Bright Data Adapter (Foundation)
- Create `src/lib/linkedin/bright-data.ts` with types, API calls, field mapping
- Create `src/lib/linkedin/enrichment.ts` as the orchestrator (renamed from proxycurl-specific function)
- Update all 4 call sites to use new enrichment function
- Delete `src/lib/linkedin/proxycurl.ts`
- Update `next.config.mjs`: replace `PROXYCURL_API_KEY` with `BRIGHT_DATA_API_KEY`
- Update `CLAUDE.md` env var docs
- Update/replace `tests/proxycurl-enrichment.test.ts`

### Phase 2: Database Schema
- New migration: add columns to `alumni` table (headline, summary, skills, work_history, education_history, enrichment_status, enriched_at, enrichment_error)
- New RPC: `enrich_alumni_by_id`
- Update RPC: `sync_user_linkedin_enrichment` — add new fields + `p_overwrite` param
- Regenerate types: `npm run gen:types`

### Phase 3: Background Enrichment Pipeline
- Create `/api/cron/enrichment-process` route
- Add to `vercel.json` cron config (every 5 minutes)
- Modify CSV import route: set `enrichment_status = 'pending'` after import
- Modify LinkedIn import route: set `enrichment_status = 'pending'` after import
- Add retry logic (max 3 attempts)

### Phase 4: Admin Visibility
- Add enrichment status badge/column to alumni directory
- Add enrichment status filter to alumni list
- Show `enriched_at` timestamp for enriched records

### Phase 5: Verification
- Test bulk import → background enrichment → admin sees status
- Test signup → email match → auto-claim enriched profile
- Test OAuth connect → individual enrichment via Bright Data
- Test manual sync → force-refresh of stale data
- Test graceful degradation without `BRIGHT_DATA_API_KEY`

## Dependencies & Risks

- **Bright Data API availability** — external dependency; mitigated by graceful degradation
- **Bright Data response schema changes** — mitigated by raw JSON storage + typed mapper
- **Skills field may not be available** — Bright Data sample data shows no dedicated `skills[]` array; may need to parse from other fields or accept empty
- **Serverless timeout** — cron must complete within Vercel's function timeout; mitigated by small batch sizes

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-03-24-bright-data-enrichment-requirements.md](docs/brainstorms/2026-03-24-bright-data-enrichment-requirements.md) — Key decisions: replace ProxyCurl entirely, background enrichment, full profile extraction, email-match claiming, store-now display-later

### Internal References

- ProxyCurl adapter (to replace): `src/lib/linkedin/proxycurl.ts`
- Enrichment orchestrator: `src/lib/linkedin/oauth.ts:564-607`
- Enrichment call sites: `src/lib/linkedin/callback.ts:177`, `src/app/api/user/linkedin/sync/route.ts:40`, `src/app/api/user/linkedin/url/route.ts:55`
- Settings display: `src/lib/linkedin/settings.ts:98-108`
- CSV import: `src/app/api/organizations/[organizationId]/alumni/import-csv/route.ts`
- LinkedIn import: `src/app/api/organizations/[organizationId]/alumni/import-linkedin/route.ts`
- Enrichment migration: `supabase/migrations/20260707000000_members_enrichment_columns_and_rpc.sql`
- Account claim trigger: `handle_org_member_sync` in `supabase/migrations/20260412093000_alumni_quota_enforcement.sql:263-300`
- Cron pattern reference: `ai-embed-process` in `vercel.json`
- Env var config: `next.config.mjs:127-129`
- Existing tests: `tests/proxycurl-enrichment.test.ts`

### External References

- Bright Data LinkedIn Profiles API: `https://docs.brightdata.com/api-reference/web-scraper-api/social-media-apis/linkedin`
- Bright Data async trigger: `https://docs.brightdata.com/api-reference/web-scraper-api/asynchronous-requests`
- Bright Data sync scrape: `https://docs.brightdata.com/api-reference/web-scraper-api/synchronous-requests`
- Bright Data error codes: `https://docs.brightdata.com/datasets/scrapers/scrapers-library/error-list-by-endpoint`
- Sample response data: `https://github.com/luminati-io/LinkedIn-Scraper`
