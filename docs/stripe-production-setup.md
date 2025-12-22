# Stripe Production Setup for MyTeamNetwork

## Live Price IDs (Verified via Stripe CLI)

These are the **LIVE** price IDs that must be set in Vercel environment variables:

| Env Variable | Live Price ID | Amount |
|--------------|---------------|--------|
| `STRIPE_PRICE_BASE_MONTHLY` | `price_1ScaUC41rYW58UhuH7nJ2EjK` | $10/month |
| `STRIPE_PRICE_BASE_YEARLY` | `price_1ScaVR41rYW58UhuQbGT2RSN` | $100/year |
| `STRIPE_PRICE_ALUMNI_0_200_MONTHLY` | `price_1ScaW441rYW58UhuLLsufvb6` | $10/month |
| `STRIPE_PRICE_ALUMNI_0_200_YEARLY` | `price_1ScaX941rYW58UhuGU7hbWIv` | $100/year |
| `STRIPE_PRICE_ALUMNI_201_600_MONTHLY` | `price_1ScaXy41rYW58Uhu5mxCcbV8` | $20/month |
| `STRIPE_PRICE_ALUMNI_201_600_YEARLY` | `price_1ScaYO41rYW58UhudE9esVpd` | $200/year |
| `STRIPE_PRICE_ALUMNI_601_1500_MONTHLY` | `price_1ScaYy41rYW58UhuQrMhwU3N` | $30/month |
| `STRIPE_PRICE_ALUMNI_601_1500_YEARLY` | `price_1ScaZR41rYW58UhuNw62b8jS` | $300/year |

## Required Stripe Keys

| Env Variable | Description |
|--------------|-------------|
| `STRIPE_SECRET_KEY` | Must start with `sk_live_` (NOT `sk_test_`, `rk_live_`, or `mk_`) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Must start with `pk_live_` |
| `STRIPE_WEBHOOK_SECRET` | Must be the secret for the LIVE webhook endpoint |

## Vercel Configuration Checklist

1. **Correct Project**: Set env vars on `teammeet` project (the one with domain `www.myteamnetwork.com`), NOT `teemmeet`

2. **Environment Variables**: Set all 11 variables above in Vercel → Settings → Environment Variables (Production)

3. **Redeploy**: After updating env vars, redeploy with **"Use existing Build Cache" UNCHECKED**

## Code Path Reference

- **Frontend**: `src/app/app/create-org/page.tsx`
  - Posts to `/api/stripe/create-org-checkout`
  
- **API Route**: `src/app/api/stripe/create-org-checkout/route.ts`
  - Logs diagnostic info at runtime
  - Uses `getPriceIds()` from `lib/stripe.ts`
  - Creates Stripe checkout session
  
- **Stripe Helper**: `src/lib/stripe.ts`
  - Reads all env vars via `requireEnv()`
  - Validates price IDs start with `price_`
  - Maps intervals/buckets to prices
  
- **Webhook Handler**: `src/app/api/stripe/webhook/route.ts`
  - Endpoint: `https://www.myteamnetwork.com/api/stripe/webhook`
  - Handles: `checkout.session.completed`, subscription events, invoice events

## Debugging in Production

Check Vercel logs for these diagnostic entries:

```
[create-org-checkout] Starting...
[create-org-checkout][diag] {
  secretKeyPrefix: 'sk_live_...',  // ← MUST show sk_live_, not sk_test_
  baseMonthly: 'price_1ScaUC41...',
  ...
}
[create-org-checkout] Creating Stripe session with prices: {...}
[create-org-checkout] Success! Checkout URL: https://checkout.stripe.com/...
```

If you see `sk_test_` in the logs, the production deployment is using test keys.

## Webhook Note

There are currently **two LIVE webhook destinations** pointing at `https://www.myteamnetwork.com/api/stripe/webhook` in the Stripe Dashboard. Consider consolidating to one to avoid potential double-processing of events.

## Verification Steps

1. Go to `https://www.myteamnetwork.com/app/create-org`
2. Fill out the form with a fresh slug
3. Click "Create Organization"
4. Check:
   - Vercel logs show `sk_live_` prefix
   - Stripe Dashboard → Developers → Logs (LIVE) shows successful `POST /v1/checkout/sessions`
   - You're redirected to Stripe Checkout (live mode)
   - After completing payment, webhook events appear in Stripe → Developers → Event destinations






