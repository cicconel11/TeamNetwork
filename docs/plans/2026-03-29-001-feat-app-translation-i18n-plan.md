---
title: "feat: Add App Translation (i18n) with next-intl"
type: feat
status: active
date: 2026-03-29
origin: docs/brainstorms/2026-03-29-app-translation-requirements.md
---

# feat: Add App Translation (i18n) with next-intl

## Overview

TeamMeet is English-only. This feature adds full internationalization using `next-intl` with static JSON translation files, org-level default language, and per-user language override. Cookie-based locale resolution (no URL routing). Launch with English + Spanish, French, Arabic, Chinese (Simplified), Portuguese.

**PR 1 (infrastructure) is already merged.** This plan covers PRs 2–7.

## Problem Statement / Motivation

Organizations with non-English-speaking members have no way to use the app in their language. This limits adoption for international orgs. (see origin: `docs/brainstorms/2026-03-29-app-translation-requirements.md`)

## Key Decisions (from origin)

- **Static JSON files** over third-party platform — free, simple, version-controlled
- **next-intl** — best Next.js App Router support, active maintenance
- **Org default + user override** — flexible for homogeneous and mixed-language orgs
- **No URL-based locale routing** — language is a DB preference, not a URL segment
- **UI chrome only** — user-generated content stays in its original language
- **Out of scope**: locale-specific date/number formatting, email localization, AI response localization

## Proposed Solution

### Locale Resolution Chain

```
NEXT_LOCALE cookie → validate against SUPPORTED_LOCALES → load messages/{locale}.json
```

Cookie is synced from DB in middleware:
```
user.language_override → org.default_language → 'en' fallback
```

### Architecture

```mermaid
flowchart TD
    A[Request arrives] --> B[Middleware]
    B --> C{Authenticated?}
    C -->|No| D[Fallback: 'en']
    C -->|Yes| E{On org route?}
    E -->|Yes| F[get_org_context_by_slug RPC]
    F --> G{user.language_override set?}
    G -->|Yes| H[Use user override]
    G -->|No| I{org.default_language set?}
    I -->|Yes| J[Use org default]
    I -->|No| D
    E -->|No| K{user.language_override set?}
    K -->|Yes| H
    K -->|No| D
    H --> L[Set NEXT_LOCALE cookie]
    J --> L
    D --> L
    L --> M[i18n/request.ts reads cookie]
    M --> N[Load messages/{locale}.json]
    N --> O[NextIntlClientProvider renders]
```

## Technical Considerations

### Multi-Org Locale Switching

When a user without a personal override navigates between orgs with different defaults, the locale **will change per org**. The middleware recalculates on every org route. This may feel jarring but is the correct behavior per the resolution chain. Users who want consistency should set a personal override.

### Missing Translation Fallback

Configure `next-intl` with English fallback: if a key is missing in `es.json`, show the English string (not the raw key path). Add dev-mode console warning for missing keys.

**In `src/i18n/request.ts`:**
```ts
import enMessages from '../../messages/en.json';

export default getRequestConfig(async () => {
  // ... locale detection ...
  const userMessages = locale === 'en'
    ? enMessages
    : { ...enMessages, ...(await import(`../../messages/${locale}.json`)).default };

  return {
    locale,
    messages: userMessages,
    onError(error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[i18n]', error.message);
      }
    },
    getMessageFallback({ namespace, key }) {
      return `${namespace}.${key}`;
    },
  };
});
```

### Input Validation (Security)

The dynamic `import(\`../../messages/${locale}.json\`)` is protected by `SUPPORTED_LOCALES.includes()` validation. Additionally, add Zod schema validation at the DB write layer for `default_language` and `language_override` to prevent invalid values entering the database.

**In `src/lib/schemas/index.ts`:**
```ts
export const supportedLocaleSchema = z.enum(['en', 'es', 'fr', 'ar', 'zh', 'pt']);
```

### API Error Messages

API routes return hardcoded English error messages. These are **out of scope** for v1 — the frontend should translate known error patterns in the UI layer rather than localizing API responses. Toast messages triggered by API errors should use translation keys.

