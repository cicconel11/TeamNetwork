# TeamMeet - Next Steps

**Last Updated:** 2026-01-14

The monorepo migration is complete. All planned phases have been implemented. This document outlines the recommended next steps.

---

## Immediate Actions

### 1. Commit Current Changes

All migration work is complete but uncommitted. Create a commit for the final changes:

```bash
git add -A
git commit -m "feat: complete mobile app MVP with announcements feed"
```

### 2. Regenerate Supabase TypeScript Types

The TypeScript types in `packages/types/src/database.ts` may be out of sync with the production database schema. To regenerate:

```bash
# Login to Supabase CLI first
npx supabase login

# Generate types
npx supabase gen types typescript --project-id <your-project-id> > packages/types/src/database.ts
```

This ensures the `AlumniBucket` enum and other database types are current.

### 3. Test Mobile App

After dependencies are installed, test the mobile app:

```bash
npm run dev:mobile
```

Verify:
- [ ] Login with Google OAuth works
- [ ] Organization selection screen shows user's orgs
- [ ] Members tab displays org members with avatars
- [ ] News tab shows announcements (filtered by audience)
- [ ] Pull-to-refresh works on list screens

---

## Mobile App Enhancements

### Push Notifications

Implement push notifications for new announcements:

1. Install `expo-notifications`
2. Register device token with backend
3. Store tokens in `user_notification_tokens` table
4. Send notifications from web admin when creating announcements

### Events Calendar

Add events feature to mobile:

1. Create `useEvents.ts` hook
2. Build events list and detail screens
3. Add RSVP functionality
4. Consider calendar view with `react-native-calendars`

### Offline Support

Enable offline access:

1. Cache organization data locally
2. Use Supabase Realtime for live updates
3. Implement optimistic UI updates
4. Handle offline state gracefully

### Profile Editing

Allow users to update their profile:

1. Create profile edit screen
2. Upload avatar (via Supabase Storage)
3. Update name and contact info

---

## Web App Improvements

### ESLint Upgrade

The web app uses ESLint 8, but `eslint-config-next@16` requires ESLint 9+:

```bash
# In apps/web
npm install eslint@^9 eslint-config-next@16 --save-dev
```

Update `.eslintrc.json` for flat config format if needed.

### Update Next.js

Consider upgrading to Next.js 15 for:
- React 19 support (matches mobile)
- Improved performance
- New features

---

## Production Deployment

### Mobile: EAS Build Setup

1. Install EAS CLI: `npm install -g eas-cli`
2. Configure EAS: `cd apps/mobile && eas build:configure`
3. Create development build: `eas build --profile development --platform ios`
4. Submit to stores: `eas submit`

### Environment Variables

Ensure production environment variables are set:

**Mobile (EAS Secrets):**
```bash
eas secret:create --name EXPO_PUBLIC_SUPABASE_URL --value <production-url>
eas secret:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <production-key>
```

### App Store Preparation

- [ ] Create App Store Connect account
- [ ] Generate app icons (1024x1024)
- [ ] Create screenshots for all device sizes
- [ ] Write app description and keywords
- [ ] Set up privacy policy URL

---

## Code Quality

### Add Mobile Tests

Create tests for mobile hooks and screens:

```bash
cd apps/mobile
npm install --save-dev jest @testing-library/react-native
```

### Shared Package Tests

Add unit tests for shared packages:

```bash
cd packages/core
npm install --save-dev vitest
```

### CI/CD Pipeline

Set up GitHub Actions for:
- [ ] Web build verification on PR
- [ ] Mobile EAS build on merge to main
- [ ] Shared package tests
- [ ] Type checking across all workspaces

---

## Architecture Decisions to Consider

### State Management

Currently using local state in hooks. Consider:
- **Zustand** for global state (lightweight)
- **TanStack Query** for server state caching
- **Jotai** for atomic state

### Navigation

Current: Expo Router (file-based). Works well for MVP.

For complex navigation patterns, consider:
- Nested navigators for modals
- Deep linking configuration
- Navigation state persistence

### Styling

Current: React Native StyleSheet. Consider:
- **NativeWind** (Tailwind for RN) for consistency with web
- **Tamagui** for cross-platform components
- **React Native Paper** for Material Design

---

## Reference

| Document | Purpose |
|----------|---------|
| `docs/MIGRATION.md` | Migration status and structure |
| `abundant-fluttering-codd.md` | Original migration plan |
| `CLAUDE.md` | Development guidelines |
| `docs/db/schema-audit.md` | Database documentation |
