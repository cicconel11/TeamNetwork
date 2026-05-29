# iOS App Store Submission Notes

Reference for the release team. Most fields are pasted directly into App Store
Connect; nothing here is consumed by code.

## App Review Information → Notes

```
TeamNetwork is a closed, invite-only platform for organizations (sports
teams, alumni associations, parent groups, nonprofits) to coordinate
their members. Reviewers need a test org to see the app populated; please
use the credentials below.

Test account
  Email:    test-reviewer@myteamnetwork.com
  Password: [fill in — set during signup]
  Orgs:     Apple Review Test Org (donation_eligible_ios = true, admin)
            Test Org (admin)
            TeamNetwork founders org (read-only)

Payment flows covered by Apple's exemptions, not StoreKit:

1) Organization subscriptions (alumni tier plans)
   - Apple Guideline 3.1.3(d) — Enterprise Services. The subscription is
     purchased by an organization administrator on behalf of the
     organization's members; payment is from an org budget, not by
     individual end users for digital content. The iOS app does not
     advertise prices, "upgrade" CTAs, or links to a paywall. Admins
     who want to change plans do so on the web.

2) Charitable donations
   - Apple Guideline 3.2.1(vi). All donating organizations are verified
     nonprofits; the `donation_eligible_ios` flag is set only after ops
     reviews each org's 501(c)(3) determination letter (or international
     equivalent). Determination letters are available on request. The
     funds route through Stripe Connect directly to the recipient
     organization's own Stripe account; TeamNetwork is not the merchant
     of record for the donation itself.
   - Donors pay in-app via Apple Pay through Stripe's Payment Sheet.
     Donations are voluntary and do not unlock any digital content or
     functionality in the app.

3) Apple Wallet
   - Member cards, event tickets, and donation receipts are issued as
     signed PassKit passes. Wallet is not used as a payment mechanism.

No other monetization exists in the iOS app. We do not offer paid
content, premium features, in-app currency, or any other digital
purchase to end users on iOS.

Contact for reviewer questions: [fill in email]
```

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

No data collected for tracking purposes. No third-party SDKs that track users
across apps/websites.

## App Information

| Field                  | Value |
|------------------------|-------|
| Primary Category       | Social Networking |
| Secondary Category     | Sports |
| Support URL            | https://www.myteamnetwork.com/support |
| Marketing URL          | https://www.myteamnetwork.com |
| Privacy Policy URL     | https://www.myteamnetwork.com/privacy |
| Copyright              | © Teamra LLC |
| Age Rating             | 12+ (Infrequent/Mild Profanity or Crude Humor — user-generated chat) |

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
- [ ] Donation success path stays in-app (Payment Sheet, no Safari
      redirect) for `donation_eligible_ios = true` orgs on iOS

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
      `v_founders_slug` set. Grants the three orgs above incl. the
      `donation_eligible_ios = true` org.
- [ ] 30s demo video recorded showing: open app → donate via Apple Pay →
      add receipt to Wallet → add member card to Wallet
- [ ] All store screenshots regenerated at 6.7", 6.5", 5.5", 12.9"
- [ ] TestFlight external beta cycled at least once with a non-employee
      tester before promoting

## If Review Rejects

| Rejection citation | Likely cause | Response |
|--------------------|--------------|----------|
| 3.1.1 anti-steering | A price or "Upgrade" string slipped into iOS | grep the build, gate it on `Platform.OS !== 'ios'`, resubmit. Do not appeal — fix and resubmit is faster. |
| 3.1.1 IAP required | Reviewer assumes subscription is consumer-facing | Reply citing 3.1.3(d): the alumni tier is paid by orgs/admins from an org budget on behalf of members; not a consumer subscription. Offer to demo on a call. |
| 3.2.1(vi) donations | Org not recognized as a nonprofit | Provide the determination letter; if not 501(c)(3), pull the org from iOS via `donation_eligible_ios = false` instead of arguing. |
| 5.1.1(v) account deletion | Delete account flow broken or hidden | Verify the delete-account screen is reachable from Profile and actually signs the user out + marks for deletion. |
