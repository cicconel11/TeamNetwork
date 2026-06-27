# Jobs domain

Org job board: posting, editing, soft-deleting job listings, plus intake of
job drafts parsed from an external source URL.

## Owns

- **components/** — `JobList`, `JobForm`, `JobDetail`, `JobsFilters` (UI).
- **server/** — `create-job`, `update-job`, `delete-job` (mutations + admin
  permission checks) and `source-intake` (`fetchJobSourceDraft` /
  `extractJobSourceDraft` — fetch + parse an external posting into a draft).

## Public API

Import from the barrel: `import { JobList, createJobPosting } from "@/domains/jobs"`.
Do not deep-import `server/` or `components/` from outside this domain.

## Not owned (shared infra, lives elsewhere)

- **Validation schemas** — still in `@/lib/schemas/jobs` (shared with the API
  routes and AI tools); splitting the `lib/schemas` barrel per-domain is a
  tracked follow-up, consistent with the other migrated domains.
- **AI assistant tools** — the `prepare-job-posting` tool definition lives in
  the central AI registry (`@/lib/ai/tools/registry`); it consumes this domain's
  `source-intake` via the barrel.
- **Routes & API** — pages under `src/app/[orgSlug]/jobs/` and routes under
  `src/app/api/jobs/*` stay in the App Router and import from this domain.
