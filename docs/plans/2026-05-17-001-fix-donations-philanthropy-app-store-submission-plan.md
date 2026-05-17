---
title: "Fix Donations & Philanthropy for App Store Submission"
type: fix
status: active
date: 2026-05-17
---

# Fix Donations & Philanthropy for App Store Submission

## Context

The 5-phase mobile-payments compliance work (commits `bd85fcd6`…`76492762`) landed:
native Apple Pay via Stripe Payment Sheet, Apple Wallet passes (member,
event, receipt), iOS billing scrub, donation eligibility gating on the
server, and a submission-notes doc. Those commits are on `main`, unpushed.

What still blocks a first-attempt App Review pass on iOS is **not** core
code — it is gap items that, individually small, will get the app
rejected under 3.1.1, 3.2.1(vi), or 5.1.1(v) if shipped as-is:

1. **Client-side eligibility gating is missing.** Donation entry points
   (`donations/index.tsx:380`, `philanthropy/index.tsx:776`) render the
   "Donate" / "Make a Donation" CTA on iOS regardless of
   `organizations.donation_eligible_ios`. Reviewer using a non-eligible
   test org sees a donate button → tap → 403 → looks broken. Even if not
   broken, surfacing a donate CTA for an unverified org weakens the
   3.2.1(vi) argument.
2. **Org eligibility is not exposed to the mobile client.** No selector,
   no field on the org context payload. Server enforces; client cannot
   pre-gate.
3. **Donation receipt-by-payment-attempt polling has no retry/timeout
   UX.** Webhook lag → 409 `{reason: "pending"}` → user sees "failed"
   and may not retry. Need bounded poll with progress and a manual
   retry button.
4. **No iOS-only "donations available on web" fallback** for ineligible
   orgs — required so we never leave a dead-end on iOS while still
   complying with 3.1.1 (no link to a paywall — fundraising page is
   not a paywall, but copy must be careful).
5. **Pre-submission verification has never been run end-to-end.**
   Submission checklist in `docs/app-store-submission.md` exists but
   no Apple Pay merchant ID is registered, no Pass Type ID certs are
   minted, no donation_eligible_ios test org exists, no demo video,
   no account-deletion smoke test on a fresh build.

The intended outcome of this plan: every code-side gate on the
submission checklist is satisfied, with explicit verification, and the
ops-side gates are sequenced and assigned so the team can submit
within one TestFlight cycle.

## Acceptance Criteria

- [ ] iOS clients fetch `donation_eligible_ios` per org and hide all
      donate CTAs when false; the Philanthropy screen still renders
      (campaign progress, story content) but the action card swaps to
      a non-promotional "Donations are managed on the web" notice with
      a Safari link to the org's web donation page — explicitly
      non-promotional, no amounts or "Donate Now" copy.
- [ ] On donation-eligible iOS orgs, the existing Payment Sheet flow
      remains the only path; no web fallback shown.
- [ ] Donation receipt polling waits up to 30s with a visible spinner
      and "We're finalizing your receipt…" copy, then exposes a
      manual "Try again" action. The Done button is always available;
      Wallet button shows once the receipt is ready.
- [ ] The Mobile Submission Pre-Flight checklist in
      `docs/app-store-submission.md` is executed and each box checked
      with evidence (paste log links, screenshot paths) under each
      item — not in the doc itself, in the PR/commit body.
- [ ] One TestFlight external-tester cycle completed against a real
      donation-eligible nonprofit org with a real Apple Pay test card,
      passing donation + add-receipt-to-Wallet + add-member-card-to-Wallet
      end-to-end on a physical iPhone.
- [ ] Account deletion (`(app)/(drawer)/delete-account.tsx`) verified
      end-to-end on a test account: confirms sign-out + record marked
      for deletion + email confirmation. Add a Detox or manual smoke
      to the pre-flight section if missing.

## Proposed Solution

### A. Expose eligibility to mobile

Add `donation_eligible_ios` to whichever org-context payload the mobile
client already fetches (likely `getOrgContext` in
`apps/web/src/lib/auth/roles.ts`, surfaced via the `/api/me` or
per-org bootstrap route — confirm at implementation time). One field,
no new RPC.

Mobile reads via the same hook that already gives it the current org;
expose as `org.donationEligibleIos: boolean`. No new fetch on the hot
path.

