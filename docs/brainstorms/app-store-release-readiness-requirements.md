---
date: 2026-05-02
topic: app-store-release-readiness
---

# App Store Release Readiness

## Summary

Prepare the existing TestFlight-tested TeamMeet iOS app for first App Store submission by auditing and completing App Store Connect metadata, screenshots, privacy disclosures, age rating, review notes, and exact-build release readiness before deciding whether the current TestFlight build is the release candidate.

---

## Problem Frame

TeamMeet already has iOS production builds reaching TestFlight, so the immediate risk is no longer whether EAS can produce a store binary. The release now depends on whether App Store Connect has enough accurate product, privacy, compliance, and reviewer-facing information for Apple to approve the app without avoidable back-and-forth.

The current App Store Connect listing state is unknown, so the next milestone is to inspect it manually and build a gap list that can be closed before submission.

---

## Actors

- A1. Release owner: Prepares the App Store Connect listing, selects the candidate build, and submits for review.
- A2. Apple reviewer: Uses the submitted metadata, review notes, and demo access to verify the app.
- A3. TestFlight testers: Provide confidence that the selected build is usable enough to submit.
- A4. TeamMeet users: Prospective admins, members, alumni, parents, and donors represented by the listing and screenshots.

---

## Key Flows

- F1. App Store listing audit
  - **Trigger:** The team is ready to move from TestFlight dogfooding toward App Review.
  - **Actors:** A1
  - **Steps:** Inspect App Store Connect, record every incomplete or uncertain listing field, classify each gap as required before submission or polish, and assign an owner for missing content.
  - **Outcome:** The release owner has a concrete gap list instead of an unknown listing state.
  - **Covered by:** R1, R2, R3, R4, R5

- F2. Review submission package
  - **Trigger:** Required listing gaps are closed and a TestFlight build is selected.
  - **Actors:** A1, A2
  - **Steps:** Attach/select the candidate build, complete privacy and age disclosures, provide review notes and demo access, verify support/legal URLs, run the exact-build smoke test, and submit for App Review.
  - **Outcome:** Apple can review the app without needing hidden team knowledge or ad hoc follow-up.
  - **Covered by:** R6, R7, R8, R9, R10, R11, R12, R13, R14, R15

---

## Requirements

**Listing metadata**
- R1. Audit the App Store Connect listing and record each required metadata field's status, blocker/polish classification, and owner for missing content: app name, subtitle, description, keywords, category, support URL, privacy policy URL, copyright, and app availability.
- R2. Draft or verify listing copy that accurately positions TeamMeet as an organization/team network app without overclaiming features that are not in the submitted build.
- R3. Designate or create a live public support URL before submission, and verify it is reachable without authentication.
- R4. Confirm support and privacy URLs are live, public, and consistent with the app's actual data practices.

**Screenshots and assets**
- R5. Identify all screenshot sets required by the current App Store Connect configuration. Because the current iOS config supports iPad, assume required iPad screenshots are in scope unless the team explicitly disables tablet support and creates a new production build.
- R6. Define a lightweight screenshot storyboard before capture: screenshot order, target viewer, screen or flow shown, core message/caption, required demo data, source build, and feature claims to avoid.
- R7. For each screenshot set, record device class/size, screenshot count, orientation, language/locale, caption/frame treatment, source build, demo account/org, and pass/fail status in App Store Connect.
- R8. Screenshots, preview assets, review notes, and demo content must use synthetic or explicitly approved data, with no real emails, phone numbers, minors' data, donor/payment details, private messages, invite links, or internal organization identifiers.
- R9. Every screenshot must come from or faithfully represent the selected build, avoid unsupported feature claims, match enabled device support, and align with reviewer-accessible demo flows.

**Privacy, compliance, and review**
- R10. Complete an Apple privacy-label evidence matrix before answering nutrition labels. The matrix should cover Apple data categories, collected/not collected status, linked-to-user status, tracking status, purpose of use, third-party SDK/processors, retention/deletion notes, and the evidence source for each answer.
- R11. Complete age rating and content rights answers with attention to community content, messaging/feed/discussions, donations/payments, and youth/parent flows.
- R12. Verify user-generated-content readiness for App Review: content reporting, user blocking or equivalent safety controls, moderation/removal workflow, objectionable-content policy coverage, and reviewer notes explaining where controls are found.
- R13. Classify every payment and donation flow against Apple payment rules before submission. Record what is purchased or donated, the recipient, whether it unlocks digital functionality, why Stripe or an external payment flow is allowed instead of IAP, test expectations, and what reviewer notes should say.
- R14. Verify account deletion compliance for the submitted build, including where deletion is available, what happens to profile data, memberships, user-generated content, donation/payment records, legal retention, and support escalation.
- R15. Classify youth and parent flows for child privacy obligations, including whether minors can create accounts, what minor PII is collected, parental consent/approval behavior, age-gating, privacy label implications, and review-note guidance.

