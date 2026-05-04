---
title: Fix Mobile Notifications Reliability and Parity
type: fix
status: active
date: 2026-05-04
---

# Fix Mobile Notifications Reliability and Parity

## Overview

Mobile notifications are wired end-to-end (Expo push registration, foreground handling, deep-link routing, in-app inbox, preferences, backend fanout) but suffer four classes of defects that erode reliability and admin trust:

1. **Broken push tap deep-links** — required `orgSlug` is missing from many payloads, so taps land on a no-op.
2. **Wrong route for discussions** — push points to `/discussions/[id]` but the screen lives at `/chat/threads/[id]`.
3. **UI/backend parity gaps** — mobile composer can't send push, settings exposes only 3 of 9 categories, inbox taps don't deep-link.
4. **State integrity** — read state is AsyncStorage-only, badge count drifts from unread count, large fanouts silently truncate at 200 tokens.

This plan resolves these in a P0→P3 priority sequence so that every push is deep-linkable, the inbox is a true cross-device notification center, and admins have full sending control from mobile.

## Problem Statement

### What's broken (verified against code at 2026-05-04)

| # | Issue | Evidence |
|---|---|---|
| 1 | Push routing requires `orgSlug` but callers omit it | `apps/mobile/src/lib/notifications.ts:242` early-returns null when `data.orgSlug` is missing; `/api/notifications/send` accepts `orgSlug` (route.ts:77, 164) but does not resolve it from `organizationId` when absent. Mobile event/announcement creation flows and several web flows pass `pushType`/`pushResourceId` without `orgSlug`. |
| 2 | Discussion route mismatch | `apps/mobile/src/lib/notifications.ts:257-258` maps to `/(app)/${orgSlug}/discussions/${id}`. Helper `buildMobileDiscussionThreadRoute` (`apps/mobile/src/lib/chat-helpers.ts:19`) already returns the correct path `/(app)/${orgSlug}/chat/threads/${threadId}`. |
| 3 | Mobile composer missing push channel | `apps/mobile/app/(app)/(drawer)/[orgSlug]/notifications/new.tsx` `CHANNEL_OPTIONS` only includes email/SMS/both; backend supports `channel: "push" \| "all"`. |
| 4 | Inbox rows don't deep-link | `notifications` table rows lack structured type/resource_id/data; tapping just toggles read. |
| 5 | Read state local-only (AsyncStorage `notification_read_ids_${userId}_${orgId}`) | No cross-device sync, no admin analytics, lost on reinstall. |
| 6 | Badge ≠ unread inbox count | Foreground push increments badge; opening app resets to 0; inbox unread is independent. |
| 7 | Mobile preferences expose only 3 of 9 categories | Hook + settings show announcement/chat/event_reminder; backend has event/workout/competition/discussion/mentorship/donation. |
| 8 | Disabling push doesn't unregister tokens | Tokens linger until logout or DeviceNotRegistered. |
| 9 | Inline fanout caps at 200 tokens, silently truncates | `notification_jobs` queue + cron exist but are unused for standard sends. |
| 10 | Tests are thin | Only announcement/event/invalid-input parsed. |
| 11 | Runbook drift | `docs/push-notifications-runbook.md` references `last_seen_at` on `user_push_tokens`; column is `updated_at`. |

### Why it matters

- **User trust**: a push that does nothing on tap is worse than no push.
- **Admin productivity**: admins on mobile can't broadcast push, forcing them to switch to web.
- **Compliance/analytics**: no server-side read state means no engagement metrics and uneven UX across devices.
- **Scale**: any org with >200 active push-enabled users gets partial broadcasts.

## Proposed Solution

A four-phase fix aligned with the existing P0–P3 prioritization:

- **P0 (this PR or first)**: Make every push tap land on the right screen. Server-side resolves `orgSlug`; discussion route fixed; broad route tests added.
- **P1**: Mobile UX parity — composer gains push/all channels; settings exposes all categories; persisted notification rows carry deep-link metadata so inbox taps route the same as push taps.
- **P2**: Robust notification center — server-side read state, badge tied to unread, queue large fanouts via existing `notification_jobs`.
- **P3**: Operational polish — runbook fixes, stale-token cleanup, optional delivery receipts.

## Technical Approach

### Architecture invariants we are establishing

