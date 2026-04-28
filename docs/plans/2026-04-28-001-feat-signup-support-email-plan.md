---
title: "feat: Surface support email on signup confirmation recovery"
type: feat
status: active
date: 2026-04-28
---

# feat: Surface support email on signup confirmation recovery

## Summary

Add `mleonard@myteamnetwork.com` contact line to two signup-recovery surfaces (`/auth/link-expired` page, signup "didn't receive email?" block) and the Supabase confirm-signup email template. Reuses the existing support address; one shared i18n key drives both UI surfaces.

---

## Requirements

- R1. Stuck signup users see a support contact on `/auth/link-expired` if resend keeps failing.
- R2. Stuck signup users see a support contact in the post-submit "didn't receive email?" block on `/auth/signup`.
- R3. The actual confirmation email contains a support contact line (manual Supabase template edit).
- R4. Reuse the existing `mleonard@myteamnetwork.com` address — no new email, no env var, no contact form.
- R5. Localized: en + es.

---

## Scope Boundaries

- No new endpoint, no contact form, no support widget.
- No changes to landing/marketing pages.
- No changes to auth/login/reset flows beyond the two recovery surfaces above.
- Supabase email template edit is a manual dashboard step — not code.

---

## Context & Research

### Relevant Code and Patterns

- Existing support address in `src/app/page.tsx:449`, `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`, `src/app/blog/**`, `src/app/demos/page.tsx` — all render `mleonard@myteamnetwork.com` as `mailto:` anchor.
- i18n keys for the recovery flow live under `auth.*` in `messages/en.json` (line 145+) and `messages/es.json` mirror.
- Surfaces to update:
  - `src/app/auth/link-expired/LinkExpiredClient.tsx` — under resend button + back-to-sign-in link.
  - `src/app/auth/signup/SignupClient.tsx` — inside the post-submit `submittedEmail` "didn't receive email?" block.

### Institutional Learnings

- Pattern: reuse `mleonard@myteamnetwork.com` rendered as anchor with `hover:underline`, see `src/app/privacy/page.tsx:334`.

---

## Key Technical Decisions

- **Single i18n key with `{email}` interpolation** vs split key per surface: use one key, `auth.supportContact`, value `"Still stuck? Email {email}"` — reduces duplication; both surfaces inject the same constant.
- **Hardcode email constant in TS** (not env var): address is already hardcoded in 8+ places; introducing env var now is scope creep.
- **Render as `mailto:` anchor**, not plain text — matches every other support reference in the app.

---

## Implementation Units

- U1. **Add i18n key for support contact line**

**Goal:** New `auth.supportContact` key in en + es with `{email}` placeholder.

**Requirements:** R1, R2, R5

**Dependencies:** None

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/es.json`

**Approach:**
- Add key `supportContact` under `auth.*` section, near `linkExpiredBody`.
- en: `"Still stuck? Email {email}"`.
- es: `"¿Sigues con problemas? Escribe a {email}"`.

**Test scenarios:**
- Test expectation: none — i18n key addition, no behavior.

**Verification:**
- `npm run lint` clean. Both locale files parse as valid JSON.

---

- U2. **Render support line on `/auth/link-expired`**

**Goal:** Add support contact under the resend button on the link-expired page.

**Requirements:** R1, R4

**Dependencies:** U1

**Files:**
- Modify: `src/app/auth/link-expired/LinkExpiredClient.tsx`

**Approach:**
- Inside the `Card`, after the resend `Button` and before the "Back to sign in" link, add a small muted paragraph rendering `t.rich("supportContact", { email: <a href="mailto:mleonard@myteamnetwork.com">mleonard@myteamnetwork.com</a> })` (or string concat with a separate anchor — pick whichever the existing `next-intl` setup supports cleanly).
- Style: `text-center text-sm text-white/50`, anchor `text-white hover:underline`, mirroring sibling back-to-sign-in link.
- Define email constant once at module top: `const SUPPORT_EMAIL = "mleonard@myteamnetwork.com";`.

**Patterns to follow:**
- Existing back-to-sign-in `Link` block in same file.
- `mailto:` anchor pattern from `src/app/privacy/page.tsx:334`.

**Test scenarios:**
- Happy path: render page → support line visible with `mailto:mleonard@myteamnetwork.com` href.
- Edge: locale=es → Spanish copy renders.

**Verification:**
- Manual: load `/auth/link-expired`, see support line, click → mail client opens with correct address.

---

- U3. **Render support line in signup "didn't receive email?" block**

**Goal:** Add support contact below the existing resend block in `SignupClient`.

**Requirements:** R2, R4

**Dependencies:** U1

**Files:**
- Modify: `src/app/auth/signup/SignupClient.tsx`

**Approach:**
- Inside the `submittedEmail && (...)` block, after the `resendMessage` paragraph, add muted support line. Same constant + same i18n key as U2.
- Style consistent with existing `text-white/70` block container.

**Patterns to follow:**
- Existing structure of the `submittedEmail` block in `SignupClient.tsx:381-402`.

**Test scenarios:**
- Happy path: submit signup → "didn't receive email?" block renders with support line.
- Edge: locale=es → Spanish copy.
- Regression: existing resend button + captcha-gate still work.

**Verification:**
- Manual: complete signup → see support line under resend block.

---

- U4. **Update Supabase "Confirm signup" email template** *(manual, out-of-code)*

**Goal:** User edits Supabase email template to include support line.

**Requirements:** R3

**Dependencies:** None

**Files:** none (dashboard-only)

**Approach:**
- Supabase Studio → Authentication → Email Templates → "Confirm signup".
- Append to body: `If you have trouble signing in, contact <a href="mailto:mleonard@myteamnetwork.com">mleonard@myteamnetwork.com</a>.`
- Save. Send test email. Verify rendering.

**Test scenarios:**
- Test expectation: none — manual config change, captured here for traceability.

**Verification:**
- User triggers signup with a fresh address, opens received email, sees support line + working `mailto:` link.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `next-intl` rich-text interpolation differs from project convention | Inspect existing `t.rich` or interpolation usage in repo before U2; fall back to template-string + separate anchor if needed. |
| Email template edit forgotten | U4 listed explicitly so it doesn't fall through cracks. |
| Support email changes later | Hardcoded in 9+ places already; if/when consolidated, refactor all at once. Out of scope here. |

---

## Documentation / Operational Notes

- Update `docs/runbooks/stuck-signup.md` to mention the support contact line is now visible to users on the recovery surfaces (so support team knows what users see before contacting them). Optional, low priority.

---

## Sources & References

- Existing support email refs: `src/app/page.tsx:449`, `src/app/privacy/page.tsx:334`, `src/app/terms/page.tsx:308`.
- Recovery flow PR: commit `ff227048` (Add signup confirmation resend recovery).
- Runbook: `docs/runbooks/stuck-signup.md`.
