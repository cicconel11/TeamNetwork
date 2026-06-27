# Mobile Schema Surface

**Scope:** The database surface specific to the Expo / React Native client (`apps/mobile/`) — push notifications, iOS Live Activities, Apple Wallet passes, and web→mobile auth handoff — plus the tables the mobile client reads/writes directly.

**Source of truth:** `apps/web/src/types/database.ts`. Per-table column dumps live in `docs/db/okf/*.md`. This doc is hand-maintained and summarized in [`schema-audit.md`](./schema-audit.md).

> **Freshness note.** `wallet_pass_registrations` (migration `20261206000001`) is documented here from its migration but is missing from the generated `database.ts`/OKF index (types not regenerated). Run `gen:types` then `bun run gen:db-okf` to close that gap. All other tables below have OKF docs.

---

## Server-mediated mobile tables

These back native mobile features but are **service-role only** — the mobile client never queries them directly; it hits an API route that runs the privileged RPC/insert.

### `live_activity_tokens` — iOS Live Activity push tokens

One row per running ActivityKit Live Activity (lock-screen / Dynamic Island event card). Holds the APNs token the dispatcher pushes LA `update`/`end` payloads to. Migration `20261110000004`.

- **PK** `activity_id` (text, ActivityKit-issued).
- **Columns:** `activity_id`, `user_id`, `event_id`, `organization_id`, `device_id`, `push_token` (transit-only secret), `started_at`, `ends_at`, `ended_at` (null = active), `created_at`, `updated_at`.
- **FKs:** `user_id`→`users` CASCADE, `event_id`→`events` CASCADE, `organization_id`→`organizations` CASCADE.
- **Constraints:** partial unique `(user_id, event_id) WHERE ended_at IS NULL` (one active LA per user/event); partial indexes on `event_id` (fan-out) and `(user_id, device_id)` (sign-out teardown).
- **RLS:** enabled, no policies → service-role only.
- **Trigger:** `BEFORE DELETE ON users` enqueues `live_activity_end` `notification_jobs` for every still-active LA so devices tear down before CASCADE.
- **Client path:** native `modules/live-activity` (Swift) starts the LA; `LiveActivityContext.tsx` POSTs the ActivityKit token to `/api/live-activity/register` (and `/unregister`).

### `wallet_pass_registrations` — Apple Wallet (PassKit) device registrations _(Phase 4 — not yet wired)_

Intended to hold PassKit web-service registrations for push-update of installed `.pkpass` passes. Migration `20261206000001`. _(Not yet in `database.ts`/OKF.)_

> **Status:** This table is a **forward placeholder**. The migration comment states it is "stored now so Phase 4 can ship without a separate migration window." As of this writing **no application code reads or writes it** — there are no `/api/wallet/v1/devices/...` PassKit registration endpoints and no pass-update push path in `apps/web`. The only _live_ wallet feature is the one-way `.pkpass` download (see Client path below). Treat the registration/push flow below as planned, not implemented.

- **PK** `id` (uuid). **Unique** `(pass_type_identifier, serial_number, device_library_identifier)`.
- **Columns:** `pass_type_identifier`, `serial_number`, `device_library_identifier`, `push_token`, `authentication_token`, `created_at`, `last_updated_at`. No outbound FKs.
- **RLS:** enabled, no policies → service-role only.
- **Client path (live today):** `apps/mobile/src/lib/add-to-wallet.ts` downloads a signed `.pkpass` from the existing `/api/wallet/...` routes (`member`, `event`, `receipt`) and hands it to the iOS share sheet. There is no device-registration round-trip yet.

### `mobile_auth_handoffs` — web→mobile session handoff

Short-lived encrypted session handoff so a web-authenticated user lands signed-in inside the mobile app (e.g. OAuth bounce).

- **Columns:** `id`, `user_id`, `code_hash`, `encrypted_access_token`, `encrypted_refresh_token`, `expires_at`, `consumed_at` (null = unconsumed), `created_at`. No outbound FKs.
- **Consumed via:** RPC `consume_mobile_auth_handoff(p_code_hash)` → `{encrypted_access_token, encrypted_refresh_token, user_id}`.
- **Client path:** `apps/mobile/src/lib/mobile-auth.ts` POSTs the code to `/api/auth/mobile-handoff/consume`; the server runs the RPC.

### `notification_jobs` — outbound notification/push queue

Durable work queue for the dispatcher cron (`/api/cron/notification-dispatch`). Includes `live_activity_end` jobs.

- **Columns (19):** `id`, `organization_id`, `kind`, `priority`, `status`, `attempts`, `leased_at`, `scheduled_for`, `sent_at`, `title`, `body`, `data` (Json), `audience`, `target_user_ids` (uuid[]), `category`, `push_type`, `push_resource_id`, `last_error`, `created_at`. FK `organization_id`→`organizations`.
- **Leasing RPC:** `dispatch_notification_jobs_lease(p_batch_size default 50)` (migration `20261201000000`) — single-statement `FOR UPDATE SKIP LOCKED` claim that flips `pending`→`processing`. Service-role only.

### `event_reminder_sends` — reminder idempotency log

