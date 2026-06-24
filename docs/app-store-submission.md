# iOS App Store Submission Notes

Reference for the release team. Most fields are pasted directly into App Store
Connect; nothing here is consumed by code.

> **Companion doc:** [`app-review-reference.md`](./app-review-reference.md) — generic
> Apple App Review process, guideline numbers, timelines, and post-rejection
> levers (appeal / expedite / Bug Fix Submissions). **This** file is the
> TeamNetwork-specific playbook (real reviewer creds, our guideline citations,
> EAS/Vercel env gates). Use the reference for "how does Apple review work";
> use this file for "what do we paste and verify".

## App Review Information → Notes

```
TeamNetwork is a closed, invite-only platform for organizations (sports
teams, alumni associations, parent groups, nonprofits) to coordinate
their members. Reviewers need a test org to see the app populated; please
use the credentials below.

Test account
  Email:    test-reviewer@myteamnetwork.com
  Password: AppleReview2026!
  Orgs:     Villanova Women's Lacrosse (slug villanova-football) —
              use THIS org for the Apple Pay donation demo
              (donation_eligible_ios = true, Stripe Connect onboarded)
            University of Pennsylvania Sprint Football
              (slug university-of-pennsylvania-sprint-football) —
              fully populated demo org, every feature tab

Payment flows covered by Apple's exemptions, not StoreKit:

1) Organization subscriptions (alumni tier plans)
   - Apple Guideline 3.1.3(c) — Enterprise Services. The subscription is
     purchased by an organization administrator on behalf of the
     organization's members; payment is from an org budget, not by
     individual end users for digital content. The iOS app does not
     advertise prices, "upgrade" CTAs, or links to a paywall. Admins
     who want to change plans do so on the web.
   - Creating a new organization is a paid subscription, so on iOS it is
     NOT sold in-app. Tapping "Create Organization" on iOS shows a single
     "Open on web" button that hands off to the browser
     (myteamnetwork.com/app/create-org); no price, plan selection, or
     checkout appears in the iOS binary. This is intentional 3.1.1
     compliance, not an incomplete feature. Apple Pay is NOT used for
     organization creation or any subscription — only for donations
     (item 2).

2) Charitable donations
   - Apple Guideline 3.2.1(vi). In-app donations (native Apple Pay) are
     gated by the `donation_eligible_ios` flag, which ops sets ONLY for an
     organization after verifying its nonprofit status (501(c)(3)
     determination letter or international equivalent). Orgs whose
     nonprofit status is not confirmed are NOT flagged and cannot take
     donations inside the iOS app. Determination letters for flagged orgs
     are available on request.
   - TeamNetwork takes NO platform fee on donations. Funds route through
     Stripe Connect (direct charge) to the recipient organization's own
     Stripe account, minus only Stripe's standard processing fee;
     TeamNetwork is not the merchant of record for the donation.
   - Donors pay in-app via Apple Pay through Stripe's Payment Sheet.
     Donations are voluntary and do not unlock any digital content or
     functionality in the app.
   - Where to find Apple Pay (this is the PassKit integration App Review
     asked about under 2.1): sign in with the test account above, open the
     "Villanova Women's Lacrosse" org (slug villanova-football — it is
     donation_eligible_ios = true AND has an onboarded Stripe Connect
     account, so the Payment Sheet renders). Tap the org logo in the
     top-left to open the drawer, choose Money → Donations →
     "Make a Donation", enter any amount (e.g. 5), and tap
     "Donate with Apple Pay". Stripe's Payment Sheet opens with Apple Pay
     as a payment option.
       • IMPORTANT: for THIS test account the security captcha is skipped,
         so the reviewer is taken straight to the Payment Sheet — there is
         no challenge to solve. (Captcha still applies to all real donors.)
       • If the review device has no card in Apple Wallet, tapping Apple
         Pay shows the standard "Add Card to Apple Pay" sheet — that still
         demonstrates the Apple Pay integration. Adding any Apple Pay
         sandbox test card lets you complete a charge end to end.
       • Apple Pay only appears on iOS, only for orgs flagged
         donation_eligible_ios; other orgs fall back to a web-only message,
         which is why a reviewer testing a non-flagged org would not see it.

3) Apple Wallet
   - Member cards, event tickets, and donation receipts are issued as
     signed PassKit passes. Wallet is not used as a payment mechanism.

No other monetization exists in the iOS app. We do not offer paid
content, premium features, in-app currency, or any other digital
purchase to end users on iOS.

Contact for reviewer questions: mleonard@myteamnetwork.com
```

