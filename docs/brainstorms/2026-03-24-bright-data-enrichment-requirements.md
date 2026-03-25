---
date: 2026-03-24
topic: bright-data-linkedin-enrichment
---

# Replace ProxyCurl with Bright Data for LinkedIn Enrichment

## Problem Frame

Org admins bulk-import alumni via spreadsheets that include LinkedIn URLs, but imported records lack live professional data. The current ProxyCurl integration only enriches profiles one-at-a-time when users link their LinkedIn via OAuth — it doesn't run during bulk import. Admins want enriched alumni profiles (job info, job descriptions, education history) populated automatically so that when an alumni signs up, they claim a pre-existing, data-rich profile rather than starting from scratch.

## Requirements

- R1. **Replace ProxyCurl with Bright Data everywhere.** Remove all ProxyCurl API calls. The Bright Data provider handles both bulk import enrichment and individual OAuth-triggered enrichment. Single provider, single integration.

- R2. **Bulk import triggers background enrichment.** When an admin uploads a spreadsheet (CSV) of alumni with LinkedIn URLs, alumni records are created immediately from the spreadsheet data. Bright Data enrichment runs asynchronously in the background afterward, filling in profile fields as results arrive.

- R3. **Full profile extraction.** Bright Data enrichment pulls: current job title, company name, job description, current city, profile headline, summary/about, skills, complete work history (all positions with titles, companies, dates, descriptions), and complete education history (all schools, degrees, majors, years).

- R4. **Store enriched data on alumni records.** Enrichment results populate existing alumni columns (job_title, current_company, current_city, school, major, position_title) and new columns for additional fields (headline, summary, skills, work history, education history). Raw enrichment JSON is preserved for auditing.

- R5. **Email-based account claiming.** When a user signs up and their email matches an existing alumni record (with `user_id IS NULL`), automatically link their auth account to that alumni record. No confirmation step — the match is automatic.

- R6. **Enrichment status visibility.** Admins can see which alumni have been enriched, which are pending enrichment, and which failed (e.g., invalid LinkedIn URL, Bright Data error). Surface this in the alumni directory or import history.

- R7. **Graceful degradation.** If `BRIGHT_DATA_API_KEY` (or equivalent) is not configured, enrichment silently skips — same pattern as current ProxyCurl behavior. Bulk import still works without enrichment.

## Success Criteria

- Admin uploads a CSV with 50 alumni (name, email, LinkedIn URL) → all 50 records created → within minutes, profiles are enriched with live LinkedIn data including job descriptions and education history
- An alumni whose profile was pre-created via bulk import signs up with their email → they are automatically linked to the existing enriched profile
- ProxyCurl code is fully removed; `PROXYCURL_API_KEY` env var is no longer referenced

## Scope Boundaries

- **In scope:** Bright Data integration, bulk enrichment pipeline, account claiming, alumni directory enrichment status
- **Out of scope:** Enrichment for members (only alumni), real-time enrichment during import preview, enrichment refresh/re-sync scheduling, LinkedIn OAuth flow changes (beyond swapping the enrichment provider)
- **Out of scope:** UI for viewing full work/education history (store the data now, build display later)

## Key Decisions

- **Bright Data over ProxyCurl:** User decision — switching providers entirely, not maintaining both
- **Background enrichment over synchronous:** Keeps import fast; enrichment fills in over time
- **Email-match claiming with no confirmation:** Simple, low-friction; consistent with existing LinkedIn import email-matching logic
- **Full profile extraction:** Maximizes data captured; higher per-lookup cost but richer alumni profiles
- **Store-now, display-later for extended fields:** Work history and education history are stored as structured JSON; building UI to display them is deferred

## Dependencies / Assumptions

- Bright Data account is active with appropriate API access for LinkedIn profile scraping
- Bright Data API can accept LinkedIn URLs and return structured profile data (job history, education, etc.)
- Alumni email addresses in the spreadsheet are accurate enough for claim matching

## Outstanding Questions

### Resolve Before Planning
_(none — all product decisions resolved)_

### Deferred to Planning

- [Affects R2][Needs research] Which Bright Data API product/endpoint to use — Web Scraper API, Dataset API, or SERP API? What's the request/response format?
- [Affects R2][Technical] Background job architecture — use a Next.js API route with queue-like processing, or an external job runner? How to handle rate limits and retries?
- [Affects R3][Needs research] Exact field mapping from Bright Data's LinkedIn response schema to alumni columns
- [Affects R4][Technical] Schema design for storing full work history and education history (JSONB columns vs. separate tables)
- [Affects R5][Technical] Where in the auth/signup flow to check for unclaimed alumni records and link `user_id` — middleware, callback, or post-signup hook?
- [Affects R6][Technical] How to track enrichment status per alumni (new column, separate table, or derived from presence of enrichment data?)

## Next Steps

→ `/ce:plan` for structured implementation planning