Dedup table so overlapping cron runs don't double-enqueue one-shot event reminders. Migration `20261203000001`.

- **Composite PK** `(event_id, kind)`; column `sent_at`. FK `event_id`→`events` CASCADE. RLS enabled, no policies.

---

## Notification tables the mobile client uses directly

| Table                      | Role                                                                                                                                                                                                                                                               | Mobile access                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_push_tokens`         | Per-device Expo push tokens (`expo_push_token`, `device_id`, `platform`). Conflict key `user_id,expo_push_token`. Cleaned by `cleanup_stale_push_tokens(interval '90 days')` (migration `20261202000002`) and on Expo `DeviceNotRegistered`. FK `user_id`→`users`. | **Read/write** — the one push table the mobile client writes (`src/lib/notifications.ts`): upsert on register, delete on logout / stale-device replacement. |
| `notification_preferences` | Per-user/org push toggles per category (`*_push_enabled`), quiet hours, channel enables (33 cols). FK→`organizations`.                                                                                                                                             | **Read/write** (`useNotificationPreferences.ts`).                                                                                                           |
| `notifications`            | In-app notification records (audience, channel, type, resource_id, target_user_ids; 14 cols). FK→`organizations`.                                                                                                                                                  | **Read** (`useNotifications.ts`).                                                                                                                           |
| `notification_reads`       | Read receipts (`notification_id`, `user_id`, `read_at`). FK→`notifications`.                                                                                                                                                                                       | **Read/write** (`useNotifications.ts`).                                                                                                                     |

---

## Tables the mobile client queries directly

From `apps/mobile/src` (`.from(...)`). Push/notification-relevant ones in **bold**:

`academic_schedules`, `alumni`, `announcements`, `chat_group_members`, `chat_groups`, `competition_points`, `competition_teams`, `competitions`, `event_rsvps`, `events`, `expenses`, `feed_comments`, `feed_likes`, `feed_poll_votes`, `feed_posts`, `form_document_submissions`, `form_documents`, `form_submissions`, `forms`, `job_postings`, `media_uploads`, `member_streaks`, `members`, `mentor_profiles`, `mentorship_logs`, `mentorship_pairs`, **`notification_preferences`**, **`notification_reads`**, **`notifications`**, `organization_donation_stats`, `organization_donations`, `organization_invites`, `organizations`, `parents`, `reactions`, `records`, `schedule_files`, `user_blocks`, `user_organization_roles`, **`user_push_tokens`**, `users` (plus the `avatars` storage bucket).

> `event_rsvps.track_on_lock_screen` (default `true`, migration `20261203000002`) is load-bearing for Live Activities: `useActiveEventsForLiveActivity.ts` reads RSVPs with `status='attending'` and `track_on_lock_screen=true` to decide which events get a Live Activity.

The mobile-specific tables above (`live_activity_tokens`, `mobile_auth_handoffs`, `wallet_pass_registrations`, `notification_jobs`, `event_reminder_sends`) are **not** queried directly — all server-mediated.

---

## Data flows

**Push (standard).** Mobile upserts its Expo token into `user_push_tokens` → server events enqueue `notification_jobs` (gated by `notification_preferences`) → dispatcher cron leases via `dispatch_notification_jobs_lease(...)`, sends to Expo using `user_push_tokens`, deletes tokens on `DeviceNotRegistered`; `cleanup_stale_push_tokens()` prunes >90-day-stale tokens. In-app: mobile reads `notifications`, writes `notification_reads`.

**Live Activities (iOS).** `useActiveEventsForLiveActivity` finds attending RSVPs with `track_on_lock_screen=true` → native module starts the Activity → `LiveActivityContext` POSTs the token to `/api/live-activity/register` → server inserts `live_activity_tokens` → dispatcher fans out LA `update`/`end` pushes by `event_id`. Ends on `/unregister` (sign-out), RSVP change, event cancel, 24h expiry, or the user-delete trigger.

**Wallet passes (PassKit).** _Live today:_ `add-to-wallet.ts` downloads a signed `.pkpass` from `/api/wallet/...` → iOS adds it (one-way; static pass). _Planned (Phase 4, not yet built):_ the pass's `webServiceURL` would register the device at `/api/wallet/v1/devices/...` → server writes `wallet_pass_registrations` → server pushes pass updates. Those endpoints and the push path do not exist yet.

**Web→mobile auth handoff.** Web creates an encrypted `mobile_auth_handoffs` row (hashed code, encrypted tokens, `expires_at`) → mobile POSTs the code to `/api/auth/mobile-handoff/consume` → server runs `consume_mobile_auth_handoff(p_code_hash)`, returns the decryptable session, sets `consumed_at`.

---

## Related docs

- [`docs/db/schema-audit.md`](./schema-audit.md) — full schema snapshot (this doc is its mobile deep-dive).
- [`docs/db/ai-schema.md`](./ai-schema.md) — AI subsystem schema deep-dive.
- [`apps/mobile/CLAUDE.md`](../../apps/mobile/CLAUDE.md) — mobile app dev guide (routing, styling, release flow).
- `docs/db/okf/*.md` — generated per-table column reference.