### B. Gate donation surfaces on iOS

In `apps/mobile/app/(app)/(drawer)/[orgSlug]/donations/index.tsx`
(line 380 region) and `…/philanthropy/index.tsx` (line 776 region):

```tsx
const showDonateCta = !(Platform.OS === "ios" && !org.donationEligibleIos);
```

When false on iOS:
- Donations index → render the campaign/history list unchanged, hide
  the "Make a Donation" button, show a neutral inline notice with
  `Linking.openURL(`https://www.myteamnetwork.com/${orgSlug}/donate`)`
  link labeled "Donate on web". No price mentions, no "Donate Now".
- Philanthropy index → action card renders the same notice in place
  of the "Donate" tile. Campaign content stays.

Allowed under Apple's 3.2.1(vi) charitable-donations carve-out and
3.1.1's reader-app reading: this is not steering away from IAP because
no IAP exists for the surface — it is steering to a real-world
charitable contribution flow for an org we have not verified as a
nonprofit. The copy must avoid "Donate Now" / "Click here to donate"
imperative language; "Donations are managed on the web" is safe.

### C. Receipt polling UX

`apps/mobile/app/(app)/(drawer)/[orgSlug]/donations/new.tsx` already
sets `succeededAttemptId` and renders the Wallet button. Wrap the
existing `AddToWalletButton` in a small state machine:

```tsx
type ReceiptState =
  | { kind: "polling"; attempt: number }
  | { kind: "ready" }
  | { kind: "timeout" };
```

- On `succeededAttemptId` set: HEAD-style probe to
  `/api/wallet/receipt/by-payment-attempt/${id}` every 3s, max 10
  attempts.
- 200 → `ready` → show Wallet button.
- 409 `pending` → keep polling.
- Other 4xx/5xx → `timeout` with a "Try again" button that resets to
  `polling`.
- Done button remains visible across all states so the user can leave.

Server route already returns 409 `{reason: "pending"}` — no server
change needed.

### D. Ineligible-org donation page on web (out-of-scope safeguard)

Confirm `apps/web/src/app/[orgSlug]/donate/page.tsx` (or equivalent)
exists and works for the orgs we will *not* mark `donation_eligible_ios`.
If missing for a target nonprofit, that org is silently broken on iOS
since the fallback link 404s. Add a quick smoke list to the pre-flight.

### E. Pre-submission verification, executed not just listed

Run the entire `docs/app-store-submission.md` checklist on a physical
device using a TestFlight build sourced from `eas:ios:production`.
Capture artifacts (screenshots, console logs, Stripe dashboard
payment IDs) and attach to the PR description for traceability.

Specifically:
- Apple Pay Merchant ID `merchant.com.myteamnetwork.teammeet` must be
  registered in ASC and paired with a Stripe-issued Payment Processing
  Certificate. Until this is done, Payment Sheet renders without
  Apple Pay on real devices.
- Pass Type ID certs (`pass.com.myteamnetwork.teammeet.{member,event,receipt}`)
  must be minted from the Apple Developer Portal and converted to
  the PEM env vars `APPLE_PASS_SIGNER_CERT_PEM`,
  `APPLE_PASS_SIGNER_KEY_PEM`, `APPLE_WWDR_CERT_PEM`. Without these,
  every wallet route returns 503 and the Add-to-Wallet buttons fail.
- Seed one test org with `donation_eligible_ios = true` plus its
  Stripe Connect KYC live, and one with `false` to exercise both
  branches.
- Record the 30s demo video from the pre-flight item.

### F. Account deletion smoke

`apps/mobile/app/(app)/(drawer)/delete-account.tsx` exists from prior
work. Verify on a throwaway account on TestFlight build:
1. Profile → Delete Account → confirmation.
2. User is signed out.
3. Backend marks the user for deletion (DB row + email confirmation).
4. Re-login fails with "account scheduled for deletion" message.

If any step fails, fix before submission. 5.1.1(v) is a hard rejection.

## Critical Files

**Modify:**
- `apps/mobile/app/(app)/(drawer)/[orgSlug]/donations/index.tsx` — gate
  CTA on iOS+eligibility, add web-fallback notice.
- `apps/mobile/app/(app)/(drawer)/[orgSlug]/philanthropy/index.tsx` —
  same gate on Donate action tile.
