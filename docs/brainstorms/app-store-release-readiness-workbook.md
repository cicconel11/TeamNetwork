---
date: 2026-05-02
topic: app-store-release-readiness
purpose: execution workbook — fill this in App Store Connect / ops (do not treat as legal advice)
requirements_source: docs/brainstorms/app-store-release-readiness-requirements.md
---

# App Store Release Readiness Workbook

Use this alongside `app-store-release-readiness-requirements.md`. Requirements IDs **R1–R20** match that document.

## Repo constants (verify before submit)

| Item | Value |
| --- | --- |
| ascAppId (EAS submit) | `6764461380` (`apps/mobile/eas.json`) |
| Bundle ID | `com.myteamnetwork.teammeet` |
| Privacy policy URL (config) | `https://www.myteamnetwork.com/privacy` (`extra.privacyPolicyUrl` / app config) |
| iPad screenshots | Required unless tablet support is disabled and a new build is shipped (`supportsTablet: true`) |

**Config note:** Expo merges `app.config.ts` over `app.json`. Keep `ios.buildNumber` (and marketing `version`) consistent in both files before relying on local introspection.

---

## R1 — App Store Connect metadata audit

| Field | Status (complete / gap / unsure) | Blocker or polish | Owner | Notes |
| --- | --- | --- | --- | --- |
| App name | | | | |
| Subtitle | | | | |
| Description | | | | |
| Keywords | | | | |
| Primary / secondary category | | | | |
| Support URL | | | | Must work logged out (R3) |
| Privacy policy URL | | | | Must match practices (R4) |
| Copyright | | | | |
| App availability / territories | | | | |

---

## R2 — Listing accuracy

- [ ] Primary reader / promise agreed (see requirements Outstanding Questions).
- [ ] No claims for flows absent from the **exact build** submitted for review.
- [ ] Feature list matches `docs/MOBILE-PARITY.md` (or consciously omit unsupported areas from copy).

Draft notes:

---

## R3–R4 — Support & privacy URLs

| URL | Purpose | Opens without auth | Matches actual behavior |
| --- | --- | --- | --- |
| Support | | ☐ | ☐ |
| Privacy | https://www.myteamnetwork.com/privacy | ☐ | ☐ |

Supporting references in-repo: `docs/data-safety.md` (Android-oriented but useful evidence), `docs/Data_Inventory.md`.

---

## R5–R9 — Screenshots & preview assets

### Storyboard (R6)

| # | Target viewer | Screen / flow | Message | Demo data needed | Avoid claiming |
| --- | --- | --- | --- | --- | --- |
| 1 | | | | | |
| 2 | | | | | |

### ASC checklist per set (R5, R7)

| Locale | Device class | Size req | Count | Orientation | Source build # | Demo org/account | Pass/Fail |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | iPhone | | | | | | |
| | iPad | | | | | | |

### Synthetic data rules (R8)

Confirm no real emails, phones, minors’ data, donor/payment artifacts, PMs, invite tokens, or internal org IDs appear in screenshots, preview video, or review attachments.

---

## R10 — Privacy nutrition labels (evidence matrix)

For each **Apple data category** used in App Store Connect, record:

| Apple category | Collected? | Linked to user? | Used for tracking? | Purpose | Processor/SDK | Retention / deletion note | Evidence (doc path / code area) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | |

Seed from `docs/data-safety.md` §2–§3; reconcile with **iOS** behavior (permissions in `app.config.ts` / `app.json`).

---

## R11 — Age rating & content rights

- [ ] Messaging / feed / discussions reflected honestly.
- [ ] Donations / payments reflected.
- [ ] Youth/parent flows reflected.

Notes:

---

## R12 — User-generated content

| Control | In submitted build? | Where in app | Notes for reviewer |
| --- | --- | --- | --- |
| Report content | | | |
| Block users | | | |
| Moderation / removal path | | | |
| Published safety / Terms coverage | | | |

---

## R13 — Payments & donations (Apple policy classification)

| Flow | What user pays | Recipient | Digital unlock? | IAP vs external rationale | Test steps | Review note snippet |
| --- | --- | --- | --- | --- | --- | --- |
| Org subscription | | | | | | |
| Donation (Stripe Connect) | | | | | | See `docs/stripe-donations.md` |

---

## R14 — Account deletion

| Question | Answer |
| --- | --- |
| Where users delete account | |
| Profile data handling | |
| Memberships | |
| UGC handling | |
| Donation/payment records | |
| Legal retention | |
| Support escalation | |

---

## R15 — Youth / parent / child privacy

| Topic | Classification | Follow-up |
| --- | --- | --- |
| Minors can register? | | |
| Minor PII collected | | |
| Parental consent / approval | | |
| Age gating | | |
| Privacy label impact | | |

---

## R16–R17 — App Review notes (paste into ASC)

**Demo account (store credentials outside git — use ASC secret fields or encrypted vault)**

- Email/username:
- Password:
- Org slug / invite path reviewer should use:

**Isolation / reset**

- Demo org ID/name:
- Reset procedure before submission:
- Post-review rotation/disable:

**Reviewer steps**

1.
2.
3.

**Third-party / permissions**

- Sign in with Apple / Google:
- Push notifications:
- Deep links tested:

---

## R18 — Exact-build smoke test (production-facing)

Build tested (TF build # / version):

| Check | Pass/Fail | Notes |
| --- | --- | --- |
| Login with reviewer demo account | | |
| Sign in with Apple | | |
| Account deletion path | | |
| Deep links (`associatedDomains` / scheme) | | |
| Permission prompts sane | | |
| Donation/payment path (if enabled for demo org) | | |
| Gated org routes Apple may hit | | |

---

## R19–R20 — Release candidate decision

| Criteria | Result |
| --- | --- |
| Listing blockers cleared | |
| Exact-build smoke test | |
| Tester feedback | |
| Needs new production build? | Why / why not |

**Decision:** Submit build ______ — Yes / No — Date ______ — Owner ______

