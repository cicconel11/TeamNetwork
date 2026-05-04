# Push Notifications Runbook

When a user reports "I'm not getting push notifications," walk this list top to bottom. The wiring is correct in code — failures are almost always in credentials, token state, or per-user prefs.

## 1. APNs key registered with Expo (most common cause on iOS)

TestFlight and App Store builds use **production APNs**. If only a development APNs cert is uploaded, every send returns success but no banner ever appears on the device.

```bash
cd apps/mobile
eas credentials
# → iOS → Production → "Push Notifications: Push Notifications Key"
```

If absent:

1. https://developer.apple.com → Certificates, Identifiers & Profiles → Keys → **+**
2. Enable "Apple Push Notifications service" → Continue → Register
3. Download the `.p8` (one-time — Apple will not let you re-download)
4. Note the **Key ID** and your **Team ID**
5. Back in `eas credentials`, choose "Set up a new push key" and upload

After uploading, **reinstall the TestFlight build** on the device. Tokens issued before the key was registered may be stale; the next launch refreshes the token via `usePushNotifications`.

## 2. Token row exists in `user_push_tokens`

Run against the project's Supabase:

```sql
select user_id, platform, expo_push_token, updated_at
from user_push_tokens
where user_id = '<auth.uid()>';
```

Expected: at least one row with `platform = 'ios'` and `expo_push_token` starting with `ExponentPushToken[`.

If missing:
- Confirm the user accepted the iOS permission prompt (Settings → TeamMeet → Notifications → Allow Notifications must be ON).
- Confirm the build is on a **physical device** — `Device.isDevice` is false in the simulator and `getExpoPushToken()` no-ops there (`apps/mobile/src/lib/notifications.ts:113`).
- Force-foreground the app while signed in. Registration runs from `apps/mobile/src/hooks/usePushNotifications.ts` on auth.

## 3. Per-user preferences not blocking

```sql
select push_enabled, chat_push_enabled, announcement_push_enabled,
       event_push_enabled, event_reminder_push_enabled,
       discussion_push_enabled, mentorship_push_enabled
from notification_preferences
where user_id = '<auth.uid()>'
  and organization_id = '<org id>';
```

- Master `push_enabled = false` → all categories blocked.
- Per-category `*_push_enabled = false` → only that surface blocked.
- No row at all → **defaults apply** (announcement / chat / event_reminder are on by default; event / discussion / mentorship / workout / competition are off).

If the user opted in via Settings → Notifications but the row is missing, ask them to toggle and save again — that path inserts the row.

## 4. Server-side smoke test

From a Node REPL or a one-shot script with the service role key, call `sendPush` directly:

```ts
import { sendPush } from "@/lib/notifications/push";
import { createServiceClient } from "@/lib/supabase/service";

const supabase = createServiceClient();
const result = await sendPush({
  supabase,
  organizationId: "<org id>",
  targetUserIds: ["<user id>"],
  title: "ping",
  body: "smoke test",
  category: "chat",
  pushType: "chat",
  pushResourceId: "<any uuid>",
  orgSlug: "<slug>",
});
console.log(result);
```

Interpretation:

- `sent: 1, errors: []` → Expo accepted the ticket. If no banner: **APNs creds (step 1)**.
- `sent: 0, skipped: 1` → preferences blocked the user (**step 3**) or no token row (**step 2**).
- `errors: ["DeviceNotRegistered: …"]` → token is stale; the row is auto-deleted, ask the user to reinstall.
- `errors: ["MessageRateExceeded"]` → backoff and retry.
- `errors: ["MismatchSenderId" / "InvalidCredentials"]` → APNs key not registered or wrong Team ID.

## 5. Sandbox vs production mismatch

If the build is a `--profile development` dev client, it uses **sandbox APNs**. The same `.p8` key works for both, but if the device was previously paired to a production build, iOS may cache the production token. Symptom: `sent: 1` from the server, `DeviceNotRegistered` on next send.

Fix: delete the app from the device, reinstall, sign in, accept perms, retry.

## Where each surface is wired

| Surface | Triggered from | Category |
|---|---|---|
| Chat message | `apps/web/src/app/api/chat/[groupId]/messages/route.ts` | `chat` |
| Announcement | `apps/web/src/app/[orgSlug]/announcements/new/page.tsx` → `/api/notifications/send` | `announcement` |
| Event create | `apps/web/src/app/[orgSlug]/calendar/events/new/page.tsx` → `/api/notifications/send` | `event` |
| Event 24h/1h reminder | `apps/web/src/app/api/cron/notification-dispatch/route.ts` | `event_reminder` |
| Discussion thread | `apps/web/src/lib/discussions/notifications.ts` (`notifyNewThread`) | `discussion` |
| Discussion reply | `apps/web/src/lib/discussions/notifications.ts` (`notifyNewReply`) | `discussion` |
| Mentorship request | `apps/web/src/app/api/organizations/[organizationId]/mentorship/requests/route.ts` | `mentorship` |
| Mentorship accept | `apps/web/src/app/api/organizations/[organizationId]/mentorship/pairs/[pairId]/route.ts` | `mentorship` |

## Fan-out cap

`sendPush()` only sends inline up to `INLINE_PUSH_TOKEN_CAP = 200` tokens (`apps/web/src/lib/notifications/push.ts`). Larger broadcasts overflow with a warning. The `notification_jobs` queue + `cron/notification-dispatch` route is the eventual home for those, but it depends on the `dispatch_notification_jobs_lease` RPC (see `supabase/migrations/`).
