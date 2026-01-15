# Mobile App Authentication Setup

This document covers authentication setup for the TeamMeet mobile app (Expo/React Native).

## Current Status

| Environment | Email/Password | Google OAuth |
|-------------|---------------|--------------|
| Expo Web (localhost:8081) | ✅ Works | ❌ Blocked |
| Expo Go (QR code) | ✅ Works | ❌ Blocked |
| Native Dev Build | ✅ Works | ✅ Works |
| Production Build | ✅ Works | ✅ Works |

**Why is Google OAuth blocked in Expo Go/Web?**
- OAuth requires deep link handling with custom URL schemes (`teammeet://`)
- Expo Go and Expo Web cannot register custom URL schemes
- OAuth callbacks would redirect to the production web app, not back to the mobile app

---

## Setting Up Google OAuth for Native Builds

### 1. Supabase Dashboard Configuration

Add the mobile deep link URL to allowed redirects:

1. Go to **Supabase Dashboard → Authentication → URL Configuration**
2. Under **Redirect URLs**, add:
   ```
   teammeet://(auth)/callback
   ```

### 2. Google Cloud Console Setup

Configure OAuth for mobile platforms:

**iOS:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/) → Credentials
2. Edit your OAuth 2.0 Client ID (or create one for iOS)
3. Add your iOS bundle identifier: `com.myteamnetwork.teammeet`

**Android:**
1. Create an OAuth 2.0 Client ID for Android
2. Add package name: `com.myteamnetwork.teammeet`
3. Add SHA-1 certificate fingerprint:
   ```bash
   # For debug keystore
   keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
   ```

### 3. Create Development Build with EAS

Install EAS CLI if not already installed:
```bash
npm install -g eas-cli
```

Configure EAS (first time only):
```bash
cd apps/mobile
eas build:configure
```

Build for iOS Simulator:
```bash
eas build --profile development --platform ios
```

Build for Android Emulator:
```bash
eas build --profile development --platform android
```

### 4. Install and Run Development Build

After the build completes:
```bash
# iOS - download and drag to simulator, or:
eas build:run -p ios

# Android - install APK, or:
eas build:run -p android
```

Start the dev server:
```bash
cd apps/mobile
bun expo start --dev-client
```

---

## Architecture Notes

### Authentication Flow (Native)
1. User taps "Sign in with Google"
2. `expo-web-browser` opens Supabase OAuth URL
3. User authenticates with Google
4. Supabase redirects to `teammeet://(auth)/callback#access_token=...`
5. App receives deep link via `expo-linking`
6. Tokens extracted and session set with Supabase client
7. `_layout.tsx` detects auth state change and navigates to app

### Key Files
- `apps/mobile/app/(auth)/login.tsx` - Google OAuth trigger
- `apps/mobile/app/(auth)/callback.tsx` - Deep link handler
- `apps/mobile/app/_layout.tsx` - Auth state management
- `apps/mobile/src/lib/supabase.ts` - Supabase client config

### Supabase Client Configuration
```typescript
// apps/mobile/src/lib/supabase.ts
export const supabase = createClient(url, key, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: "implicit",  // Required for mobile
  },
});
```

---

## Troubleshooting

### OAuth redirects to web app instead of mobile
- Ensure `teammeet://(auth)/callback` is in Supabase redirect URLs
- Verify you're using a native build, not Expo Go

### "Expo Go Limitation" alert appears
- Expected behavior - Google OAuth is intentionally blocked in Expo Go
- Use email/password login for testing, or create a development build

### Session not persisting after OAuth
- Check that `AsyncStorage` is properly configured
- Verify tokens are being extracted from the callback URL
- Check console logs for errors in token extraction