## Resolution Center reply — Guideline 2.1 (Apple Pay)

Paste this into **App Store Connect → (version) → App Review → Resolution
Center** when replying to a 2.1 "unable to verify Apple Pay" rejection. It
answers the reviewer's exact ask (where is Apple Pay) in the first line.

**Prerequisites before replying — verify ALL of these LIVE, every time**
(otherwise it bounces again; this is why builds 61→62→63 all failed). The
bypass *code* and the *production DB* state are correct — what breaks the
reviewer path is one of the external gates below silently returning a 4xx so
Apple Pay never renders. Verified-green-in-DB items are marked ✅; the rest
MUST be checked live before each resubmit:

- ✅ Demo org `villanova-football` (Villanova Women's Lacrosse):
  `donation_eligible_ios = true` AND `stripe_connect_account_id` set
  (`acct_1SkEaaKv9KV1FrU0`). Confirmed in prod. The reviewer account's OTHER
  org (Penn Sprint Football) is intentionally web-only — name the Villanova org
  in the reply so the reviewer doesn't open the wrong one.
- ✅ Reviewer account `test-reviewer@myteamnetwork.com` = user id
  `03c0b18b-ef47-46d8-a643-9ca9ecff0d0e`, email confirmed, admin of
  `villanova-football`. Confirmed in prod.
- **A. Stripe Connect onboarding** on `acct_1SkEaaKv9KV1FrU0` is fully live.
  There is NO cached status column — the server hits Stripe on every request,
  so this can lapse silently. If not all-true, donate returns 400 "Stripe
  onboarding is not completed" and Apple Pay never appears:
  ```bash
  stripe accounts retrieve acct_1SkEaaKv9KV1FrU0 \
    | grep -E '"charges_enabled"|"payouts_enabled"|"details_submitted"'
  # all three must be true
  ```
- **B. `APP_REVIEW_REVIEWER_USER_IDS`** set in **Vercel production** to
  `03c0b18b-ef47-46d8-a643-9ca9ecff0d0e` AND redeployed after setting (env
  changes need a fresh deploy to take effect). Unset/stale → no bypass →
  captcha → dead end:
  ```bash
  vercel env ls production | grep APP_REVIEW_REVIEWER_USER_IDS
  ```
- **C. `EXPO_PUBLIC_APP_REVIEW_EMAIL=test-reviewer@myteamnetwork.com`** present
  in the **EAS production build** that produced the selected build (env *value*,
  not just code). Absent → mobile never substitutes the sentinel token →
  captcha → dead end:
  ```bash
  eas env:list --environment production | grep EXPO_PUBLIC_APP_REVIEW_EMAIL
  ```
- The build selected on the version contains the captcha bypass +
  "Donate with Apple Pay" label: **1.0 (62) or later** (build 61 still shows the
  captcha). `app.config.ts` `buildNumber` is a stale local base — EAS
  auto-increments remotely, so check the real number in ASC/TestFlight.
- **D. Sign-In Required** filled with the reviewer creds AND a **screen
  recording of the Apple Pay sheet attached** (see Step 2 below). Always attach
  it — do not rely on the reviewer reproducing the gated flow.

```
Re: Guideline 2.1 — Apple Pay integration location

Thank you for the review. Apple Pay is integrated and is used for charitable
donations to verified nonprofit organizations, via Stripe's Apple Pay Payment
Sheet. Here is exactly where to find it.

Test account (required — TeamNetwork is invite-only, so the app is empty
without it):
  Email:    test-reviewer@myteamnetwork.com
  Password: AppleReview2026!

Steps to reach Apple Pay:
1. Sign in with the account above.
2. Open the "Villanova Women's Lacrosse" organization (this org is enabled for
   in-app donations and has a fully onboarded payment account, so the Payment
   Sheet renders).
3. Tap the organization logo in the top-left to open the drawer.
4. Choose Money -> Donations -> "Make a Donation".
5. Enter any amount (e.g. 5) and tap "Donate with Apple Pay".
6. Stripe's Payment Sheet opens with Apple Pay as a payment option.

Two notes to avoid a dead end:
- For this test account the security check (captcha) is skipped, so you go
  straight to the Payment Sheet — there is nothing to solve.
- If the review device has no card in Apple Wallet, tapping Apple Pay shows the
  standard "Add Card to Apple Pay" sheet — this still confirms the Apple Pay
  integration. Adding any Apple Pay sandbox card completes a donation end to end.

Apple Pay appears only on iOS and only for organizations verified as nonprofits
(Guideline 3.2.1(vi)); other organizations show a web-only message, which is
why a non-verified org would not display it. TeamNetwork takes no fee —
donations route directly to the organization's own Stripe account.

Separately, the PassKit framework is also used for Apple Wallet passes (member
cards, event tickets, donation receipts) — not as a payment mechanism.

A screen recording of the full flow (sign-in → Donate with Apple Pay → Payment
Sheet) is attached to this submission so you can confirm the integration even if
the review device has no Apple Pay card set up. Thank you.
```

## Add-for-review checklist (Step 2 — record the proof)

On a real device running the production-profile TestFlight build (1.0 (62)+):

1. Sign in as `test-reviewer@myteamnetwork.com`.
2. Open **Villanova Women's Lacrosse** → tap the org logo (top-left) → Money →
   Donations → "Make a Donation".
3. Enter $5 → tap **"Donate with Apple Pay"** → the Stripe Payment Sheet opens
   with Apple Pay and **no captcha challenge**.
4. **Screen-record 10–20s of this.** If no card is in Wallet, the standard
   "Add Card to Apple Pay" sheet still proves the integration — capture that.
5. Attach the recording to the version's App Review submission, then paste the
   reply above into Resolution Center.

⚠️ This routes a reviewer test donation through `villanova-football`'s LIVE
Connect account (a real customer, ~133 members). Refund the test charge in
Stripe after review. See "Submission Pre-Flight" for the standing
recommendation to provision a dedicated throwaway review org.

## Privacy → App Privacy

Declare these data types as collected, **linked to identity**, not used for
tracking:

| Category              | Item                  | Purpose         |
|-----------------------|-----------------------|-----------------|
| Contact Info          | Name, Email           | App Functionality, Account Management |
| Identifiers           | User ID               | App Functionality |
| User Content          | Photos, Messages      | App Functionality |
| Usage Data            | Product Interaction   | Analytics |
| Diagnostics           | Crash Data, Performance Data | Analytics |
| Purchases             | Other Financial Info (donation amount) | App Functionality |
| Sensitive Info        | None                  |                 |

**Tracking: NONE.** Set every data type's "Used to Track You?" to **No**. The
app ships two first-party SDKs — both are non-tracking under Apple's definition
(no advertising-data linkage, no data-broker sharing):

- **PostHog** (`posthog-react-native`) — product analytics → maps to *Usage Data
  → Product Interaction* above. Sends app/device/OS metadata + a random
  per-install UUID to **our own** PostHog instance. No IDFA is read
  (`expo-tracking-transparency` is not a dependency, so the binary cannot
  access it), no session replay, no cross-app identifier. Hardened/pinned in
  `apps/mobile/src/lib/analytics/posthog.ts`.
- **Sentry** (`@sentry/react-native`) — crash/error reporting → maps to
  *Diagnostics → Crash Data, Performance Data* above. `sendDefaultPii: false`;
  email / username / IP are stripped in `beforeSend`; a PII key-list is scrubbed
  from extras, tags, and breadcrumbs (`apps/mobile/src/lib/analytics/sentry.ts`).

Because neither SDK reads the IDFA or shares data with ad networks/brokers, **no
App Tracking Transparency prompt and no `NSUserTrackingUsageDescription` are
required or present.** Analytics are enabled by default in production
(opt-out in app settings; off entirely in dev). If a future change adds IDFA
collection, session replay, an ad SDK, or any data-broker egress, this
declaration must change to "Used to Track You? Yes" and an ATT prompt becomes
mandatory before init.

## App Information

| Field                  | Value |
|------------------------|-------|
| Primary Category       | Social Networking |
| Secondary Category     | Sports |
| Support URL            | https://www.myteamnetwork.com/support |
| Marketing URL          | https://www.myteamnetwork.com |
| Privacy Policy URL     | https://www.myteamnetwork.com/privacy |
| Copyright              | © Teamra LLC |
| Age Rating             | 13+ (see questionnaire answers below) |

> **Age-rating system (current, 2025–2026).** Apple replaced the old
> 4+/9+/12+/17+ brackets with **4+ / 9+ / 13+ / 16+ / 18+** and a new
> questionnaire (In-App Controls, Capabilities, sensitive-content frequency).
> Re-answering was required by **Jan 31, 2026** — answer the new questionnaire
> before the next submission or App Store Connect will block it. **12+ no
> longer exists; do not select it.**
>
> **Target rating: 13+.** TeamNetwork is a moderated social app with
> user-generated chat/feed/discussions. Under the new questionnaire, UGC and
> messaging alone map to 4+, but possible infrequent profanity in member chat
> pushes the conservative, defensible answer to **13+**. Do NOT answer
> "unrestricted web access = Yes" — the app has no in-app browser (external
> links open in Safari / OAuth web sessions only), so that would wrongly force
> 16+.
>
> **Pinned questionnaire answers (set these exactly):**
> - **In-App Controls → Age Assurance: `None`.** The signup age gate
>   (`under_13` / `13_17` / `18_plus`, blocks under-13) is a custom dropdown,
>   not Apple's **Declared Age Range API**. Apple's "Age Assurance" value
>   refers specifically to that system API (or government-ID / age-estimation),
>   so a custom dropdown does not qualify. Declaring it caused a 2.3.6
>   rejection ("unable to find Parental Controls or Age Assurance mechanisms").
> - **In-App Controls → Parental Controls: `None`.** The app has none.
> - **Capabilities → Unrestricted Web Access: `No`.** No in-app browser.
> - **Medical/Wellness, Gambling, Contests: `No`.**
> - **User-Generated Content / Messaging: `Yes`** (chat, feed, discussions) —
>   this is expected and does not by itself exceed 13+.
> - **Profanity or Crude Humor: `Infrequent/Mild`** (member-authored chat).
>
> All of the above are metadata-only in App Store Connect → app →
> **App Information** → Age Rating. No binary change required.

## Export Compliance

`ITSAppUsesNonExemptEncryption: false` is set in `apps/mobile/app.config.ts`.
Apple auto-approves on submission. We use only standard HTTPS (Stripe SDK,
Supabase) — no custom cryptography.

## Submission Pre-Flight

Code-side gates — verify these before each submission:

- [ ] `bun run typecheck && bun run lint && bun --cwd apps/mobile test` clean
- [ ] No iOS pricing / "upgrade" CTAs visible (search `apps/mobile` for
      `$`, `monthly`, `yearly`, `Upgrade` and confirm gated behind
      `Platform.OS !== 'ios'`)
- [ ] In-app account deletion works end-to-end on a test account
      (`apps/mobile/app/(app)/(drawer)/delete-account.tsx`)
- [ ] App Review captcha bypass is wired so the reviewer reaches Apple Pay:
      set `EXPO_PUBLIC_APP_REVIEW_EMAIL=test-reviewer@myteamnetwork.com` for the
      EAS production build, and `APP_REVIEW_REVIEWER_USER_IDS` in Vercel to the
      reviewer's Supabase user id (`03c0b18b-ef47-46d8-a643-9ca9ecff0d0e`, the
      `test-reviewer@myteamnetwork.com` account). Both are default-closed when
      unset. Verify on a TestFlight build that signing in as the reviewer and
      tapping "Donate with Apple Pay" opens the Payment Sheet with NO captcha,
      while a normal account still gets the captcha.
