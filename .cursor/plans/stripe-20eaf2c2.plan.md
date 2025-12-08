<!-- 20eaf2c2-5f92-40ad-80bb-38aa739b2cba 64ee55c4-0d1e-4657-86a2-55a76cade284 -->
# Plan Update

- Tighten typing in `/api/stripe/webhook/route.ts` to remove `any` casts; use `SupabaseClient<Database>` helpers for `organization_subscriptions` updates.
- Ensure shared enums (`AlumniBucket`, `SubscriptionInterval`, `NotificationAudience`) align across types, stripe, notifications.
- Enhance notifications: build targets from members/alumni + preferences, channel selection (email/sms/both), preview counts, mock sending with structured result; update send page accordingly.
- Improve billing UX copy for create-org (pricing clarity, 1500+ sales path) and BillingGate status messaging + portal button resilience.
- Verify soft-delete filters, admin-only delete usage, and clean imports; add doc comments in `lib/stripe.ts` and `lib/notifications.ts`.
- Run lint and build, fix any issues.

### To-dos

- [ ] Add Supabase migrations for subscriptions/audience/deleted_at
- [ ] Add Stripe price config and checkout/session helpers
- [ ] Extend org creation UI with billing and alumni bucket
- [ ] Add webhook handler and org access gating
- [ ] Implement admin delete buttons and filter deleted rows
- [ ] Add audience selection and targeting logic
- [ ] Align Supabase types with migration and shared enums
- [ ] Harden checkout and webhook event handling
- [ ] Verify org layout gating with BillingGate and portal
- [ ] Ensure deleted_at filtering and unified delete button
- [ ] Validate audience targeting logic and display