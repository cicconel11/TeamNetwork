---
date: 2026-03-24
topic: linkedin-resync
---

# LinkedIn Re-Sync via Bright Data

## Problem Frame

Members' LinkedIn data (job title, company, location, school, major) goes stale after initial sync. There's no way to refresh it — data only flows in on OIDC login or first OAuth connect. Admins have no visibility into whether job board posting URLs are still valid.

## Requirements

- R1. Users can trigger a LinkedIn profile re-sync from their profile, pulling fresh job title, company, location, school, major via Bright Data
- R2. Re-sync is rate-limited to 2 per user per calendar month (persisted in DB, not in-memory)
- R3. Quarterly cron re-syncs all org members' LinkedIn data — uses LinkedIn URL when available, falls back to Bright Data search by name + email for members without a URL
- R4. Same quarterly cron verifies all active job board posting `application_url` links are reachable, flags broken ones visibly to admins
- R5. Org admins can toggle the re-sync feature on/off in org settings (new boolean on `organizations` table)
- R6. Bright Data replaces Proxycurl as the enrichment provider for new syncs (existing Proxycurl code remains, not removed)

## Success Criteria

- Users see a "Sync LinkedIn" button with clear feedback on remaining syncs this month
- Quarterly cron completes within reasonable time for 500+ member orgs (batched, concurrent)
- Broken job URLs are flagged visibly to admins on the job board
- Feature can be toggled on/off without affecting existing data

## Scope Boundaries

- Does NOT auto-deactivate or expire stale job postings (URL verification only)
- Does NOT change existing OIDC login sync or OAuth connect flow
- Does NOT remove Proxycurl integration (coexists; Bright Data is the new default)
- Quarterly cron only processes orgs with the feature enabled

## Key Decisions

- **Bright Data over Proxycurl**: User decision — Bright Data is the new enrichment provider
- **2 syncs/month limit**: Prevents cost overruns while giving users enough flexibility
- **Search by name + email**: For members without a LinkedIn URL, quarterly cron searches by name + email via Bright Data (lower accuracy, but covers everyone)
- **Org admin toggle**: Follows existing pattern (like `job_post_roles`), no central feature flag system needed

## Outstanding Questions

### Deferred to Planning

- [Affects R1, R3][Needs research] Bright Data API contract — which product/endpoint for profile scraping vs search by name+email?
- [Affects R2][Technical] Where to store sync count — new table or columns on `user_linkedin_connections`?
- [Affects R4][Technical] How to flag broken job URLs — new column on `job_postings` or separate table?
- [Affects R3][Needs research] Bright Data rate limits and pricing tiers for bulk quarterly sync
- [Affects R1][Technical] Should re-sync overwrite user-edited fields or only NULL fields (current Proxycurl behavior)?

## Next Steps

→ `/ce:plan` for structured implementation planning
