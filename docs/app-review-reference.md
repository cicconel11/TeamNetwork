# App Store Review — Reference & Checklist

Quick-reference summary distilled from Apple's official App Review guidance. Use this to self-check submissions before sending to App Review and to debug rejections.

> **Companion doc:** [`app-store-submission.md`](./app-store-submission.md) — the
> TeamNetwork-specific submission playbook: exact reviewer credentials, our
> guideline citations (3.1.3(d) enterprise subscriptions, 3.2.1(vi) donations),
> App Privacy declarations, code/ops pre-flight gates, and a rejection-citation →
> response table.
>
> **This** file = "how Apple review works" (generic, stable). **That** file =
> "what TeamNetwork pastes and verifies" (concrete, changes per release). When a
> checklist item below has a TeamNetwork answer, the companion doc owns the real
> value — follow the link rather than duplicating it here.

## Source Links

- **App Review (official process page):** https://developer.apple.com/distribute/app-review/
- **Tips from App Review (forum thread):** https://developer.apple.com/forums/thread/810791
- **App Review Guidelines:** https://developer.apple.com/app-store/review/guidelines/
- **Human Interface Guidelines:** https://developer.apple.com/design/human-interface-guidelines/
- **Privacy (HIG):** https://developer.apple.com/design/human-interface-guidelines/privacy/
- **App Store Connect Help:** https://developer.apple.com/help/app-store-connect/
- **Crash reports / device logs:** https://developer.apple.com/documentation/xcode/diagnosing_issues_using_crash_reports_and_device_logs/
- **App Store Connect:** https://appstoreconnect.apple.com/
- **Request expedited review:** https://developer.apple.com/contact/app-store/?topic=expedite
- **Submit an appeal:** https://developer.apple.com/contact/app-store/?topic=appeal

## Timeline

- ~90% of submissions reviewed in **under 24 hours**.
- Incomplete submissions get delayed. Status arrives by email + App Store Connect.

## What Review Checks

Compliance with four documents:
- App Review Guidelines (technical / content / design)
- Human Interface Guidelines (UI/UX)
- Apple Developer Program License Agreement (legal)
- Trademark & Copyright Guidelines (Apple IP)

## Top Rejection Reasons

| Guideline | Issue | Avoid by |
|-----------|-------|----------|
| 2.1 Completeness | Crashes & bugs | Test on real devices, latest OS, via TestFlight |
| 2.1 Completeness | Placeholder content | Finalize all text/images |
| 2.1 Completeness | Missing info / broken links | Working support + privacy-policy links |
| 2.3 | Inaccurate screenshots | Match device type, don't obscure UI |
| 2.3 | Misleading users | App performs as advertised |
| 4.2 | Web clippings / thin wrapper | Leverage real iOS features, lasting value |
| 4.3 | Repeated similar apps | Consolidate duplicates |
| 4.1 | Copycat / unlicensed IP | Original experience; authorize 3rd-party IP |
| 3, 5.1.1 | Wrong submitting entity | Regulated services submitted by legal provider |

## Pre-Submission Checklist

> TeamNetwork's concrete code + ops gates (typecheck/lint/test, no-iOS-pricing
> grep, account-deletion, EAS/Vercel env vars, reviewer-account provisioning,
> demo video, screenshots) live in [`app-store-submission.md` → Submission
> Pre-Flight](./app-store-submission.md#submission-pre-flight). The list below is
> the generic Apple-side check.

- [ ] Tested on physical devices, latest OS, no crashes/bugs.
- [ ] No placeholder content (text + images final).
- [ ] All links work (support contact + privacy policy required).
- [ ] Screenshots match device type, show real UI.
- [ ] Metadata/description accurate, not misleading.
- [ ] Clean, refined UI per HIG.

### App Review Information section (critical — top cause of delay)

> TeamNetwork's actual reviewer creds + the exact Notes-field text (enterprise
> subscription & donation exemption rationale) are in
> [`app-store-submission.md` → App Review Information → Notes](./app-store-submission.md#app-review-information--notes).
> Don't paste creds here.

- [ ] **Demo account credentials** if sign-in required (use Notes field per account type).
- [ ] **Auth codes** provided in advance if needed.
- [ ] **Demo video** (real device, not screen recording) for hardware-dependent or hard-to-reproduce features.
- [ ] **Notes field**: new app → concept, business model, location needs; update → what changed + where to find it.
- [ ] Complete, current contact info.

### Privacy (Guideline 5.1)

> TeamNetwork's declared App Privacy data types (linked to identity, not used
> for tracking) are tabled in
> [`app-store-submission.md` → Privacy → App Privacy](./app-store-submission.md#privacy--app-privacy).

- [ ] Privacy policy lists data collected, how, and all uses.
- [ ] Confirms 3rd parties give equivalent protection.
- [ ] States retention/deletion + consent revocation + deletion request flow.
- [ ] Clear `Info.plist` purpose strings for every sensitive-data API.

### Conditional documentation

- Kids' apps w/ 3rd-party ads (1.3): link ad-service Kids practices + evidence of human creative review.
- Medical hardware (1.4): regulatory clearance copy for each distribution region.
- 3rd-party IP / streaming (4.1, 5.2): authorization for trademarks, celebrity imagery, sports, music.
- Real-money gaming / VPN / gambling (5): regional licensing.

## In-App Purchases

> **TeamNetwork ships zero StoreKit IAP.** All money flows are exempt: org/admin
> enterprise subscriptions (3.1.3(d)) and verified-nonprofit donations
> (3.2.1(vi)) via Stripe/Apple Pay. The iOS app shows no prices or "Upgrade"
> CTAs. Rationale + anti-steering gates are in
> [`app-store-submission.md`](./app-store-submission.md). The generic IAP notes
> below are kept only in case a consumer purchase is ever added.

- Accept Paid Applications Agreement; submit IAPs in App Store Connect.
- IAPs don't need prior approval to function during review.
- If IAPs don't show in sandbox → see Apple Tech Note **TN3186**.

## After Submitting — Levers

> For a TeamNetwork-specific rejection (e.g. 3.1.1 anti-steering, 3.1.3(d)
> subscription, 3.2.1(vi) donations, 5.1.1(v) account deletion), go straight to
> [`app-store-submission.md` → If Review Rejects](./app-store-submission.md#if-review-rejects)
> for the citation → likely cause → response mapping. The levers below are the
> generic mechanics.

- **Reply to App Review** in App Store Connect for rejections; can request a call.
- **Bug Fix Submissions**: if rejected during a bug-fix update, reply that you'll fix remaining issues in the *next* update — ships faster than resubmitting (unless legal/safety blocks it).
- **Expedited review**: critical bug fixes (include repro steps) or time-sensitive event apps (include event details). Request: https://developer.apple.com/contact/app-store/?topic=expedite
- **Appeal**: one appeal per rejection; give specific reasons app complies. Respond to info requests first. https://developer.apple.com/contact/app-store/?topic=appeal
- **Meet with Apple**: 30-min App Review Webex appointments, Tue/Thu local business hours.

## Pro Tips

- Plan/schedule release in advance.
- Test on real devices, not just simulators.
- Use the Notes field generously — it's the cheapest way to prevent a rejection.
- Clear purpose strings for every permission prompt.
- WWDC sessions worth watching: "Tips for preventing common review issues", "Do more with less data", "Write clear purpose strings".