- [ ] Donation success path stays in-app (Payment Sheet, no Safari
      redirect) for `donation_eligible_ios = true` orgs on iOS
- [ ] The org named in the Review Notes donation walkthrough is BOTH
      `donation_eligible_ios = true` AND has an onboarded Stripe Connect
      account. The flag alone is not enough: `create-donation` returns
      400 ("Stripe is not connected" / "onboarding not completed") and
      Apple Pay never renders unless the account is ready
      (`details_submitted && charges_enabled && payouts_enabled` — see
      `apps/web/src/lib/stripe.ts` `getConnectAccountStatus`). The Notes
      walkthrough points reviewers at `villanova-football` (Villanova
      Women's Lacrosse), currently the ONLY org with both
      `donation_eligible_ios = true` and an onboarded Connect account.
      ⚠️ This is a LIVE customer org (~133 real members): a reviewer test
      donation routes through the customer's real Stripe account and MUST
      be refunded after review, and the reviewer account has access to
      real member data. The previous isolated throwaway org
      (`apple-review-test-org`) was deleted 2026-06-04 and never had a
      Connect account. Strongly consider re-provisioning a dedicated
      review org with its own throwaway Connect account before the next
      submission to avoid exposing customer data/funds. Before each
      submission, verify in the Stripe dashboard that
      `villanova-football`'s Connect account shows "Payments active" +
      Payouts/Transfers.

Ops-side gates:

- [ ] EAS env vars set: `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- [ ] Vercel env vars set: `APPLE_PASS_TYPE_ID_MEMBER`,
      `APPLE_PASS_TYPE_ID_EVENT`, `APPLE_PASS_TYPE_ID_RECEIPT`,
      `APPLE_PASS_TEAM_ID`, `APPLE_PASS_SIGNER_CERT_PEM`,
      `APPLE_PASS_SIGNER_KEY_PEM`, `APPLE_PASS_SIGNER_KEY_PASSPHRASE`,
      `APPLE_WWDR_CERT_PEM`
- [ ] Apple Pay Merchant ID `merchant.com.myteamnetwork.teammeet`
      registered in App Store Connect and paired with Stripe-issued
      Payment Processing Certificate
- [ ] Reviewer account provisioned: create `test-reviewer@myteamnetwork.com`
      via Supabase Dashboard → Authentication → Users → Add user, with
      **Auto Confirm User** checked (no inbox access needed — does not email).
      Then run `supabase/seed-apple-reviewer.sql` in the prod SQL editor with
      `v_founders_slug` and `v_chsfl_slug` set. Grants the three orgs above
      (incl. the `donation_eligible_ios = true` org) and fully populates the
      review org's feature tabs.
- [ ] 30s demo video recorded showing: open app → donate via Apple Pay →
      add receipt to Wallet → add member card to Wallet
- [ ] All store screenshots regenerated at 6.7", 6.5", 5.5", 12.9"
- [ ] TestFlight external beta cycled at least once with a non-employee
      tester before promoting

## Rejection log

| Date | Version / build | Submission ID | Citation | Root cause / action |
|------|-----------------|---------------|----------|---------------------|
| 2026-06-23 | 1.0 (63) | `63c01db9-e467-457d-898a-ddbe91494f37` | 2.1 Apple Pay | Recurred despite the build containing the captcha bypass. The bypass code and prod DB state were verified correct (reviewer `03c0b18b…` is admin of `villanova-football`; org `donation_eligible_ios = true` + Connect `acct_1SkEaaKv9KV1FrU0`). So the dead end was an UN-checked external gate: Stripe Connect `charges_enabled` (live), `APP_REVIEW_REVIEWER_USER_IDS` in Vercel prod, `EXPO_PUBLIC_APP_REVIEW_EMAIL` in the EAS build, or no screen recording attached. Action: re-verify all four (see "Prerequisites before replying"), attach a recording, resubmit. |

## If Review Rejects

| Rejection citation | Likely cause | Response |
|--------------------|--------------|----------|
| 3.1.1 anti-steering | A price or "Upgrade" string slipped into iOS | grep the build, gate it on `Platform.OS !== 'ios'`, resubmit. Do not appeal — fix and resubmit is faster. |
| 3.1.1 IAP required | Reviewer assumes subscription is consumer-facing | Reply citing 3.1.3(c) Enterprise Services: the alumni tier is paid by orgs/admins from an org budget on behalf of members; not a consumer subscription. Offer to demo on a call. |
| 3.2.1(vi) donations | Org not recognized as a nonprofit | Provide the determination letter; if not 501(c)(3), pull the org from iOS via `donation_eligible_ios = false` instead of arguing. |
| 5.1.1(v) account deletion | Delete account flow broken or hidden | Verify the delete-account screen is reachable from Profile and actually signs the user out + marks for deletion. |
| 2.1 "unable to verify Apple Pay" | Reviewer could not traverse the captcha- and eligibility-gated donate path, so they never reached the Payment Sheet — OR no Notes/recording pointed them to it. | Run the full "Prerequisites before replying" checklist above (A: Stripe `charges_enabled` live, B: `APP_REVIEW_REVIEWER_USER_IDS` in Vercel prod + redeploy, C: `EXPO_PUBLIC_APP_REVIEW_EMAIL` in the EAS build, build ≥ 62), **attach a screen recording** (do not merely offer one), paste the Resolution Center reply, and resubmit. The bypass code itself is correct and unit-tested — assume the failure is an external gate, not code. |
| 2.1(a) "client_secret does not match PaymentIntent" on donate | PaymentSheet confirmed against the platform account, but the PaymentIntent lives on the org's **connected** account (direct charge). `stripeAccountId` was passed to `initPaymentSheet`, which silently ignores it — it belongs to the SDK init params. | Fixed in `useDonationPaymentSheet.ts`: call `initStripe({ publishableKey, stripeAccountId })` with the connected account before opening the sheet, restore the platform context in `finally`. Verify the donation walkthrough org's Connect account is fully onboarded. |
| 2.3.6 Age Assurance not found | "Age Assurance" / In-App Controls declared in age rating, but the app's age gate is a custom dropdown, not the Declared Age Range API | Metadata-only: ASC → App Information → Age Rating → set **Age Assurance** (and Parental Controls) to **None**. |