### Performance

- Middleware: zero extra DB queries — piggyback on existing `get_org_context_by_slug` RPC (extended to return language fields)
- Cookie: 1-year max-age, only rewritten when value changes
- Bundle: `next-intl` ~5kB gzipped; JSON messages loaded server-side per-request

## Implementation Phases

### Phase 1: Database + Middleware (PR 2)

**Migration: `supabase/migrations/20260329160000_add_language_preferences.sql`**

```sql
-- Org-level default language
ALTER TABLE organizations
  ADD COLUMN default_language text NOT NULL DEFAULT 'en';

ALTER TABLE organizations
  ADD CONSTRAINT chk_org_default_language
  CHECK (default_language IN ('en','es','fr','ar','zh','pt'));

-- User-level language override (null = use org default)
ALTER TABLE users
  ADD COLUMN language_override text DEFAULT NULL;

ALTER TABLE users
  ADD CONSTRAINT chk_user_language_override
  CHECK (language_override IS NULL OR language_override IN ('en','es','fr','ar','zh','pt'));
```

**Extend `get_org_context_by_slug` RPC** (`supabase/migrations/20260329160001_org_context_add_language.sql`):

Add `default_language` to the organization JSON returned by the RPC. Add user's `language_override` to the membership JSON (via join to `users` table on `auth.uid()`).

**Middleware locale sync** (`src/middleware.ts`, after org context resolution ~line 398):

```ts
// Compute effective locale from DB values
const userLangOverride = ctx?.membership?.language_override ?? null;
const orgDefaultLang = ctx?.organization?.default_language ?? null;
const effectiveLocale = userLangOverride || orgDefaultLang || 'en';

// Only set cookie if changed
const currentCookie = request.cookies.get('NEXT_LOCALE')?.value;
if (effectiveLocale !== currentCookie) {
  response.cookies.set('NEXT_LOCALE', effectiveLocale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}
```

For non-org routes (authenticated): query user's `language_override` directly:
```ts
const { data: userLang } = await supabase
  .from('users')
  .select('language_override')
  .eq('id', user.id)
  .maybeSingle();
```

**Update `src/i18n/request.ts`**: Add English fallback merge and `onError` handler.

**Add Zod schema**: `supportedLocaleSchema` in `src/lib/schemas/index.ts`.

**Regenerate types**: `npm run gen:types` after migration.

**Files:**
- `supabase/migrations/20260329160000_add_language_preferences.sql` — **new**
- `supabase/migrations/20260329160001_org_context_add_language.sql` — **new**
- `src/middleware.ts` — edit (~line 398)
- `src/i18n/request.ts` — edit (fallback strategy)
- `src/lib/schemas/index.ts` — edit (add locale schema)
- `src/types/database.ts` — regenerate

### Phase 2: Language Picker UI (PR 3)

**Org-level: `LanguageCard` in customization page**

Follow existing card pattern from `src/app/[orgSlug]/customization/page.tsx` (e.g., timezone card at line ~405):
- Reuse `Select` component from `src/components/ui/Select.tsx`
- Admin-only: wrap in `{isAdmin && <LanguageCard ... />}`
- Show language names in native script: "English", "Español", "Français", "العربية", "中文", "Português"
- PATCH to `/api/organizations/{orgId}` with `{ default_language: value }`
- After save, clear `NEXT_LOCALE` cookie to force re-sync

**User-level: new `/settings/language` page**

Follow existing pattern from `src/app/settings/notifications/page.tsx`:
- Simple page: heading, description, Select dropdown, Save button
- Reads current `language_override` from `users` table
- Updates via Supabase client directly (authenticated user updating own row)
- After save, set `NEXT_LOCALE` cookie client-side + `router.refresh()` to re-render

**Files:**
- `src/app/[orgSlug]/customization/page.tsx` — edit (add LanguageCard)
- `src/app/settings/language/page.tsx` — **new**
- `src/components/settings/LanguageCard.tsx` — **new** (org-level card)

### Phase 3: Navigation String Extraction (PR 4)

