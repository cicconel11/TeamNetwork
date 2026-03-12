# Audit Tooling Setup

## Current Status

The repository still contains audit helper scripts under `scripts/audit/` and audit-specific environment variables in `playwright.config.ts`, but the old `npm run audit:*` wrappers are no longer present in `package.json`.

The Playwright config also still defines an `audit-crawler` project, but there is no committed `tests/audit/` suite at the moment.

## Environment Variables

Create a `.env.local` file with the variables you still need for manual audit runs:

```bash
AUDIT_BASE_URL=https://www.myteamnetwork.com
AUDIT_START_PATH=/testing123
AUDIT_EMAIL=audit@example.com
AUDIT_PASSWORD=your_audit_password_here
AUDIT_STORAGE_STATE=playwright/.auth/state.json
AUDIT_SAFE_MODE=true
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## Running the Remaining Audit Scripts

```bash
node scripts/audit/static-routes.js
node scripts/audit/backend-audit.js
node scripts/audit/report.js
```

## Playwright Audit Crawler

If you restore or add a `tests/audit/` suite, you can run the dedicated Playwright project manually:

```bash
npx playwright test --project=audit-crawler
```

## Generated Reports

Audit reports are written under `audit/`:

- `static-inventory.json` / `static-inventory.md`
- `backend_report.json` / `backend_report.md`
- `combined_report.json` / `combined_report.md`

If you also restore a UI crawl suite, expect Playwright artifacts in `audit/playwright-artifacts/`.

## Prerequisites

1. Install Playwright browsers:
   ```bash
   npx playwright install
   ```
2. Ensure the credentials and base URL you pass in are valid.
3. Create the `tests/audit/` suite before relying on the `audit-crawler` Playwright project.

## Troubleshooting

- Login failures usually mean `AUDIT_EMAIL` or `AUDIT_PASSWORD` is wrong.
- Redirect issues usually mean `AUDIT_START_PATH` is no longer a useful entry point.
- False positives in static analysis often come from dynamic routes or links assembled at runtime.
- Backend audit permission errors usually mean the Supabase credentials are incomplete.
