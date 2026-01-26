# Operations Runbook

Deployment procedures, monitoring, and incident response for TeamMeet.

## Deployment

### Web App (Next.js)

The web app deploys to Vercel automatically on push to `main`.

```bash
# Manual production build
bun build:web

# Preview deployment
vercel

# Production deployment
vercel --prod
```

### Mobile App (Expo)

```bash
cd apps/mobile

# Development build (internal testing)
eas build --profile development --platform ios
eas build --profile development --platform android

# Preview build (TestFlight/internal track)
eas build --profile preview --platform ios
eas build --profile preview --platform android

# Production build
eas build --profile production --platform ios
eas build --profile production --platform android

# Submit to stores
eas submit --platform ios
eas submit --platform android
```

### Database Migrations

```bash
# Apply migrations to staging
supabase db push --db-url $STAGING_DB_URL

# Apply migrations to production
supabase db push --db-url $PRODUCTION_DB_URL

# Generate types after migration
supabase gen types typescript --db-url $DB_URL > packages/types/src/database.ts
```

## Monitoring

### Health Checks

| Service | Endpoint | Expected |
|---------|----------|----------|
| Web App | `https://www.myteamnetwork.com` | 200 OK |
| Supabase | Dashboard | Green status |
| Stripe | Dashboard | Active |

### Error Tracking

- **Sentry** - Error monitoring for mobile app
- **PostHog** - Product analytics and session recordings
- **Vercel** - Web app logs and metrics

### Key Metrics

- API response times (p50, p95, p99)
- Error rates by endpoint
- Auth success/failure rates
- Payment success rates

## Common Issues

### 1. Supabase Connection Errors

**Symptoms:** `PGRST` errors, connection timeouts

**Resolution:**
1. Check Supabase dashboard for service status
2. Verify environment variables are correct
3. Check RLS policies aren't blocking requests
4. Verify JWT token is valid and not expired

```bash
# Test connection
curl -H "apikey: $SUPABASE_ANON_KEY" \
  "$SUPABASE_URL/rest/v1/organizations?limit=1"
```

### 2. Stripe Webhook Failures

**Symptoms:** Payments not processing, subscription status incorrect

**Resolution:**
1. Check Stripe webhook dashboard for failures
2. Verify webhook secret matches environment variable
3. Check `stripe_events` table for duplicates
4. Review webhook endpoint logs

```bash
# Test webhook locally
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

### 3. Mobile App Build Failures

**Symptoms:** EAS build fails, native module errors

**Resolution:**
1. Clear caches: `bun expo prebuild --clean`
2. Update Expo SDK: `bun expo upgrade`
3. Check native dependencies compatibility
4. Review EAS build logs

```bash
# Clean rebuild
cd apps/mobile
rm -rf node_modules ios android
bun install
bun expo prebuild --clean
```

### 4. Auth Session Issues

**Symptoms:** Users logged out unexpectedly, session errors

**Resolution:**
1. Check token expiration configuration
2. Verify refresh token flow
3. Clear AsyncStorage (mobile) or cookies (web)
4. Check Supabase auth settings

### 5. Mobile Tests Failing

**Symptoms:** Jest tests fail with module resolution errors

**Resolution:**
1. Ensure `@babel/runtime` is installed
2. Mock React Native modules before imports
3. Use `node` test environment for pure function tests
4. Component tests require E2E approach (Detox/Maestro)

```bash
cd apps/mobile
bun add -d @babel/runtime
bun test
```

## Rollback Procedures

### Web App Rollback

```bash
# Vercel - instant rollback via dashboard
# Or via CLI:
vercel rollback [deployment-url]
```

### Mobile App Rollback

1. For OTA updates: `eas update --branch production --rollback`
2. For native builds: Promote previous build in App Store Connect / Play Console
3. Emergency: Disable the app version in store dashboards

### Database Rollback

```bash
# Restore from backup
supabase db restore --timestamp "2024-01-01T00:00:00Z"

# Or apply reverse migration
supabase migration down
```

## Incident Response

### Severity Levels

| Level | Description | Response Time | Examples |
|-------|-------------|---------------|----------|
| P1 | Service down | < 15 min | Site inaccessible, payments broken |
| P2 | Major feature broken | < 1 hour | Auth failing, data corruption |
| P3 | Minor feature issue | < 4 hours | UI bugs, slow performance |
| P4 | Low impact | Next business day | Documentation, minor UI issues |

### Response Steps

1. **Acknowledge** - Confirm incident and severity
2. **Communicate** - Notify stakeholders
3. **Investigate** - Check logs, metrics, recent changes
4. **Mitigate** - Apply fix or rollback
5. **Resolve** - Verify fix, close incident
6. **Postmortem** - Document lessons learned

### Key Contacts

- **On-call:** Check PagerDuty/Opsgenie
- **Supabase Support:** support@supabase.io
- **Stripe Support:** support.stripe.com
- **Expo Support:** expo.dev/contact

## Security

### Secrets Rotation

| Secret | Rotation Frequency | Location |
|--------|-------------------|----------|
| Supabase Service Key | 90 days | Vercel env vars |
| Stripe Secret Key | 90 days | Vercel env vars |
| Webhook Secrets | On incident | Vercel env vars |
| Google OAuth | On incident | Vercel + EAS |

### Security Checklist

- [ ] All env vars in Vercel, not in code
- [ ] RLS policies enabled on all tables
- [ ] Rate limiting on auth endpoints
- [ ] CORS configured correctly
- [ ] Webhook signatures verified
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention (sanitized inputs)