- `apps/mobile/app/(app)/(drawer)/[orgSlug]/donations/new.tsx` — add
  receipt polling state machine around `AddToWalletButton`.
- `apps/web/src/lib/auth/roles.ts` (or org-context payload source) —
  include `donation_eligible_ios` in the response.
- Mobile org-context hook (e.g. `apps/mobile/src/hooks/useOrgContext.ts`
  — verify exact path) — surface the new field.

**Reuse:**
- `apps/web/src/app/api/wallet/receipt/by-payment-attempt/[paymentAttemptId]/route.ts`
  — already returns 409 `pending`. No change.
- `apps/web/src/app/api/stripe/create-donation/route.ts` — already
  returns 403 `org_not_eligible_ios`. No change.
- `apps/mobile/src/components/wallet/AddToWalletButton.tsx` — already
  iOS-only. No change.
- `docs/app-store-submission.md` — operate against this checklist;
  do not duplicate it in the plan.

**No new tables / no new migrations.** All schema work shipped in
`20261206000000_organizations_donation_eligible_ios.sql`.

## Verification

**Code:**
- `bun run typecheck && bun run lint` (root) — clean.
- `bun --cwd apps/mobile typecheck && bun --cwd apps/mobile test` —
  442/442.
- `bun --cwd apps/web test:payments` — 11/11.

**Manual on physical iPhone via TestFlight:**
1. Sign in as a member of an org with `donation_eligible_ios=false`.
   - Donations tab: no "Make a Donation" button. Web fallback notice
     shown. Tapping notice opens Safari to the org's donate page.
   - Philanthropy tab: campaign content visible, Donate tile replaced
     by notice.
2. Sign in as a member of an org with `donation_eligible_ios=true`.
   - Donations tab: button present, opens donation form.
   - Submit $1 donation via Apple Pay test card.
   - Payment Sheet completes in-app, no Safari redirect.
   - Receipt screen shows spinner < 10s, then Wallet button.
   - Tap → `.pkpass` opens Wallet, pass installs.
   - Verify in Stripe Dashboard: PI on the connected account,
     `application_fee_amount` set, `payment_attempts` row in
     `succeeded`, `organization_donations` row exists.
3. Add member card to Wallet from Profile → installs.
4. RSVP to an event → Event detail → "Add ticket to Apple Wallet" →
   installs.
5. Profile → Delete Account → completes, sign-out, re-login blocked.
6. Confirm billing screen on iOS: no prices, no "Upgrade", no $/month.

**App Review submission readiness:**
- All boxes in `docs/app-store-submission.md` § "Submission Pre-Flight"
  checked with evidence.
- ASC App Privacy section matches the table in that doc.
- Reviewer notes pasted from § "App Review Information → Notes".
- Test account credentials filled in.
- 30s demo video attached.

## Risks

- **Reviewer interprets the "Donations are managed on the web" notice
  as anti-steering** under 3.1.1. Mitigation: the donation surface is
  not a digital-goods paywall; we have precedent in the 3.2.1(vi)
  carve-out. If rejected, remove the fallback notice entirely on iOS
  for ineligible orgs (leave only campaign content; no link) and
  resubmit — that is unambiguous compliance.
- **Stripe Apple Pay cert delay**: Stripe issues the Payment Processing
  Certificate from Dashboard → Settings → Apple Pay. Allow 1 business
  day for first-time setup before scheduling the TestFlight cycle.
- **Pass Type ID cert handling**: PEM env vars are sensitive. Use
  Vercel encrypted env vars + EAS secrets only; never commit. Rotation
  is out of scope here but should be calendared (yearly).

## Sources

- Existing submission notes: `docs/app-store-submission.md`
- Donation server: `apps/web/src/app/api/stripe/create-donation/route.ts`
- Receipt server: `apps/web/src/app/api/wallet/receipt/by-payment-attempt/[paymentAttemptId]/route.ts`
- Receipt builder: `apps/web/src/lib/wallet/receipt.ts`
- Prior plan (implemented): `~/.claude/plans/i-want-you-to-deep-flamingo.md`
- Apple App Store Review Guidelines §3.1.1, §3.1.3(d), §3.2.1(vi), §5.1.1(v) (2026)
