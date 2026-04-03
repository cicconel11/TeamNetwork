TeamNetwork is a multi-tenant Next.js application for organization membership, alumni directories, communication, scheduling, payments, and enterprise administration.

## Getting Started

This repository expects Node.js 22 or newer for the built-in `fs.globSync`
APIs used by the test discovery scripts.

Copy `.env.local.example` to `.env.local` and fill in the values your local environment needs:

```bash
cp .env.local.example .env.local
```

Core environment variables:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SITE_URL` | Canonical application base URL |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `STRIPE_SECRET_KEY` | Stripe secret API key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key |
| `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` | hCaptcha site key |
| `HCAPTCHA_SECRET_KEY` | hCaptcha secret key |

Build-time Stripe price validation also expects:

- `STRIPE_PRICE_BASE_MONTHLY`
- `STRIPE_PRICE_BASE_YEARLY`
- `STRIPE_PRICE_ALUMNI_0_250_MONTHLY`
- `STRIPE_PRICE_ALUMNI_0_250_YEARLY`
- `STRIPE_PRICE_ALUMNI_251_500_MONTHLY`
- `STRIPE_PRICE_ALUMNI_251_500_YEARLY`
- `STRIPE_PRICE_ALUMNI_501_1000_MONTHLY`
- `STRIPE_PRICE_ALUMNI_501_1000_YEARLY`
- `STRIPE_PRICE_ALUMNI_1001_2500_MONTHLY`
- `STRIPE_PRICE_ALUMNI_1001_2500_YEARLY`
- `STRIPE_PRICE_ALUMNI_2500_5000_MONTHLY`
- `STRIPE_PRICE_ALUMNI_2500_5000_YEARLY`
- `STRIPE_PRICE_ENTERPRISE_ALUMNI_BUCKET_MONTHLY`
- `STRIPE_PRICE_ENTERPRISE_ALUMNI_BUCKET_YEARLY`
- `STRIPE_PRICE_ENTERPRISE_SUB_ORG_MONTHLY`
- `STRIPE_PRICE_ENTERPRISE_SUB_ORG_YEARLY`

Useful optional variables:

- `STRIPE_WEBHOOK_SECRET_CONNECT`
- `CRON_SECRET`
- `RESEND_API_KEY`
- `FROM_EMAIL`
- `ADMIN_EMAIL`
- `ALERT_EMAIL_TO`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_TOKEN_ENCRYPTION_KEY`
- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- `LINKEDIN_TOKEN_ENCRYPTION_KEY`
- `SKIP_STRIPE_VALIDATION=true` for local development without real Stripe price IDs

## Development

```bash
npm run dev
npm run build
npm run lint
npm run test
npm run test:unit
npm run test:security
npm run test:payments
npm run test:routes
npm run test:schedules
npm run test:e2e
npm run gen:types
```

Open [http://localhost:3000](http://localhost:3000) after `npm run dev`.

## Payments Idempotency

- All payment flows store a `payment_attempts` row keyed by `idempotency_key`.
- Stripe webhooks are deduplicated in `stripe_events`.
- Clients reuse stable keys so replayed requests return the existing checkout/session result.
- `npm run test:payments` covers the core idempotency and webhook dedupe paths.

## Error Reporting

- Client and server errors are sent to `POST /api/telemetry/error`.
- Error grouping is fingerprint-based.
- `ADMIN_EMAIL`, `FROM_EMAIL`, and `RESEND_API_KEY` enable production alert delivery.
- Hourly baseline updates run through `/api/cron/error-baselines`.

## Audit Tooling

The repo still includes audit helpers under `scripts/audit/` plus audit-oriented Playwright configuration, but there are currently no `npm run audit:*` wrappers in `package.json`.

Manual entry points:

```bash
node scripts/audit/static-routes.js
node scripts/audit/backend-audit.js
node scripts/audit/report.js
```

`playwright.config.ts` still defines an `audit-crawler` project, but the repository does not currently include a committed `tests/audit/` suite.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Playwright Documentation](https://playwright.dev/)
- [Stripe Docs](https://stripe.com/docs)
