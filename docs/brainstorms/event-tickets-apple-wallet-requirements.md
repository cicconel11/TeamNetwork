---
date: 2026-06-23
topic: event-tickets-apple-wallet
---

# Event Tickets & Apple Wallet

## Summary

Fix the broken "Add ticket to Apple Wallet" button so free RSVP events produce a working wallet pass on iOS, and capture a ready-to-build spec for paid event ticketing (orgs charge admission, buyers pay via the existing in-app Apple Pay sheet, the purchased ticket becomes the same wallet pass). The fix ships now; the paid layer is designed now and built when a real org asks.

---

## Problem Frame

On the mobile Event Details screen, the "Add ticket to Apple Wallet" button fails with `Unable to download a file: response has status 401`. The wallet feature is otherwise fully built — the web route, the `@teammeet/wallet` pass generator, the Apple Pass certs, and the mobile download helper all exist. The failure is a narrow auth mismatch: the web route (`apps/web/src/app/api/wallet/event/[eventId]/route.ts`) authenticates with `getCurrentUser()`, which only reads the Supabase session from cookies, while the mobile client (`apps/mobile/src/lib/add-to-wallet.ts`) sends a `Bearer` token in the `Authorization` header. The server sees no user and returns 401, so attendees who RSVP can't get the check-in pass the feature promises.

Separately, the product has no concept of *paid* events. Every event today is free and RSVP-based. There's anticipatory interest in letting orgs sell tickets, but no org has requested it yet. The prior donations work made the team cautious about Apple — donations are gated to web-only on iOS because Apple only permits *verified nonprofits* to collect donations in-app (Guideline 3.2.1(vi)). That caution doesn't transfer to ticket sales: event admission is a real-world service that Apple explicitly allows to be sold outside IAP (Guideline 3.1.3(e)), with no nonprofit requirement — the model Eventbrite, DICE, and Ticketmaster all use. The open question was therefore not "is it allowed" but "how much do we build before there's demand."

---

## Actors

- A1. Attendee: RSVPs to (or, in the paid layer, buys a ticket for) an event on the mobile app and adds the resulting pass to Apple Wallet.
- A2. Org admin: creates events and, in the paid layer, marks an event as paid and sets its price.
- A3. Check-in operator: scans/validates the wallet pass or RSVP at the event (existing `check_in_mode` of `rsvp` / `qr`).

---

## Key Flows

- F1. Free pass (build now)
  - **Trigger:** Attendee has RSVP'd with a status other than `not_attending` and taps "Add to Apple Wallet" on iOS.
  - **Actors:** A1
  - **Steps:** Mobile requests the pass with the user's Bearer token → web route authenticates the Bearer token → verifies the RSVP → generates and returns the signed `.pkpass` → iOS opens the Add-to-Wallet sheet.
  - **Outcome:** The event pass is in the attendee's Apple Wallet; it can be presented for check-in.
  - **Covered by:** R1, R2, R3, R4

- F2. Paid ticket purchase (design now, build later)
  - **Trigger:** Attendee opens a paid event on the mobile app and taps "Buy ticket."
  - **Actors:** A1, A2
  - **Steps:** Org admin has marked the event paid with a price → attendee confirms purchase via the in-app Apple Pay sheet (the donations Stripe Payment Sheet rail) → payment confirms on the org's Stripe Connect account → a ticket (paid RSVP) is recorded → the wallet pass becomes available exactly as in F1.
  - **Outcome:** Attendee holds a paid ticket and its wallet pass; the org receives the funds.
  - **Covered by:** R5, R6, R7, R8

---

## Requirements

**Free wallet pass — fix and verify (build now)**
- R1. The wallet pass web route must authenticate requests using the `Bearer` token sent by the mobile client, not cookies only, so authenticated mobile users are recognized. (Reuse the existing `createAuthenticatedApiClient` helper that other mobile→web routes already use.)
- R2. After the auth fix, the button must produce a valid, installable `.pkpass` on a real iOS device for an RSVP'd attendee — verification is part of "done," not optional.
- R3. The same auth fix must be applied to any sibling wallet route with the identical cookie-only pattern (e.g. the member-card route) so the bug class is closed, not just the one instance.
- R4. When the Apple Pass signing certs are not configured in the deployment, the failure must remain a clear "wallet not configured" state (the existing 503), distinct from an auth failure, so the two failure modes are not confused.