1. **A notification has exactly one canonical route** computed from `(orgSlug, type, resourceId)`. Both push payloads and persisted `notifications` rows must carry these three fields.
2. **`/api/notifications/send` is the single chokepoint** that guarantees push payload completeness — callers may omit `orgSlug`, server resolves from `organizationId`.
3. **Read state lives server-side** keyed by `(notification_id, user_id)`; AsyncStorage becomes a cache, not the source of truth.
4. **Badge count is derived** from server unread count, not from delivered-push count.
5. **Fanouts >N tokens always enqueue**; inline path is reserved for small/synchronous sends.

### Implementation Phases

#### Phase 1 (P0): Fix push tap reliability

**Files**

- `apps/web/src/app/api/notifications/send/route.ts` — resolve `orgSlug` from `organizationId` when not provided. Pseudocode:
  ```ts
  // route.ts (after parsing body, before sendPush)
  if (!orgSlug && organizationId) {
    const { data: org } = await supabase
      .from("organizations")
      .select("slug")
      .eq("id", organizationId)
      .single();
    orgSlug = org?.slug ?? undefined;
  }
  if (!orgSlug && (channel === "push" || channel === "all")) {
    return NextResponse.json({ error: "orgSlug unresolved" }, { status: 400 });
  }
  ```
- `apps/web/src/lib/notifications/push.ts` — make `orgSlug` required in the `sendPush` argument type; ensure it is written into every Expo `data` payload. Audit all direct callers (`chat/[groupId]/messages/route.ts`, `cron/event-reminders/route.ts`, `lib/discussions/notifications.ts`, mentorship routes) and confirm `orgSlug` is supplied or resolved.
- `apps/mobile/src/lib/notifications.ts:257-258` — replace discussion mapping with `buildMobileDiscussionThreadRoute(orgSlug, id)` from `apps/mobile/src/lib/chat-helpers.ts`.

**Tests** (add under `apps/mobile/__tests__/notifications.test.ts` or equivalent and `apps/web/tests/notifications/`):

```ts
// notifications.routes.test.ts
describe("getNotificationRoute", () => {
  it.each([
    ["announcement", "a1", "/(app)/foo/announcements/a1"],
    ["event", "e1", "/(app)/foo/events/e1"],
    ["event_reminder", "e1", "/(app)/foo/events/e1"],
    ["event_live_activity", "e1", "/(app)/foo/events/e1"],
    ["chat", "g1", "/(app)/foo/chat/g1"],
    ["discussion", "t1", "/(app)/foo/chat/threads/t1"], // NEW
    ["mentorship", "m1", "/(app)/foo/mentorship/m1"],
    ["donation", "d1", "/(app)/foo/donations"],
    ["membership", "u1", "/(app)/foo/members"],
  ])("routes %s", (type, id, expected) => { /* ... */ });

  it("returns null when orgSlug missing", () => { /* ... */ });
  it("returns null when type missing", () => { /* ... */ });
});

// send-route.test.ts
it("resolves orgSlug from organizationId when omitted", async () => { /* ... */ });
it("rejects push channel when orgSlug cannot be resolved", async () => { /* ... */ });
```

**Acceptance**

- [ ] `getNotificationRoute` test matrix covers all 7 types + missing-field cases
- [ ] Server route resolves `orgSlug` from `organizationId`; covered by integration test against SupabaseStub
- [ ] Discussion push opens the correct thread on iOS + Android (manual TestFlight verification)
- [ ] Direct-push surfaces (chat, event reminder, discussion, mentorship) all include `orgSlug` in payload — verified via push.ts type signature change

#### Phase 2 (P1): Mobile UX parity

**2a. Composer gains push channels** — `apps/mobile/app/(app)/(drawer)/[orgSlug]/notifications/new.tsx`:

```tsx
// new.tsx
const CHANNEL_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "push", label: "Push" },        // NEW
  { value: "email_sms", label: "Email + SMS" },
  { value: "all", label: "All channels" }, // NEW
];
// When push|all selected, default pushType="announcement" and pushResourceId=newly-created announcement id
```

**2b. Settings exposes all categories** — extend `apps/mobile/src/hooks/useNotificationPreferences.ts` and `apps/mobile/src/components/settings/SettingsNotificationsSection.tsx`:

