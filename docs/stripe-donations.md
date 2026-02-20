# Stripe Connect Donations - Testing Guide

This document explains how to test the Stripe Connect donations flow locally using the Stripe CLI.
Donations are created on each organization’s connected Stripe account (via Checkout or Payment Intents); the app never touches funds.
Webhook events write into `organization_donations` and roll up totals in `organization_donation_stats` so dashboards stay in sync automatically.

## Prerequisites

1. Install the [Stripe CLI](https://stripe.com/docs/stripe-cli)
2. Ensure you have a Stripe account in test mode
3. Set up your `.env.local` with the required Stripe keys

## Local Webhook Forwarding

The Stripe CLI can forward webhook events from Stripe to your local development server.

### 1. Start webhook forwarding

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

When you run this command, the CLI will output a webhook signing secret like:
```
Ready! Your webhook signing secret is whsec_xxxxxxxxxxxxx
```

### 2. Update your environment

Copy the webhook signing secret and add it to your `.env.local`:

```env
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
```

> **Note:** The webhook secret from `stripe listen` is different from your dashboard's webhook secret. Use the CLI-provided secret when testing locally.

## Testing the Full Donation Flow

### 1. Start the development server

```bash
npm run dev
```

### 2. Complete Connect onboarding

1. Navigate to an organization's Philanthropy tab: `http://localhost:3000/{org-slug}/philanthropy`
2. As an admin, click "Set Up Stripe Account"
3. Complete the Stripe Connect Express onboarding (use test data)
4. You'll be redirected back with `?onboarding=success`

### 3. Make a test donation

1. On the Philanthropy or Donations page, use the donation form
2. Enter an amount (e.g., $25)
3. Optionally enter name and email
4. Click "Donate" (this calls `/api/stripe/create-donation` and opens Stripe Checkout)
5. In the Stripe Checkout page, use test card: `4242 4242 4242 4242`
   - Expiry: Any future date (e.g., 12/34)
   - CVC: Any 3 digits (e.g., 123)
6. Complete the payment
7. You'll be redirected back with `?donation=success`
8. The donation should appear in the "Recent Donations" section (admin view)

## Stripe CLI Trigger Commands (Optional)

You can manually trigger webhook events for testing:

```bash
# Trigger a successful payment intent
stripe trigger payment_intent.succeeded

# Trigger a failed payment intent
stripe trigger payment_intent.payment_failed
```

> **Important:** Events triggered via CLI won't include `metadata.organization_id`, so they won't create donation records. These are mainly useful for testing webhook connectivity.

## Test Cards

| Card Number | Description |
|-------------|-------------|
| `4242 4242 4242 4242` | Succeeds and immediately processes the payment |
| `4000 0000 0000 3220` | 3D Secure authentication required |
| `4000 0000 0000 9995` | Always fails with a decline code |

See [Stripe Testing Documentation](https://stripe.com/docs/testing) for more test cards.

## Troubleshooting

### Webhook events not arriving

1. Ensure `stripe listen` is running and connected
2. Check the terminal output for forwarded events
3. Verify `STRIPE_WEBHOOK_SECRET` matches the CLI output

### Connect onboarding fails

1. Ensure you're in Stripe test mode
2. Check that your platform has Connect enabled
3. Look for errors in the server console

### Console errors about CSP or frame-ancestors

1. Stripe-hosted pages (for example, `stripe.com`, `connect.stripe.com`, `docs.stripe.com`) cannot be embedded in iframes by design.
2. If a Stripe URL is added as an embed, the browser console may show `frame-ancestors` / CSP violations.
3. Use Link mode for Stripe URLs instead of iframe embeds.
4. `chrome-extension://...` console errors come from browser extensions and are not TeamNetwork app failures.

### Donation checkout fails

1. Ensure the organization has completed Connect onboarding
2. Check that `stripe_connect_account_id` is saved to the organization
3. Verify the Connect account is fully onboarded (not in restricted state)

## Environment Variables

Required environment variables for donations:

```env
# Already required for subscriptions
STRIPE_SECRET_KEY=sk_test_xxxxx
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx

# No additional variables needed for Connect donations
# The same webhook endpoint handles both subscription and donation events
```