Convert `src/lib/navigation/nav-items.tsx` from hardcoded labels to translation keys:

```ts
// Before
{ href: "/members", label: "Members", ... }

// After
{ href: "/members", labelKey: "nav.items.members", ... }
```

Update `OrgNavItem` type: `label` → `labelKey` (string, dot-path translation key).

Update consumers:
- `src/components/layout/OrgSidebar.tsx` — resolve `labelKey` via `useTranslations()`
- `src/components/layout/MobileNav.tsx` — same

Extract sidebar hardcoded strings:
- "TeamNetwork" → `nav.appName`
- "Member"/"Admin" role badge → `roles.activeMember` / `roles.admin`
- "Switch Organization" → `nav.switchOrg`
- "Sign Out" → `auth.signOut`

Extract `PageHeader.tsx`:
- "Back" → `common.back`

**Files:**
- `src/lib/navigation/nav-items.tsx` — edit
- `src/components/layout/OrgSidebar.tsx` — edit
- `src/components/layout/MobileNav.tsx` — edit
- `src/components/layout/PageHeader.tsx` — edit
- `messages/en.json` — edit (add `nav.appName`, `nav.switchOrg`)

### Phase 4: Page String Extraction (PR 5)

Extract strings from high-traffic pages (incremental, not exhaustive):

**Priority pages:**
- `src/app/[orgSlug]/customization/page.tsx` — title, descriptions, permission labels
- `src/app/[orgSlug]/layout.tsx` — status messages ("Access removed", "Pending admin approval")
- `src/app/[orgSlug]/page.tsx` — dashboard strings
- `src/app/auth/login/page.tsx`, `signup/page.tsx` — auth flow strings
- `src/app/settings/notifications/page.tsx` — settings strings

**Common component strings:**
- `src/components/ui/PermissionRoleCard.tsx` — role labels, help text, "Save permissions"
- Toast messages: update `showFeedback()` callers to use translation keys

**Pattern for server components:**
```ts
import { getTranslations } from 'next-intl/server';

export default async function Page() {
  const t = await getTranslations('customization');
  return <PageHeader title={t('title')} />;
}
```

**Pattern for client components:**
```ts
'use client';
import { useTranslations } from 'next-intl';

export function MyComponent() {
  const t = useTranslations('common');
  return <button>{t('save')}</button>;
}
```

### Phase 5: Remaining String Extraction (PR 6)

Extract strings from all remaining pages under `src/app/[orgSlug]/`:
- Members, Alumni, Parents, Calendar, Events, Announcements
- Feed, Discussions, Jobs, Media, Forms
- Philanthropy, Donations, Expenses, Records
- Messages/Chat, Mentorship, Workouts, Competition

Organize `messages/en.json` by page namespace:
```json
{
  "nav": { ... },
  "common": { ... },
  "members": { "title": "Members", "addMember": "Add Member", ... },
  "events": { "title": "Events", "createEvent": "Create Event", ... }
}
```

### Phase 6: RTL Support + Language Files (PR 7)

**RTL Layout Fixes:**

Key files needing RTL audit:
- `src/components/layout/MobileNav.tsx` (lines 45, 103-104) — `left-0` → `start-0`, transform direction
- `src/components/layout/OrgSidebar.tsx` — mostly flexbox (RTL-safe), verify fixed positioning
- `src/app/[orgSlug]/layout.tsx` — sidebar + main content layout direction

Tailwind logical property conversions:
| Physical | Logical |
|----------|---------|
| `pl-*`, `pr-*` | `ps-*`, `pe-*` |
| `ml-*`, `mr-*` | `ms-*`, `me-*` |
| `left-*`, `right-*` | `start-*`, `end-*` |
| `text-left`, `text-right` | `text-start`, `text-end` |
| `border-l-*`, `border-r-*` | `border-s-*`, `border-e-*` |

**Sonner Toaster:** Verify `position="bottom-right"` works correctly with `dir="rtl"`. If not, conditionally set position based on locale.

**User-generated content:** Add `dir="auto"` to content containers (posts, messages, comments) so LTR content renders correctly inside RTL layout.