Add toggles: `event_push_enabled`, `workout_push_enabled`, `competition_push_enabled`, `discussion_push_enabled`, `mentorship_push_enabled`, `donation_push_enabled`. Defaults must match migration defaults — verify against the latest `notification_preferences` migration before shipping.

**2c. Persisted notifications carry deep-link metadata** — schema change:

```sql
-- supabase/migrations/<timestamp>_notifications_add_deeplink_metadata.sql
alter table public.notifications
  add column if not exists type text,
  add column if not exists resource_id uuid,
  add column if not exists data jsonb default '{}'::jsonb;

create index if not exists notifications_type_idx on public.notifications(type);
```

Then:
- Update every server-side insert into `notifications` (announcement create, mentorship, etc.) to populate `type`, `resource_id`, and a `data` blob mirroring the push payload.
- `apps/mobile/src/hooks/useNotifications.ts` — surface these fields.
- `apps/mobile/app/(app)/(drawer)/[orgSlug]/notifications/index.tsx` — on row tap, build a `NotificationData` object and pass to the same `getNotificationRoute()` used for push taps. Replace the `// Future: navigate...` comment.

**Acceptance**

- [ ] Admin can send push-only and all-channel notifications from mobile composer
- [ ] All 9 backend categories togglable on mobile; defaults match DB defaults
- [ ] Inbox row tap deep-links via shared `getNotificationRoute()` (single source of truth)
- [ ] New `notifications.type/resource_id/data` columns populated on every insert path; backfill not required (nullable for legacy)

#### Phase 3 (P2): Robust notification center

**3a. Server-side read state** — new table:

```sql
-- supabase/migrations/<timestamp>_notification_reads.sql
create table public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

alter table public.notification_reads enable row level security;

-- Users can read/insert/delete their own read records
create policy "own reads select" on public.notification_reads
  for select using (user_id = auth.uid());
create policy "own reads insert" on public.notification_reads
  for insert with check (user_id = auth.uid());
create policy "own reads delete" on public.notification_reads
  for delete using (user_id = auth.uid());
```

- `useNotifications.ts` — fetch reads via join (`notifications left join notification_reads on user_id = auth.uid()`); compute unread = `read_at IS NULL`. Migrate AsyncStorage values once on first launch (best-effort import → bulk insert), then delete the AsyncStorage key.
- Mark-read/unread/mark-all-read mutate `notification_reads` instead of AsyncStorage.

**3b. Badge tied to unread** — in `usePushNotifications`:
- After every `useNotifications` refetch, call `Notifications.setBadgeCountAsync(unreadCount)`.
- Remove the "increment on foreground push" behavior; rely on the realtime refetch to update badge.

**3c. Queue large fanouts** — in `apps/web/src/lib/notifications/push.ts`:

```ts
const INLINE_FANOUT_LIMIT = 200;
if (recipients.length > INLINE_FANOUT_LIMIT) {
  await supabase.from("notification_jobs").insert({
    payload: { ...pushArgs, orgSlug }, // orgSlug must be persisted
    status: "queued",
  });
  return { queued: true, count: recipients.length };
}
// otherwise inline send
```

Ensure the `notification_jobs` cron dispatcher reads `orgSlug` from the payload and passes it to `sendPush()`.

**Acceptance**

- [ ] Read state syncs across web + mobile + reinstall
- [ ] Mobile badge equals server-side unread count after every refetch
- [ ] Org broadcasts to >200 users fully deliver via the queue (manual: send to test org with 250 push-enabled users; verify all receive)
- [ ] Queued jobs include `orgSlug`; deep-links work for queued sends

#### Phase 4 (P3): Operational polish

- `docs/push-notifications-runbook.md` — replace `last_seen_at` references with `updated_at` (verify against `user_push_tokens` schema first).
- Stale-token cleanup: add a Supabase cron (`pg_cron` or scheduled edge function) that deletes `user_push_tokens` with `updated_at < now() - interval '90 days'`.
- Optional master-push-off cleanup: when `push_enabled` flips to false, optionally call `signOutCleanup`-style token removal for the current device (gated behind a UX confirmation).
- Optional delivery receipt polling: after `sendPush`, persist Expo ticket IDs and a follow-up cron polls `https://exp.host/--/api/v2/push/getReceipts` for failure diagnostics.

**Acceptance**

