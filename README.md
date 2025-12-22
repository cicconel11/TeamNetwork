This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Audit System

This project includes a comprehensive automated audit system for QA and monitoring. The audit system crawls your application, analyzes the codebase, and audits the backend database schema.

### Quick Start

1. **Install Playwright browsers**:
   ```bash
   npm run audit:install
   ```

2. **Configure environment variables** (see `docs/audit-setup.md` for details):
   ```bash
   AUDIT_BASE_URL=https://www.myteamnetwork.com
   AUDIT_START_PATH=/testing123
   AUDIT_EMAIL=your-test-user@example.com
   AUDIT_PASSWORD=your-test-password
   AUDIT_SAFE_MODE=true
   ```

3. **Run complete audit**:
   ```bash
   npm run audit:all
   ```

### Audit Commands

- `npm run audit:ui` - Crawl UI and validate all reachable pages
- `npm run audit:static` - Analyze codebase for routes and hardcoded links
- `npm run audit:backend` - Audit database schema and performance issues
- `npm run audit:all` - Run all audits and generate combined report

### Generated Reports

Reports are saved to the `audit/` directory:
- `combined_report.md` - Executive summary with action items
- `report.md` - UI crawl results with screenshots of failures
- `static-inventory.md` - Code analysis results
- `backend_report.md` - Database audit findings

### Safe Mode

The UI crawler includes **SAFE MODE** by default, which prevents any destructive operations during audits by blocking POST/PUT/PATCH/DELETE requests.

See `docs/audit-setup.md` for complete setup instructions and troubleshooting.