**Paid event ticketing — spec for later build (do not build until an org asks)**
- R5. An org admin can mark an event as paid and set a ticket price; events remain free by default and the existing free RSVP flow is unchanged.
- R6. A buyer pays for a paid ticket via the in-app Apple Pay sheet (the same Stripe Payment Sheet rail used for donations), settling to the org's Stripe Connect account. No Apple IAP, and no nonprofit eligibility gate.
- R7. A successful purchase records the buyer as holding a ticket for the event and makes the Apple Wallet pass available to them through the same mechanism as the free pass.
- R8. The check-in experience treats a paid ticket the same as an RSVP for door validation (existing `rsvp` / `qr` modes), so no separate scanning path is introduced.

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Given an attendee who RSVP'd "attending" on iOS, when they tap "Add to Apple Wallet," the signed pass downloads and the Add-to-Wallet sheet opens — no 401.
- AE2. **Covers R1.** Given a request with no valid session (no Bearer token and no cookie), when it hits the wallet route, it is rejected as unauthorized — the fix widens accepted auth, it does not remove auth.
- AE3. **Covers R4.** Given the Apple Pass certs are absent in the deployment, when an authenticated attendee requests the pass, the response is the "wallet not configured" state (503), not a 401.
- AE4. **Covers R5, R6.** Given an event an org admin marked paid, when an iOS buyer completes the Apple Pay sheet, the charge settles to the org's connected account and the buyer is recorded as holding a ticket.
- AE5. **Covers R7.** Given a completed paid purchase, when the buyer taps "Add to Apple Wallet," they receive the pass through the same flow as a free RSVP attendee.

---

## Success Criteria

- An attendee who RSVPs on iOS can reliably add the event pass to Apple Wallet and present it for check-in — the reported 401 no longer occurs.
- The two failure modes (not authenticated vs. wallet not configured) are distinguishable in practice, so a future failure is diagnosable without guesswork.
- The paid-ticketing spec is complete enough that when the first org asks to sell tickets, `ce-plan` can plan it without re-deciding the payment rail, the Apple-compliance posture, or the actor model.
- No speculative paid-ticketing code is shipped before demand exists.

---

## Scope Boundaries

- Paid-ticketing implementation is not built now — only the free-pass fix ships. The paid layer is documented and waits for a real org request.
- The paid "tail" is explicitly out of v1 even when paid ticketing is built: refunds/cancellations, capacity limits and sold-out handling, ticket transfer/resale, tax/receipt documents, and payout reconciliation reporting.
- Google Wallet / Android passes are out of scope — the pass feature is iOS-only today and stays iOS-only here.
- Donations behavior is unchanged — this work does not revisit the donations web-only gating.
- No change to how events are created, targeted, or checked in beyond adding the paid flag/price in the paid layer.

---

## Key Decisions

- Fix auth by accepting the mobile Bearer token rather than changing how mobile sends auth: the repo already has a Bearer-aware helper (`createAuthenticatedApiClient`) used by other mobile→web routes, so the wallet route is the outlier to bring in line.
- Paid tickets use the in-app Apple Pay / Stripe Payment Sheet rail, not web-only: event admission is an Apple-sanctioned non-IAP category (3.1.3(e)), unlike donations (3.2.1(vi)), so the conservative donations gating does not apply and the better-converting native flow is legitimate.
- For-profit orgs may sell tickets: there is no nonprofit eligibility gate on ticketing, in contrast to `donation_eligible_ios`.
- Design-defer over build-now for paid ticketing: with zero current demand, building the paid path (and its tail) would be carrying cost before value; the seam is designed so the build is fast when demand arrives.

---

## Dependencies / Assumptions

- Assumes the Apple Pass signing certs (`APPLE_PASS_TYPE_ID_EVENT`, `APPLE_PASS_TEAM_ID`, `APPLE_WWDR_CERT_PEM`, `APPLE_PASS_SIGNER_CERT_PEM`, `APPLE_PASS_SIGNER_KEY_PEM`) are — or will be — configured in the deployment that serves the route. If they are absent, the auth fix alone will surface a 503 rather than a working pass (see R4). This should be confirmed as part of shipping the fix.
- Assumes the existing donations Stripe Payment Sheet + Stripe Connect setup is reusable for ticket charges (same rail, different product). To be validated when the paid layer is built.
- Assumes paid tickets can be modeled as paid RSVPs on the existing event/RSVP structure rather than requiring a separate tickets system — to be confirmed during planning of the paid layer.

---

## Outstanding Questions

### Resolve Before Planning

- (None blocking the free-pass fix.)

### Deferred to Planning

- [Affects R5, R6][User decision] Should TeamMeet take a platform fee (application fee) on ticket sales, or pass 100% through like donations? Business decision, only needed when the paid layer is built.
- [Affects R7][Technical] Is a paid ticket best represented as a status/flag on `event_rsvps`, or does it need its own record for price/quantity/payment linkage? Resolve during planning of the paid layer.
- [Affects R5][Technical] Can a buyer purchase more than one ticket per paid event, and if so how is quantity represented? Resolve when the paid layer is planned.
- [Affects R2][Needs research] Confirm `expo-file-system`'s `downloadFileAsync` reliably forwards the `Authorization` header on the target iOS versions, so the fix isn't undone by a transport-layer header strip.