- [ ] Runbook matches schema
- [ ] Stale tokens older than 90d auto-deleted; metric exposed
- [ ] (Optional) Delivery receipts surface failed pushes in an admin diagnostic view

## Alternative Approaches Considered

1. **Mobile resolves `orgSlug` client-side from `organizationId`** — rejected. Push payload is delivered as-is to the device; the client cannot mutate inbound payload, and we'd duplicate the lookup on every device.
2. **Encode route directly in payload (e.g., `data.route = "/foo/announcements/123"`)** — rejected. Couples push payload to current Expo Router paths; harder to change routes; loses the typed `NotificationData` contract used elsewhere.
3. **Drop AsyncStorage read cache entirely** — rejected for now. Keeping it as a write-through cache avoids a network round-trip on every render.
4. **Store full notification rows on device for offline inbox** — out of scope; can be added later without conflicting with this plan.

## System-Wide Impact

### Interaction Graph

- `POST /api/notifications/send` → resolves orgSlug → inserts `notifications` row (now with type/resource_id/data) → fans out via `sendPush` (inline) OR enqueues `notification_jobs` → cron worker (`/api/cron/notifications-dispatch`) drains queue → Expo Push API → device → `usePushNotifications` listener → `getNotificationRoute()` → `router.push`.
- `useNotifications` realtime subscription on `notifications` and `notification_reads` → recomputes unread → `setBadgeCountAsync(unread)` via `usePushNotifications`.

### Error & Failure Propagation