**Language files:**

Create `messages/{es,fr,ar,zh,pt}.json` — initially copy structure from `en.json`, then translate. Each file must have all keys from `en.json` (the fallback merge handles missing keys gracefully, but aim for completeness).

**Translation key completeness script:** Add `scripts/check-translations.ts` that compares key sets across all locale files and reports missing keys. Run in CI.

**Files:**
- `src/components/layout/MobileNav.tsx` — edit
- `src/components/layout/OrgSidebar.tsx` — edit (if needed)
- `src/app/[orgSlug]/layout.tsx` — edit (if needed)
- `messages/es.json` — **new**
- `messages/fr.json` — **new**
- `messages/ar.json` — **new**
- `messages/zh.json` — **new**
- `messages/pt.json` — **new**
- `scripts/check-translations.ts` — **new**

## System-Wide Impact

- **Interaction graph**: Language change → cookie write → next request picks up new locale → root layout re-renders with new `lang`/`dir` → all `useTranslations`/`getTranslations` calls return new language strings. No callbacks or observers involved.
- **Error propagation**: If a message file fails to import (corrupt JSON), `next-intl` throws at render time. The fallback merge with `en.json` as base mitigates missing keys but not corrupt files.
- **State lifecycle risks**: Cookie and DB can diverge if middleware sync fails. Cookie is non-authoritative — re-synced on next org route visit. No orphaned state risk.
- **API surface parity**: The organizations PATCH API already handles arbitrary columns — adding `default_language` requires no new endpoint, just validation. User language override needs a similar update path.

## Acceptance Criteria

### Functional Requirements (from origin R1–R8)
- [ ] `next-intl` infrastructure wired and serving English from JSON (✅ PR 1 done)
- [ ] Org admins can set default language in customization (R2)
- [ ] Users can set preferred language in `/settings/language` (R3)
- [ ] All UI chrome (nav, buttons, labels, toasts, error messages) uses translation keys (R4, R5)
- [ ] App ships with en, es, fr, ar, zh, pt translation files (R6)
- [ ] Language picker shows native language names (R7)
- [ ] Arabic locale renders RTL layout correctly (R8)
- [ ] Missing translation keys fall back to English strings, not raw key paths
- [ ] Adding a new language requires only adding a JSON file — no code changes

### Non-Functional Requirements
- [ ] Middleware locale sync adds zero extra DB queries (piggybacked on existing RPC)
- [ ] `default_language` and `language_override` validated against `SUPPORTED_LOCALES` at write time
- [ ] Translation key completeness check in CI

## Success Metrics

- A non-English-speaking user can use the entire app in their language with no untranslated UI strings
- Org admin can set a default language in customization settings
- A user can override the org default with their own preference

## Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| String extraction is a massive effort (~200+ strings across 84 pages) | Incremental extraction over PRs 4-6; English fallback covers gaps |
| RTL layout breaks in unexpected components | Audit key layout components; `dir="auto"` on UGC containers |
| Missing translations in production | English fallback merge + CI completeness check |
| Multi-org locale switching feels jarring | Document behavior; users can set global override |
| Stale cookie after admin changes org default | Cookie re-syncs on next middleware pass (next page load) |

## Sources & References

### Origin
- **Origin document:** [docs/brainstorms/2026-03-29-app-translation-requirements.md](docs/brainstorms/2026-03-29-app-translation-requirements.md) — Key decisions: static JSON files, next-intl library, cookie-based locale (no URL routing), org default + user override model, UI chrome only

### Internal References
- Middleware: `src/middleware.ts` (org context at ~line 367)
- Org context RPC: `supabase/migrations/20260203140000_org_slug_performance.sql:22-87`
- Customization page pattern: `src/app/[orgSlug]/customization/page.tsx:405-430`
- User settings pattern: `src/app/settings/notifications/page.tsx`
- Nav items: `src/lib/navigation/nav-items.tsx:38-93`
- i18n config (PR 1): `src/i18n/request.ts`
- Root layout (PR 1): `src/app/layout.tsx`
- English messages (PR 1): `messages/en.json`
