# Runbook

Operational procedures for TeamMeet production environment.

## Deployment

### Web App (Next.js)

The web app deploys via Vercel (or equivalent) on push to `main`.

```bash
# Verify build locally before pushing
bun build:web

# Run all tests
bun test

# Type check
bun typecheck
```

**Pre-deployment checklist:**
- [ ] All tests pass (`bun test`)
- [ ] Type check passes (`bun typecheck`)
- [ ] No hardcoded secrets in code
- [ ] Environment variables configured in hosting provider
- [ ] Stripe webhook endpoint registered for production domain

### Mobile App (Expo)

```bash
cd apps/mobile

# Build for iOS (EAS Build)
eas build --platform ios

# Build for Android (EAS Build)
eas build --platform android

# Submit to stores
eas submit --platform ios
eas submit --platform android
```

### Database Migrations

```bash
# Apply migrations to production
supabase db push --db-url <PRODUCTION_DATABASE_URL>

# Verify migration status
supabase migration list
```

## Environment Variables

### Required for Production

**Web:**
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` - Stripe publishable key
- `STRIPE_SECRET_KEY` - Stripe secret key
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook signing secret
- `STRIPE_BASE_PLAN_MONTHLY_PRICE_ID` + 7 tier/billing price IDs
- `RESEND_API_KEY` - Email service API key

**Mobile:**
- `EXPO_PUBLIC_SUPABASE_URL` - Supabase project URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key
- `EXPO_PUBLIC_POSTHOG_KEY` - PostHog analytics key
- `EXPO_PUBLIC_SENTRY_DSN` - Sentry error tracking DSN

## Monitoring

### Error Tracking

- **Web:** Check hosting provider logs (Vercel / equivalent)
- **Mobile:** Sentry dashboard for crash reports and exceptions
- **Analytics:** PostHog for user behavior and screen tracking

### Key Metrics

- Auth callback success rate (PKCE code exchange)
- Stripe webhook delivery and deduplication
- API response times
- Mobile app crash rate (Sentry)

## Common Issues and Fixes

### Stripe Webhooks Not Processing

**Symptoms:** Payments stuck in `initiated` state, subscriptions not activating.

**Check:**
1. Verify `STRIPE_WEBHOOK_SECRET` matches the Stripe dashboard
2. Confirm webhook endpoint is registered: `https://www.myteamnetwork.com/api/stripe/webhook`
3. Check `stripe_events` table for deduplication conflicts
4. Review Stripe dashboard webhook logs for failed deliveries

**Fix:**
```sql
-- Check recent webhook events
SELECT event_id, event_type, created_at
FROM stripe_events
ORDER BY created_at DESC
LIMIT 20;

-- Check stale payment attempts
SELECT id, status, created_at
FROM payment_attempts
WHERE status = 'initiated'
AND created_at < NOW() - INTERVAL '1 hour';
```

### Users Stuck in "Pending" State

**Symptoms:** User joined org but can't access content, redirected to `/app?pending=<slug>`.

**Check:** The `user_organization_roles` table for the user's status.

**Fix:**
```sql
-- Approve pending member
UPDATE user_organization_roles
SET status = 'active'
WHERE user_id = '<user-id>'
AND organization_id = '<org-id>'
AND status = 'pending';
```

### Mobile OAuth Callback Failing

**Symptoms:** User taps Google Sign-In or email link, app doesn't complete auth.

**Check:**
1. Sentry for `handleDeepLink-pkce` or `handleDeepLink-oauth-error` errors
2. Supabase redirect URLs include `teammeet://auth/callback`
3. `flowType: "pkce"` is set in `apps/mobile/src/lib/supabase.ts`

**Fix:** Verify the Supabase project's auth redirect URLs include the app's deep link scheme.

### Revoked Users Still Accessing Org

**Symptoms:** User with `status = 'revoked'` can still see org content.

**Check:** Middleware should redirect revoked users to `/app` with error. Verify:
1. `apps/web/src/middleware.ts` checks for revoked status
2. Mobile `useAnnouncements` hook filters by `.eq("status", "active")`

### Build Fails with `.next/types` Errors

**Symptoms:** `bun typecheck` fails with `Cannot find module` errors in `.next/types/`.

**Fix:** These are stale Next.js type cache references. Clean and rebuild:
```bash
rm -rf apps/web/.next
bun build:web
```

## Rollback Procedures

### Web App Rollback

1. Revert to previous deployment in hosting provider (Vercel: Deployments tab)
2. Or revert the git commit and push:
```bash
git revert HEAD
git push origin main
```

### Database Rollback

Supabase migrations are forward-only. To undo:
1. Write a new reverse migration
2. Test on staging first
3. Apply to production

```bash
# Create reverse migration
supabase migration new reverse_<migration_name>
# Edit the file with reverse SQL
supabase db push --db-url <PRODUCTION_DATABASE_URL>
```

### Mobile App Rollback

Mobile rollbacks require a new build submission:
1. Revert the code change
2. Bump version number
3. Build and submit to stores

For OTA-capable changes (JS-only, no native module changes):
```bash
eas update --branch production --message "Rollback: <reason>"
```

## Stripe Production Setup

See `docs/stripe-production-setup.md` for detailed Stripe configuration including:
- Connect account setup
- Webhook endpoint registration
- Price ID configuration for subscription tiers
- Donation flow setup

## Database Schema

See `docs/db/schema-audit.md` for comprehensive schema documentation including:
- Table definitions and relationships
- RLS policies
- Known issues and planned improvements