**Review access and release candidate decision**
- R16. Prepare App Review notes that explain how to access the app, what account or organization Apple should use, which flows to test, and any features that depend on external services or permissions.
- R17. The App Review demo account must use a dedicated isolated demo organization with synthetic users/content/payments, least-privilege permissions appropriate for review, no production PII, credentials stored outside source control, a reset procedure before each submission, and credentials rotated or disabled after review.
- R18. Before go/no-go, install and test the exact selected TestFlight build using production App Store-facing configuration and only the reviewer notes/demo access. Verify reviewer login/demo org access, Sign in with Apple, account deletion, deep links, required permission prompts, payment/donation paths, and gated org paths that Apple may inspect.
- R19. Treat the current TestFlight build as the candidate unless the listing audit, tester feedback, exact-build smoke test, or App Review preparation reveals a blocking issue.
- R20. Create a new production build only when there is a release-blocking code/config change, a required metadata-linked app version change, or a decision to defer submission for product fixes.

---

## Acceptance Examples

- AE1. **Covers R1, R5, R10, R11.** Given the listing state is unknown, when the release owner audits App Store Connect, the result is a gap list that separates required submission blockers from optional polish and assigns an owner to each missing item.
- AE2. **Covers R16, R17, R18.** Given Apple opens the submitted app, when the reviewer follows the review notes, they can reach a representative isolated demo organization without seeing private team or user data.
- AE3. **Covers R13.** Given the app exposes donations or payments, when the release owner prepares submission materials, every money flow has an Apple policy classification and reviewer explanation before submission.
- AE4. **Covers R19, R20.** Given the current TestFlight build has no known blocking issue after metadata audit and exact-build smoke testing, when App Store Connect materials are complete, the team can submit that build rather than delaying for an SDK or React Native upgrade.

---

## Success Criteria

- The team knows whether the current TestFlight build can be submitted or whether a new release candidate is required.
- Every App Store Connect blocker is captured as a concrete checklist item with enough detail for a human to close it.
- Apple receives accurate privacy, age, payment, UGC, and review information that matches the app's real behavior.
- Screenshots and listing copy communicate TeamMeet accurately without exposing private data or implying unavailable features.
- Planning or execution can proceed without inventing the submission scope.

---

## Scope Boundaries

- React Native, Expo SDK, and dependency upgrades are not part of this milestone unless a specific App Review or TestFlight blocker requires them.
- EAS build pipeline work is not part of this milestone because store-distribution builds are already reaching TestFlight.
- New feature work is out of scope unless it is required to pass App Review.
- Broad mobile regression QA is out of scope unless tester feedback or App Review preparation reveals a blocker; verification is limited to reviewer-facing submission paths and exact-build release confidence.
- Brand refresh, marketing-site copy, and non-required creative polish are out of scope; listing copy and screenshots only need to satisfy App Store submission accuracy and required asset coverage for this release.
- Android/Google Play release preparation is out of scope for this checklist.

---

## Key Decisions

- Prioritize App Store metadata readiness over framework freshness: TestFlight proves the release path is active, while the unknown listing state is the immediate blocker.
- Use the current TestFlight build as the default candidate: this avoids unnecessary churn unless a concrete release-blocking issue appears.
- Keep the checklist App Store Connect focused: code cleanup and dependency alignment can happen separately from first-submission preparation.
- Treat privacy, UGC, payment, child-safety, and demo-account readiness as submission blockers, not polish, because these areas commonly affect App Review outcomes.

---

## Dependencies / Assumptions

- The App Store Connect app record exists for TeamMeet and is associated with the configured bundle identifier.
- A recent iOS production build is available in TestFlight.
- The release owner has Apple Developer Program access, App Store Connect access with rights to the TeamMeet app, and EAS org access for `teamnetwork` before starting the audit.
- The team can provide or create a demo account/organization suitable for Apple review.
- Current legal/support pages are acceptable starting points, but their exact App Store suitability still needs audit.

---

## Outstanding Questions

### Resolve Before Submission

- [Affects R1][Manual audit] Which App Store Connect fields are currently incomplete or uncertain?
- [Affects R2, R6][Product decision] Who is the primary App Store reader for the first release, what promise should they understand from the first screenshot, and which secondary personas are intentionally de-emphasized?
- [Affects R3, R4][Manual audit] What public support URL should be used, and is it reachable without authentication?
- [Affects R5, R6, R7][Design/content] Which screenshots already exist, and which device sizes does App Store Connect require for this app record?
- [Affects R10][Compliance] Which exact Apple privacy label answers match the current app behavior?
- [Affects R12][Compliance] Do the submitted build and policies satisfy Apple's UGC safety expectations?
- [Affects R13][Policy] Are all Stripe-backed payment and donation flows acceptable under Apple payment rules for this app and release?
- [Affects R15][Compliance] Do youth/parent flows create child privacy, consent, or age-rating obligations that require copy, policy, or product changes before submission?
- [Affects R16, R17][User decision] What demo account and organization should Apple use during review?
- [Affects R18, R19, R20][Release decision] Does the latest TestFlight build pass exact-build smoke testing and tester feedback well enough to be the intended release candidate?
- [Affects Success Criteria][Product decision] What should the intended App Store listing perception be: who TeamMeet is for, what the app enables, and what is not yet part of the mobile experience?

### Deferred to Execution

- [Affects R2][Copywriting] Finalize app description, subtitle, keywords, and promotional text.
- [Affects R5, R6, R7, R8, R9][Design/content] Capture or generate final screenshots once the screenshot story is approved.
- [Affects R16][Release operations] Submit the selected build with review notes once the required listing gaps are closed.
