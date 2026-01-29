This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

### Environment Variables

Copy `.env.local.example` to `.env.local` and fill in your values:

```bash
cp .env.local.example .env.local
```

Required environment variables:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only) |
| `STRIPE_SECRET_KEY` | Stripe secret API key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key |
| `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` | hCaptcha site key (get from [hCaptcha Dashboard](https://dashboard.hcaptcha.com/)) |
| `HCAPTCHA_SECRET_KEY` | hCaptcha secret key (server-side only) |
| `RESEND_API_KEY` | Resend API key for emails |
| `FROM_EMAIL` | Sender email for notifications (optional, default: noreply@myteamnetwork.com) |
| `ADMIN_EMAIL` | Admin notification recipient (optional, default: admin@myteamnetwork.com) |
| `NEXT_PUBLIC_APP_URL` | Application base URL |

### Development Server

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `src/app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Payments Idempotency

- All payment flows (subscriptions, donations, Connect onboarding) store an attempt row in `payment_attempts` keyed by `idempotency_key` (unique). Stripe objects reuse that row and every Stripe create call includes the same `idempotencyKey`.
- Webhooks are deduped via `stripe_events(event_id unique)`. Each event is recorded once; retries skip if `processed_at` is set.
- Clients keep a stable key in local storage per flow; server returns existing `checkout_url`/`session`/`payment_intent` if the same key is replayed.
- Troubleshooting: look up the attempt by `idempotency_key` to see status and any `last_error`; confirm the matching Stripe IDs; check `stripe_events` to see if the webhook ran.
- Tests: `npm run test:payments` runs idempotency + webhook dedupe unit tests (uses the lightweight TS loader in `tests/ts-loader.js`).

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