- Server: orgSlug-unresolved on push channel → 400 (don't silently drop).
- Server: queue insert failure → fall back to capped inline send + log + alert.
- Device: `getNotificationRoute` null → log to telemetry endpoint (we already have one) so we catch missing fields in production.
- DB: `notification_reads` insert with stale notification_id → cascade-delete handles cleanup.

### State Lifecycle Risks

- Notification row inserted but push fanout fails → row exists with no recipients reached. Mitigation: keep the row (it's still in-app inbox); add a `last_push_attempt_at` and dispatcher retry up to 3x.
- AsyncStorage→server read-state migration runs twice → `notification_reads` PK prevents duplicates.
- User toggles push off then back on → token may have been cleaned (P3); re-register on toggle-on.

### API Surface Parity

- Web composer, mobile composer, chat-message push, event-reminder cron, discussion notify, mentorship notify — all paths must include or resolve `orgSlug`. Phase 1 enforces this via `sendPush` signature.

### Integration Test Scenarios

1. **End-to-end push tap (per type)**: insert announcement via API → assert push payload includes `{orgSlug, type:"announcement", id}` → simulate `getNotificationRoute` on payload → assert `/announcements/[id]` route.
2. **Org broadcast >200 recipients**: seed 250 active push-enabled users → POST send → assert `notification_jobs` row created (not partial inline) → run dispatcher → assert all 250 tickets emitted.
3. **Read state cross-device sync**: mark read on web → mobile inbox unread count drops within realtime debounce.
4. **Read state reinstall**: mark all read → uninstall/reinstall mobile → unread count remains 0.
5. **DeviceNotRegistered cleanup still works** under queued path (token deletion happens in dispatcher, not just inline).

## Acceptance Criteria

### Functional Requirements

- [ ] Every push type (announcement, event, event_reminder, event_live_activity, chat, discussion, mentorship, donation, membership) deep-links correctly on tap, on iOS and Android
- [ ] `/api/notifications/send` resolves `orgSlug` from `organizationId` when omitted; rejects push when unresolvable
- [ ] Mobile composer can send push and all-channels
- [ ] Mobile settings exposes all 9 backend categories with correct defaults
- [ ] Inbox row tap routes via the same `getNotificationRoute()` as push tap
- [ ] Read state persists server-side, syncs across devices, survives reinstall
- [ ] Badge count equals server-side unread count after every refetch
- [ ] Org broadcasts >200 recipients fully deliver via queue

### Non-Functional Requirements

- [ ] No new N+1 queries in `useNotifications` (single join for reads)
- [ ] RLS policies on `notification_reads` restrict to `auth.uid()`
- [ ] Mobile unread badge update completes <500ms after realtime event
- [ ] Stale-token cleanup runs daily; tokens >90d old removed

### Quality Gates

- [ ] Route test matrix covers all 9 types + 4 missing-field cases
- [ ] Send-route test covers orgSlug resolution + reject path
- [ ] Queue-vs-inline send threshold test (boundary at 200)
- [ ] Read-state migration test (AsyncStorage import is idempotent)
- [ ] Manual TestFlight verification of push tap for each type before merging Phase 1

## Success Metrics

- **Push tap success rate**: % of push opens that result in a non-null route → target 100% (currently <100% due to missing orgSlug).
- **Admin push usage from mobile**: number of push/all-channel sends initiated from mobile composer per week → goal: >0 immediately, growth tracked.
- **Read-state divergence incidents**: support tickets mentioning "marked read on phone but unread on web" → target: 0 within 30 days of P2 ship.
- **Broadcast completeness**: for orgs >200 users, % of eligible recipients reached → target 100%.

## Dependencies & Risks

### Dependencies

- Existing `notification_jobs` table and dispatcher cron (already in repo per source).
- Supabase RLS helper conventions (already established).
- Expo SDK 54 push token APIs (already in use).

### Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Migrating AsyncStorage read state corrupts unread state | Med | Idempotent import keyed by `(notification_id, user_id)` PK; preserve AsyncStorage for one release as fallback. |
| Adding required `orgSlug` to `sendPush` signature breaks callers we didn't audit | Med | TypeScript will surface the breakage at compile time; add the param as required in one PR after auditing all call sites. |
| Notification row insert paths missed during type/resource_id backfill | Med | Make the columns nullable (legacy ok), but add a CI lint that any new `notifications` insert in `apps/web` includes both fields. |
| Schema migration timing collisions (per project memory) | Low | Generate timestamp at write time; check `supabase/migrations/` for collisions before commit. |
| Realtime badge update spam drains battery | Low | Debounce badge update by 500ms in `usePushNotifications`. |

## Resource Requirements

- 1 mobile + 1 backend engineer, ~1.5 weeks total.
- Phase 1: ~2 days. Phase 2: ~3 days (includes migration). Phase 3: ~3 days. Phase 4: ~1 day.
- TestFlight build slot for manual push verification.

## Future Considerations

- Live activities and Apple Wallet pushes already have plumbing in `notification_jobs`; this plan strengthens the queue so those features can land without rework.
- Per-device preferences (vs. per-user) if multi-device users want differentiated quiet hours.
- Notification grouping/threading on iOS via `threadIdentifier` once inbox metadata is stable.

## Documentation Plan

- Update `docs/push-notifications-runbook.md`: schema fixes (`updated_at`), new `notification_reads` table, queue-vs-inline threshold, stale-token cleanup cadence.
- New short doc `docs/notifications-deeplink-contract.md` capturing the `(orgSlug, type, id)` invariant and the canonical route table.
- Add a section to `apps/mobile/CLAUDE.md` pointing to the deep-link contract.

## Sources & References

### Internal References

- `apps/mobile/src/lib/notifications.ts:241-270` — `getNotificationRoute` (fix discussion mapping here)
- `apps/mobile/src/lib/chat-helpers.ts:15-23` — discussion route helper to reuse
- `apps/web/src/app/api/notifications/send/route.ts:73-77,162-164,318-328` — orgSlug resolution insertion point
- `apps/web/src/lib/notifications/push.ts` — `sendPush` signature; queue threshold
- `apps/mobile/app/(app)/(drawer)/[orgSlug]/notifications/new.tsx` — composer CHANNEL_OPTIONS
- `apps/mobile/src/hooks/useNotificationPreferences.ts` + `SettingsNotificationsSection.tsx` — category toggles
- `apps/mobile/src/hooks/useNotifications.ts` — read-state join + realtime
- `apps/mobile/app/(app)/(drawer)/[orgSlug]/notifications/index.tsx` — inbox tap handler
- `docs/push-notifications-runbook.md` — runbook drift to fix

### External References

- Expo push payload contract: <https://docs.expo.dev/push-notifications/sending-notifications/>
- Expo receipts API: <https://docs.expo.dev/push-notifications/sending-notifications/#push-receipts>
- Supabase RLS patterns (already used elsewhere in this repo)

### Related

- Project memory: migration timestamp collision risk; Supabase RPC patterns; linter hook may rewrite components — re-read after edits.
