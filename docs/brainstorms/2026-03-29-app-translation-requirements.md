---
date: 2026-03-29
topic: app-translation-i18n
---

# App Translation (i18n)

## Problem Frame
TeamMeet is English-only. Organizations with non-English-speaking members have no way to use the app in their language. Adding internationalization lets org admins set a default language and individual users override it, making the platform accessible to a global audience.

## Requirements

- R1. **i18n infrastructure using `next-intl`** — integrate next-intl with the Next.js App Router to support static JSON translation files per language
- R2. **Org-level default language** — org admins can set a default language in the customization settings; all members see the app in that language unless they override it
- R3. **User-level language override** — individual users can pick their preferred language in user settings, which takes precedence over the org default
- R4. **UI chrome translation only** — all app-controlled text (nav labels, buttons, form labels, system messages, error messages, placeholders, toasts) is translated; user-generated content is not
- R5. **String extraction** — all hardcoded English strings across the app are extracted into translation files with stable keys
- R6. **Launch with English + 3-5 languages** — ship with English as the source of truth plus 3-5 additional languages (e.g. Spanish, French, Arabic, Chinese, Portuguese)
- R7. **Language picker UI** — users can switch language via a dropdown/selector accessible from settings or a persistent UI element
- R8. **RTL support** — languages like Arabic render correctly with right-to-left text direction

## Success Criteria
- A non-English-speaking user can use the entire app in their language with no untranslated UI strings
- Org admin can set a default language in customization settings
- A user can override the org default with their own preference
- Adding a new language requires only adding a JSON file — no code changes

## Scope Boundaries
- **Out of scope**: translating user-generated content (posts, messages, events, form responses)
- **Out of scope**: AI-powered or third-party auto-translation services
- **Out of scope**: locale-specific formatting (dates, numbers, currency) — can be a follow-up
- **Out of scope**: URL-based locale routing (e.g. `/en/dashboard`, `/es/dashboard`)

## Key Decisions
- **Static JSON files over third-party platform**: free, simple, version-controlled, no external dependency
- **next-intl as the library**: best-in-class support for Next.js App Router, active maintenance, strong community
- **Org default + user override model**: flexible — works for homogeneous orgs and mixed-language orgs alike
- **No URL-based locale routing**: language is a user/org preference stored in the database, not a URL segment. Avoids rearchitecting routing.

## Dependencies / Assumptions
- Org settings table can store a `default_language` column
- User settings/profile can store a `preferred_language` column
- Translation quality for initial languages will be manually maintained (not auto-generated)

## Outstanding Questions

### Resolve Before Planning
- None

### Deferred to Planning
- [Affects R1][Needs research] Best pattern for integrating next-intl with Next.js App Router server components vs client components in this codebase
- [Affects R2][Technical] Where to store org default language — existing org table column vs org_settings
- [Affects R3][Technical] Where to store user language preference — user profile table vs separate preferences table
- [Affects R5][Technical] Strategy for extracting ~500+ hardcoded strings — incremental vs big-bang approach
- [Affects R6][User decision] Which specific 3-5 languages to include at launch
- [Affects R8][Needs research] Tailwind CSS RTL support approach (logical properties vs rtl: variant)

## Next Steps
→ `/ce:plan` for structured implementation planning
