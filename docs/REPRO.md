# Bug Reproduction Guide

## Enabling Debug Mode

Set `NEXT_PUBLIC_DEBUG=true` in `.env.local` and restart the dev server:

```bash
echo 'NEXT_PUBLIC_DEBUG=true' >> .env.local
npm run dev
```

Debug output appears as `[debug][tag]` in browser console (client) and terminal (server).
Always-on warnings appear regardless of debug mode as `console.warn(...)`.

---

## Issue #1: QR Code Generation Failures

**Location:** `/{orgSlug}/settings/invites` > QR code modal

**Steps to reproduce:**
1. Navigate to `/{orgSlug}/settings/invites`
2. Click the QR code icon for any invite link
3. Observe the QR code display (or error state)

**Expected:** QR code renders for the invite URL.

**Actual:** QR code sometimes fails to render, showing an error state.

**Debug output to look for:**
- `[debug][qr-code] generating` — logs URL length, first 50 chars, and requested size
- `[debug][qr-code] generated ok` — logs SVG string length on success
- `[debug][qr-code] generation error` — logs the error from the QR library

**Likely root cause:** Unknown — needs diagnostics. Could be URL length exceeding QR capacity, library error, or SVG rendering failure.

---

## Issue #2: Graduation Date Mover — Incomplete Transitions

**Location:** Graduation cron (`/api/cron/graduation-check`) and reinstate API

**Steps to reproduce:**
1. Set a member's `expected_graduation_date` to today or earlier
2. Trigger the graduation cron: `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/graduation-check`
3. Check the member's state in both `user_organization_roles` and `alumni` tables
4. Optionally: move the graduation date forward and re-run to test reinstatement

**Expected:** Member transitions to alumni role, and an alumni record is created by the DB trigger.

**Actual:** Role may update but alumni record may not be created if the `handle_org_member_sync` trigger fails silently.

**Debug output to look for:**
- `[debug][graduation] transitionToAlumni start` — params (masked)
- `[debug][graduation] transitionToAlumni result` — RPC outcome
- `[debug][graduation-cron] processing member` — per-member processing
- `[debug][graduation-cron] capacity check` — capacity result
- `[debug][graduation-cron] batch summary` — totals at end
- `[debug][reinstate] precondition check` — state before reinstatement

**Likely root cause:** The `transitionToAlumni()` RPC updates the role and sets `graduated_at`, but relies on a DB trigger (`handle_org_member_sync`) to create the alumni record. If the trigger fails silently, the transition is incomplete.

---

## Issue #3: Alumni Count Mismatch

**Location:** `checkAlumniCapacity()` in `src/lib/graduation/queries.ts`

**Steps to reproduce:**
1. Trigger transitions for multiple members (see Issue #2)
2. Check server logs for the always-on mismatch warning

**Expected:** Count from `alumni` table matches count from `user_organization_roles WHERE role='alumni'`.

**Actual:** Counts may diverge when trigger doesn't create alumni records.

**Debug output to look for:**
- **Always-on:** `[graduation] ALUMNI COUNT MISMATCH: org=... alumni_table=N roles_table=M`
- `[debug][graduation] checkAlumniCapacity` — both counts, bucket, limit

**Root cause:** `checkAlumniCapacity()` counts from the `alumni` table, but DB-level quota enforcement in `20260412093000_alumni_quota_enforcement.sql` also counts from `alumni WHERE deleted_at IS NULL`. If `transitionToAlumni()` changes the role but the trigger doesn't create an alumni record, the two sources diverge.

---

## Issue #4: Chat — Cannot Add/Remove Users After Creation

**Location:** `/{orgSlug}/chat/{groupId}`

**Steps to reproduce:**
1. Create a chat group with some members
2. Open the chat group
3. Look for a way to add or remove members from the group

**Expected:** Moderators or admins can add/remove members from an existing chat group.

**Actual:** No UI or API endpoint exists to modify group membership after creation. RLS policies support it, but the feature is missing.

**Debug output to look for:**
- `[debug][chat] ChatRoom mounted` — logs `hasEditMembersUI: false` to document the gap

**Root cause:** Missing feature, not a bug. The `hasEditMembersUI: false` flag in debug output confirms there is no add/remove members UI.

**Update (Feb 2026):** The `chat_group_members` table now has `removed_at` soft-deletion, `added_by` tracking, and a re-add via UPDATE pattern (migration `20260429100000_chat_group_member_management.sql`). The DB schema supports add/remove operations. UI implementation may still be pending.

---

## Issue #5: Forms Admin — Can't See Submission Results

**Location:** `/{orgSlug}/forms/admin/{formId}`

**Steps to reproduce:**
1. Create a form with at least one field
2. Submit the form as a member (fill page at `/{orgSlug}/forms/{formId}`)
3. Navigate to the admin view at `/{orgSlug}/forms/admin/{formId}`
4. Observe the submissions table — field values show as "-"
5. Try exporting CSV — field columns are empty

**Expected:** Submission field values are visible in the table and exported CSV.

**Actual:** All field values show as "-" (empty) because the code reads `submission.data` but the DB column is `responses`.

**Debug output to look for:**
- **Always-on:** `[forms-admin] Submission has "responses" but not "data"...`
- `[debug][forms-admin] submission property check` — shows `hasDataProp` and `hasResponsesProp`
- `[debug][forms-export] exporting` — logs submission and field counts

**Root cause:** The DB migration (`20260108020000_forms.sql`) defines the column as `responses`, but the generated TypeScript types (`database.ts:2234`) show `data`. The admin page reads `submission.data` which is `undefined`. The fill page correctly reads `submission.responses`. The instrumentation now tries both properties as a workaround.

---

## Issue #6: Schedule Sync — Missing Events

**Location:** Schedule calendar view and `/api/cron/schedules-sync`

**Steps to reproduce:**
1. Set up a schedule source (ICS or vendor URL)
2. Trigger sync: `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/schedules-sync`
3. View schedule events at `/{orgSlug}/schedules`
4. Compare events shown vs events in the source feed

**Expected:** All non-cancelled events from the source feed appear in the calendar.

**Actual:** Some events may be missing. Possible causes: window filtering, dedup dropping events, cancelled events returned to client.

**Debug output to look for:**
- `[debug][schedule-sync] syncScheduleEvents dedup+filter` — raw, deduped, and window-filtered counts
- `[debug][schedule-sync] existing events loaded` — existing count and cancelled count
- `[debug][schedule-sync] syncScheduleEvents result` — imported, updated, cancelled
- `[debug][schedule-sync] source synced` — per-source summary
- `[debug][schedule-cron] batch complete` — overall success/error counts
- **Always-on:** `[schedule-events] WARNING: Returning N cancelled events — no status filter applied`
- `[debug][schedule-events] query result` — total, confirmed, cancelled, date range

**Likely root causes:**
- (a) Cancelled events are returned to the client without filtering — the query has no `status != 'cancelled'` filter
- (b) Window filtering in `syncScheduleEvents` drops events outside the sync window
- (c) Connector parsing silently drops events during extraction
