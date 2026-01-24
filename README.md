This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Repository Overview

- `apps/web`: Next.js web app (default `bun dev`, `bun build`).
- `apps/mobile`: Expo (React Native) mobile app.
- `packages/*`: shared packages (types, validation, core logic).

The monorepo uses **Turborepo** for task orchestration with caching and parallel execution.

## Getting Started

### Environment Variables

Copy `.env.local.example` to `.env.local` and fill in your values:

```bash
cp .env.local.example .env.local
```

#### Web app (`apps/web`)

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
| `NEXT_PUBLIC_APP_URL` | Application base URL (used for Google calendar OAuth callbacks) |
| `NEXT_PUBLIC_SITE_URL` | Public site URL used for Supabase auth redirects |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (calendar sync) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret (calendar sync) |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | 64-hex-char key for encrypting Google tokens |

#### Mobile app (`apps/mobile`)

Required environment variables:

| Variable | Description |
|----------|-------------|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL for Expo |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key for Expo |

### Development Server

Run the web development server:

```bash
bun dev
```

Run the mobile app with Expo:

```bash
bun dev:mobile
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the web result.

You can start editing the web page by modifying `apps/web/src/app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Auth & OAuth

- Web auth uses Supabase with `/auth/*` routes plus middleware-based guards. Login supports Google OAuth, password, and magic-link flows; password and magic-link logins require hCaptcha.
- Mobile auth uses Supabase Google OAuth via Expo Auth Session with the `teammeet` scheme.
- **Note**: The mobile app enforces strict authentication. Unauthenticated users are redirected to login. Currently, the login flow redirects to the main app dashboard, which may interrupt deep links.
- Google Calendar sync uses a separate Google OAuth app with scopes:
  - `https://www.googleapis.com/auth/calendar.events`
  - `https://www.googleapis.com/auth/userinfo.email`

## Styling

- Web UI uses Tailwind utility classes (see `apps/web/src/app/globals.css` and component `className` usage).
- Mobile UI uses React Native `StyleSheet` and standard style props.

## Mobile App Testing (Expo)

This section covers how to run and test the mobile app locally using Expo.

### Prerequisites

1. **Install EAS CLI** (for env management and builds):
   ```bash
   npm install -g eas-cli
   eas login
   ```

2. **Accept Xcode license** (required for iOS simulator):
   ```bash
   sudo xcodebuild -license
   ```

3. **Install Expo Go** on your iOS or Android device (for quick testing without a build).

### Environment Setup

Pull environment variables from EAS to your local machine:

```bash
cd apps/mobile
eas env:pull --environment development
```

This creates/overwrites `apps/mobile/.env.local` with the correct `EXPO_PUBLIC_*` variables.

### Running the Mobile App

**Option 1: Expo Go (fastest for UI iteration)**

```bash
cd apps/mobile
npx expo start
```

- Press `s` to switch to Expo Go mode.
- Scan the QR code **from inside the Expo Go app** (not the camera app).
- Logs appear in the same Metro terminal on your Mac.

**Option 2: iOS Simulator**

```bash
cd apps/mobile
npx expo start
```

- Press `i` to open iOS simulator.
- Requires Xcode and accepted license.

**Option 3: Development Build (for native modules)**

```bash
cd apps/mobile
eas build --profile development --platform ios
```

After build completes, install via `eas build:run`.

### Where to Find Logs

- **Metro terminal** (on your Mac): the primary source for all `console.log()` output from the app.
- **Debugger**: press `j` in Metro terminal to open Chrome DevTools for more detailed debugging.
- **On-device**: shake device to open Developer Menu, then choose "Debug Remote JS" to see logs in browser DevTools.

### OAuth Redirect Configuration (Supabase)

For Google OAuth to work in different environments, add these redirect URLs in **Supabase Dashboard > Authentication > URL Configuration > Redirect URLs**:

| Environment | Redirect URL Pattern |
|-------------|---------------------|
| Expo Go (local) | `exp://YOUR_LOCAL_IP:8081/--/auth/callback` |
| Expo Go (localhost) | `exp://localhost:8081/--/auth/callback` |
| Dev Client / Production | `teammeet://auth/callback` |
| Dev Client / Production | `teammeet://` |

Replace `YOUR_LOCAL_IP` with your machine's IP (shown in Metro output, e.g., `10.0.0.35`).

### Troubleshooting

#### "No organizations" showing

This usually means the app is not authenticated or authenticated as a different user than expected.

1. **Check Metro logs** for:
   - `hasSession: true` after login
   - `userId` matching the expected user

2. **Verify membership in Supabase SQL editor**:
   ```sql
   -- Find user by email
   SELECT id, email FROM auth.users WHERE lower(email) = lower('your@email.com');
   
   -- Check memberships for that user
   SELECT organization_id, role, status
   FROM public.user_organization_roles
   WHERE user_id = 'PASTE_USER_UUID_HERE';
   ```

3. **Confirm the join works**:
   ```sql
   SELECT o.id, o.name, uor.role, uor.status
   FROM public.user_organization_roles uor
   JOIN public.organizations o ON o.id = uor.organization_id
   WHERE uor.user_id = 'PASTE_USER_UUID_HERE'
     AND uor.status = 'active';
   ```

#### "Unable to resolve react-native-web" (Expo Web)

If you press `w` for web and see this error, install the web dependencies:

```bash
cd apps/mobile
npx expo install react-native-web react-dom
```

#### QR code shows "No usable data found"

- Make sure you're scanning from **inside the Expo Go app**, not the camera app.
- Press `s` in Metro to switch to Expo Go mode if it shows a development client URL.

#### Xcode / simctl errors

```bash
# Accept Xcode license
sudo xcodebuild -license

# Verify simctl works
xcrun simctl help
```

### EAS Commands Reference

```bash
# Authentication
eas login
eas whoami

# Environment variables
eas env:list
eas env:pull --environment development

# Builds
eas build --profile development --platform ios
eas build:run --platform ios

# Updates (OTA)
eas update --branch development --message "description"
```

## Payments Idempotency

- All payment flows (subscriptions, donations, Connect onboarding) store an attempt row in `payment_attempts` keyed by `idempotency_key` (unique). Stripe objects reuse that row and every Stripe create call includes the same `idempotencyKey`.
- Webhooks are deduped via `stripe_events(event_id unique)`. Each event is recorded once; retries skip if `processed_at` is set.
- Clients keep a stable key in local storage per flow; server returns existing `checkout_url`/`session`/`payment_intent` if the same key is replayed.
- Troubleshooting: look up the attempt by `idempotency_key` to see status and any `last_error`; confirm the matching Stripe IDs; check `stripe_events` to see if the webhook ran.
- Tests: `bun run test:payments` runs idempotency + webhook dedupe unit tests (uses the lightweight TS loader in `tests/ts-loader.js`).

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

