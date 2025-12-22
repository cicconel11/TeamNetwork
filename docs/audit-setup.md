# Audit System Setup

## Environment Variables

Create a `.env.local` file (or your preferred env file) with the following variables for the audit system:

```bash
# Audit Configuration
# Base URL for the application under audit
AUDIT_BASE_URL=https://www.myteamnetwork.com

# Starting path for the audit (should redirect to login)
AUDIT_START_PATH=/testing123

# Credentials for audit user (read-only preferred)
AUDIT_EMAIL=audit@example.com
AUDIT_PASSWORD=your_audit_password_here

# Optional: Path to saved Playwright auth state
AUDIT_STORAGE_STATE=playwright/.auth/state.json

# Enable safe mode (blocks POST/PUT/PATCH/DELETE requests)
AUDIT_SAFE_MODE=true

# Supabase Configuration (if needed for backend audit)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## Running Audits

### Individual Audits

```bash
# Run UI crawler (safe mode enabled by default)
npm run audit:ui

# Run static route analysis
npm run audit:static

# Run backend schema audit
npm run audit:backend
```

### Complete Audit Suite

```bash
# Run all audits and generate combined report
npm run audit:all
```

## Generated Reports

All reports are saved to the `audit/` directory:

- `report.json` / `report.md` - UI crawl results
- `static-inventory.json` / `static-inventory.md` - Static route analysis
- `backend_report.json` / `backend_report.md` - Backend schema audit
- `combined_report.json` / `combined_report.md` - Combined summary report

## Safe Mode

The UI crawler includes **SAFE MODE** by default, which:

- Blocks all `POST`, `PUT`, `PATCH`, and `DELETE` requests
- Allows only safe endpoints (session refresh, etc.)
- Prevents accidental data modification during audits
- Logs all blocked requests in the report

## Prerequisites

1. Install Playwright browsers:
   ```bash
   npx playwright install
   ```

2. Ensure you have a read-only test user account for the audit

3. Verify the staging URL and credentials work manually first

## CI/CD Integration

The audit scripts are designed to work in CI/CD pipelines. Make sure to:

1. Set the required environment variables
2. Install Playwright browsers in your CI environment
3. Run `npm run audit:all` as part of your deployment pipeline

## Troubleshooting

### UI Crawler Issues

- **Login fails**: Verify `AUDIT_EMAIL` and `AUDIT_PASSWORD` are correct
- **Redirect issues**: Check that `AUDIT_START_PATH` redirects to login as expected
- **Safe mode blocks legitimate requests**: Add allowed endpoints to the allowlist in the crawler

### Backend Audit Issues

- **MCP connection fails**: Ensure Supabase credentials are configured
- **Permission errors**: The audit user needs read access to system tables

### Static Analysis Issues

- **Missing routes**: Check that Next.js routes are properly defined
- **False positives**: Some dynamic links may be flagged incorrectly



