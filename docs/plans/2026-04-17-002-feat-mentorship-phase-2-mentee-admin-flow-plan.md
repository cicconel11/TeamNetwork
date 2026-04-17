---
title: "feat: Mentorship Matching Phase 2 — Mentee Intake + Admin Match Queue"
type: feat
status: pending
date: 2026-04-17
origin: /Users/mleonard/.claude/plans/this-is-an-email-virtual-crystal.md
depends_on: "docs/plans/YYYYMMDD-001-feat-mentorship-phase-1-data-matching-plan.md"
---

# feat: Mentorship Matching Phase 2 — Mentee Intake + Admin Match Queue

## Context

Phase 2 of a 3-phase mentorship matching build for prospect (college athletics mentor program). Phase 1 shipped schema + deterministic matching library; Phase 2 closes the product loop so admin + mentees can actually use it without AI.

**Trust model** (locked in Phase 1): auditable weighted scoring + admin approves every pair. No black box. Every match exposes signals to admin + mentee.

**Why isolate Phase 2 from Phase 3**: closes product loop without AI dependency; demoable standalone (admin queue screen-record for sales pitch); AI integration (Phase 3) is higher-risk and should not block a shippable product.

**Prerequisites** (from Phase 1, verified against `supabase/migrations/20261017180000_mentorship_matching.sql`):
- `mentor_profiles` has `max_mentees, current_mentee_count, accepting_new, topics, time_commitment, meeting_preferences, years_of_experience`
- `mentorship_pairs` status CHECK allows `proposed|accepted|declined|active|paused|completed|expired` + `proposed_by, proposed_at, accepted_at, declined_at, declined_reason, match_score, match_signals, deleted_at`
- Capacity trigger maintains `current_mentee_count` (counts `proposed|accepted|active|paused`)
- RLS allows mentees to INSERT `status='proposed'`, mentors to UPDATE proposed→accepted|declined
- `rankMentorsForMentee(menteeInput, mentorInputs, options)` in `src/lib/mentorship/matching.ts` — single source of truth for weights (NOT `rankMentorsForMentee`; also exports `scoreMentorForMentee`)
- `notification_preferences.mentorship_emails_enabled` column already added (line 419 of Phase 1 migration)

## Scope

Closer to ~18-22 files modified/created once generated types, i18n strings, and mentorship page query splits are included. Estimated 1 focused week if implemented in two slices: schema/API first, then UI. Demoable standalone at end.

## Implementation guardrails

- **Do not let proposal rows break the existing mentorship workspace.** `status='proposed'|'declined'|'expired'` rows are queue artifacts, not working mentorship pairs. Existing Activity / Tasks / Meetings surfaces must continue to operate only on accepted-or-beyond pair states. Phase 2 therefore needs an explicit query split:
  - `workingPairs`: `accepted|active|paused|completed`
  - `proposalPairs`: `proposed|declined|expired`
- **Stay on the existing forms surface.** The canonical mentee intake is still a normal `forms` record and uses the existing `/forms/[formId]` submission page. The mentorship banner is only a shortcut into that system form, not a separate intake UI.
- **Keep side effects retry-safe.** Pair acceptance is the source of truth. Chat bootstrap and notifications happen after the status transition and must be idempotent / safe to retry; notification failure must not silently revert accepted state.
- **Keep match-round output narrow.** Phase 2 writes at most one admin-generated open proposal per mentee at a time. No speculative top-N queue explosion in this phase.

## Codex Adversarial Review — Amendments A, B, C

Applied to §2.1, §2.2, §2.3 below. Source: Phase 1 plan (Codex review, verdict needs-attention, high-severity gaps).

- **Amendment A (§2.1)** — canonical intake identity: `forms.system_key` + `form_kind`, immutability trigger, `mentee_latest_intake` view (dedupe via DISTINCT ON).
- **Amendment B (§2.2)** — partial unique index on `mentorship_pairs` + `accept_mentorship_proposal` RPC (FOR UPDATE lock, chat dedupe via `ensureDirectChatGroup`, transactional), idempotent `/requests` via `ON CONFLICT DO NOTHING`.
- **Amendment C (§2.3)** — cron auth via `validateCronAuth` + audit log entry per expiration.

## Tasks

### 2.1 Mentee intake form (seed + typed access)

**Amendment A — canonical intake identity**

Migration MUST include (in addition to seed):
- ALTER `forms` ADD `system_key text`, `form_kind text` default `'custom'` with CHECK in (`custom`,`mentee_intake`,`mentor_intake`,`mid_cycle_feedback`,`end_cycle_feedback`)
- Partial unique: `CREATE UNIQUE INDEX forms_system_key_unique ON forms(organization_id, system_key) WHERE system_key IS NOT NULL`
- Seed inserts set `system_key='mentee_intake_v1'`, `form_kind='mentee_intake'`
- `BEFORE UPDATE` trigger raises if `system_key` or `form_kind` changes (admins can edit title/description/fields only)
- RLS UPDATE policy WITH CHECK preserves these invariants as defense-in-depth
- REPLACE `mentee_intake_responses` view with `mentee_latest_intake`. NOTE: `form_submissions` DOES have `deleted_at`; the view must exclude soft-deleted submissions. Response payload is `fs.data` JSONB (renamed from `responses` by `20260206100001_fix_form_submissions_column.sql`) — NOT `fs.responses`:
  ```sql
  CREATE VIEW mentee_latest_intake AS
  SELECT DISTINCT ON (fs.user_id, f.organization_id)
         fs.id, fs.form_id, fs.user_id, fs.submitted_at, fs.data,
         f.organization_id
    FROM form_submissions fs
    JOIN forms f ON f.id = fs.form_id
   WHERE f.form_kind = 'mentee_intake'
     AND fs.deleted_at IS NULL
     AND f.deleted_at IS NULL
   ORDER BY fs.user_id, f.organization_id, fs.submitted_at DESC;
  ```
- `extractMenteeSignals` (§2.1 wire-into-matching) reads from `mentee_latest_intake` → deterministic: latest submission wins. Reads JSONB keys from `data` column. Document this behavior.

**Migration** — `supabase/migrations/YYYYMMDDHHMMSS_mentorship_intake_form_seed.sql`

Seeds a canonical "Mentee Intake" form per org via INSERT into `forms`. Admins can edit after seeding. Fields:
- `goals` (textarea, required)
- `preferred_topics` (multiselect — populated from the same normalized vocabulary used by `mentor_profiles.topics`; no new taxonomy table in Phase 2)
- `preferred_industry` (multiselect — canonical list from `src/lib/falkordb/career-signals.ts`)
- `time_availability` (select: `1hr/month | 2hr/month | 4hr/month | flexible`)
- `communication_prefs` (multiselect: `video | phone | in_person | async`)
- `geographic_pref` (text)
- `mentor_attributes_required` (multiselect)
- `mentor_attributes_nice_to_have` (multiselect)

Also creates view `mentee_latest_intake` (see Amendment A above) over `form_submissions` filtered by `form_kind='mentee_intake'`, projecting JSONB `data` keys into typed columns for query convenience.

Phase 2 accepts that this seeded intake form may also appear on the normal `/forms` page. That is acceptable for now; the mentorship banner is the primary entry point, but no new forms surface is introduced in this phase.

**Schema extension** — `src/lib/schemas/mentorship.ts`
- Add `menteeIntakeSchema` (Zod) mirroring form fields
- Export for reuse in API route validation

**Wire into matching** — `src/lib/mentorship/matching-signals.ts`
- Phase 1 `extractMenteeSignals(input: MenteeInput)` is already fully implemented (accepts `{userId, orgId, focusAreas?, preferredIndustries?, preferredRoleFamilies?, currentCity?, graduationYear?, currentCompany?}`) — NOT a stub. Phase 2 adds a DB-reading wrapper: new helper `loadMenteeIntakeInput(supabase, menteeUserId, orgId) → MenteeInput` that SELECTs from `mentee_latest_intake`, maps `data` JSONB keys to `MenteeInput` fields, then passes to existing `extractMenteeSignals`.
- Backward compatible: if no intake row, helper returns `MenteeInput` with only `{userId, orgId}` so callers can merge in explicit `focusAreas` — keeps Phase 1 tests green.

### 2.2 API routes

**Amendment B — proposal idempotency + transactional acceptance**

Phase 1 did NOT ship a unique index on active pairs (only non-unique `mentorship_pairs_status_idx`). Phase 2 migration MUST add:
- Partial unique index preventing duplicate active pairs:
  ```sql
  CREATE UNIQUE INDEX mentorship_pairs_active_pair_unique
    ON mentorship_pairs (organization_id, mentor_user_id, mentee_user_id)
    WHERE status IN ('proposed','accepted','active','paused') AND deleted_at IS NULL;
  ```

**Prerequisite refactor** — `src/lib/chat/direct-chat.ts` does NOT currently export `ensureDirectChatGroup`. Actual exports: `findExactDirectChatGroup`, `resolveChatMessageRecipient`, `sendAiAssistedDirectChatMessage`. Creation is inline via private `createDirectChatGroup` + `ensureChatGroupMember`. Phase 2 must first extract:
```ts
export async function ensureDirectChatGroup(
  supabase,
  { userAId, userBId, orgId }: { userAId: string; userBId: string; orgId: string }
): Promise<{ chatGroupId: string; reused: boolean }>
```
Composes existing `findExactDirectChatGroup` → on miss, call the now-exported `createDirectChatGroup` + `ensureChatGroupMember` for both users. Commit this refactor separately before the accept RPC wiring.

- RPC `accept_mentorship_proposal(pair_id uuid, admin_override boolean default false)` — single transaction:
  1. `SELECT ... FOR UPDATE` on pair row (serialize concurrent accepts)
  2. Validate caller (`auth.uid()`) vs current status transition (mentor accept proposed→accepted; admin accept any)
  3. UPDATE status→accepted, set `accepted_at=now()`
  4. Capacity trigger (Phase 1) recomputes
  5. API route (not the RPC) calls `ensureDirectChatGroup(supabase, {userAId: mentor_user_id, userBId: mentee_user_id, orgId})` — NEVER raw-insert `chat_groups`/`chat_group_members`. (Chat creation stays in TS layer because RLS + service-role split doesn't compose cleanly inside a Postgres function.)
  6. Enqueue notification via `sendNotificationBlast`
  7. Return `{pair_id, chat_group_id, reused_chat: boolean}`

Acceptance side-effect policy:
- The DB state transition is canonical; chat bootstrap + notifications are follow-up side effects.
- `ensureDirectChatGroup` must be idempotent and safe to retry.
- Notification sending is best-effort and non-blocking; failures are logged and surfaced, but do not revert `accepted_at`.
- If the route sees an accepted pair with no direct chat yet, it should attempt `ensureDirectChatGroup` before returning.

`/requests` POST handler: wrap INSERT in `ON CONFLICT (organization_id, mentor_user_id, mentee_user_id) WHERE status IN (...) DO NOTHING RETURNING *`. If no row returned, SELECT existing and return 200 with existing pair (true idempotency — concurrent requests converge to one row).

Verification additions:
- Concurrent proposals test: fire 5 parallel POST `/requests` for same (mentor, mentee) → exactly 1 row exists.
- Concurrent accepts: 2 parallel PATCH accept → one succeeds, one returns 409 (status already transitioned).
- Direct-chat dedupe: accept pair where mentor+mentee already have direct chat from non-mentorship context → `reused_chat=true`, no duplicate group.

**`POST /api/organizations/[organizationId]/mentorship/suggestions`**
- Body: `{ mentee_user_id, limit?: number (default 10) }`
- Auth: admin OR self (`auth.uid() === mentee_user_id`)
- Calls `rankMentorsForMentee` — returns ranked mentors with scores + signals
- Rate limit via existing `src/lib/security/rate-limit.ts` pattern

**`POST /api/organizations/[organizationId]/mentorship/requests`**
- Body: `{ mentor_user_id }`
- Auth: active_member caller
- Inserts `mentorship_pairs` with `status='proposed', mentee_user_id=auth.uid(), mentor_user_id, match_score, match_signals` (scores fetched via `rankMentorsForMentee` filtered to this one mentor)
- Fires `mentor_proposal_received` notification to mentor
- Idempotent: returns existing proposal if mentee has already requested this mentor

**`PATCH /api/organizations/[organizationId]/mentorship/pairs/[pairId]`**
- Body: `{ action: 'accept' | 'decline' | 'override_approve', reason?: string }`
- Auth:
  - `accept` | `decline`: pair's mentor OR admin
  - `override_approve`: admin only (for admin-initiated pairs or overrides)
- Transitions:
  - `proposed → accepted`: sets `accepted_at`; bootstraps or reuses a 2-member direct chat via `ensureDirectChatGroup`; fires `mentor_proposal_accepted` notification to mentee; capacity trigger handles count
  - `proposed → declined`: sets `declined_at, declined_reason`; fires `mentor_proposal_declined` notification to mentee
- RLS enforced at DB layer; API validates action ↔ role combo as defense-in-depth

**`GET /api/organizations/[organizationId]/mentorship/admin/queue`**
- Auth: admin only
- Returns all `status='proposed'` pairs for org with: score, signals, mentee intake summary (joined from view), mentor profile snapshot
- Sorted by score desc by default, with `?sort=proposed_at|mentee_name` options

### 2.3 Cron — `src/app/api/cron/mentor-match-expire/route.ts`

- Schedule: daily `0 8 * * *` (8am UTC)
- Query: `status='proposed' AND proposed_at < now() - interval '14 days'`
- Transition: `status='expired'`
- Mentee can re-request; 14-day default configurable via org setting later
- Register in `vercel.json`

**Amendment C — cron auth + audit log**

- Route handler FIRST LINE: call `validateCronAuth(request)` from `src/lib/security/cron-auth.ts` (used by 16 existing routes); return 401 if invalid. Anonymous endpoint = anyone can expire org-wide proposals.
- No generic `audit_log` table exists (available: `ai_audit_log`, `enterprise_audit_logs`, `dev_admin_audit_logs`, `compliance_audit_log`, `data_access_log` — none fit). Phase 2 migration adds domain-local table:
  ```sql
  CREATE TABLE mentorship_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    kind text NOT NULL,
    pair_id uuid REFERENCES mentorship_pairs(id) ON DELETE SET NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX mentorship_audit_log_org_created_idx ON mentorship_audit_log(organization_id, created_at DESC);
  -- RLS: admin SELECT org-scoped; INSERT via service role only.
  ```
- Per expired pair: INSERT `{kind:'mentorship_proposal_expired', pair_id, organization_id, actor_user_id: null, metadata: {expired_at, proposed_at}}`.
- Admin approvals (§2.7) and acceptances also write to this table: `kind ∈ {'proposal_accepted','proposal_declined','admin_approved','admin_reassigned','admin_rejected'}` with `actor_user_id = auth.uid()`.
- Verification:
  - [ ] `curl` no auth header → 401
  - [ ] `curl` wrong `CRON_SECRET` → 401
  - [ ] `curl` correct header → expires stale proposals
  - [ ] Re-run same window: idempotent (already-expired rows not re-updated)

### 2.4 Notifications — `src/lib/notifications.ts`

- Extend `NotificationCategory` union: `"announcement" | "discussion" | "event" | "workout" | "competition" | "mentorship"`.
- Add entry to `CATEGORY_PREF_COLUMN` map: `mentorship: 'mentorship_emails_enabled'` (DB column already exists from Phase 1 migration line 419 — no schema change).
- Update the `notification_preferences` SELECT in `buildNotificationTargets` so `mentorship_emails_enabled` is actually loaded alongside the existing per-category columns.
- **Template contract** (keep Phase 2 aligned with the current plaintext notification system):
  ```ts
  export type MentorshipTemplate<Ctx> = (ctx: Ctx) => {
    title: string;
    body: string;
  };
  ```
  Each template is a pure function of typed context. `sendNotificationBlast` receives `{title, body}` — callers invoke the template first, then pass result in.
- Templates (new files under `src/lib/notifications/templates/mentorship/`):
  - `proposal_received.ts` — to mentor: "Jane Doe is requesting you as a mentor. Review in {link}."
  - `proposal_accepted.ts` — to mentee: "John accepted your mentorship request. You can now message them directly: {chat_link}"
  - `proposal_declined.ts` — to mentee: "John can't mentor you right now{reason? : ' — reason'}. Browse other mentors: {directory_link}"
- Respect `notification_preferences.mentorship_emails_enabled` opt-out (handled automatically once `CATEGORY_PREF_COLUMN` entry added).

### 2.5 UI — mentee-facing

**New** `src/components/mentorship/MenteeIntakeBanner.tsx`
- Renders on `/mentorship` for logged-in active_member without intake submission
- Links to existing `/forms/[formId]` with canonical intake form ID

**New** `src/components/mentorship/MentorDetailModal.tsx`
- Full mentor profile: photo, bio, topics tags, industry, grad year, capacity indicator (`current/max`), years_of_experience, meeting_preferences
- "Request intro" CTA → opens `MentorRequestDialog`

**New** `src/components/mentorship/MentorRequestDialog.tsx`
- Confirms selection; fetches this mentor's signals vs. current mentee via `/suggestions` endpoint
- Renders "Why this match" audit: `"Shared topics: finance, career-pivot · 5 yrs ahead · same industry (Finance)"`
- POST to `/requests`; on success → shows "Request sent" state, closes

**New** `src/components/mentorship/MentorshipProposalsTab.tsx`
- Mentee view: outgoing proposals with status badges (proposed/accepted/declined/expired)
- Mentor view: incoming proposals with accept/decline buttons + optional decline reason textarea

### 2.6 UI — modifications

`src/components/mentorship/MentorDirectory.tsx`
- Add sort dropdown: `Relevance | Name (A-Z) | Graduation Year`
- Relevance calls `/suggestions` for logged-in mentee; falls back to alphabetical if not a mentee or no intake
- New filter: `accepting_new` toggle (default on)
- New filter chips for `topics` (using `mentor_profiles.topics`)
- "Request intro" button on each card → opens `MentorDetailModal`
- Directory data needs to expose `topics`, `accepting_new`, `current_mentee_count`, `max_mentees`, `meeting_preferences`, and `years_of_experience` from `mentor_profiles`. Existing `expertise_areas` can still render as profile copy, but matching/filtering uses `topics`.

`src/components/mentorship/MentorshipTabShell.tsx`
- Add `proposals` tab, URL-synced

`src/components/mentorship/MentorshipContextStrip.tsx` — `AdminStrip`
- Keep existing manual pair-creator (selects mentor+mentee, inserts `status='active'`) — additive change.
- Add "Run match round" button alongside manual creator.
- Action: batch-score all mentees-without-nonterminal-pair against all accepting mentors; writes proposals for admin review
- Match-round semantics for Phase 2:
  - Only mentees with no existing `proposed|accepted|active|paused` row are eligible
  - Create only the top-1 proposal per mentee
  - Skip mentees with no qualifying mentor match
  - Re-running is idempotent at the queue level: do not generate additional open proposals for the same mentee if one already exists
- Progress indicator; success toast with count

### 2.7 UI — admin

**New page** — `src/app/[orgSlug]/mentorship/admin/matches/page.tsx`
- Admin-only (uses `isOrgAdmin` from `src/lib/auth.ts` — NOT `src/lib/auth/roles.ts`; `roles.ts` exposes `getOrgContext`/`requireOrgRole`)
- Clones shape of `src/app/[orgSlug]/settings/approvals/page.tsx` (approve/reject queue pattern)
- Per row: mentee name + intake summary (collapsed), mentor card, score, signals chips, `Approve | Reassign | Reject` buttons
- Signals rendered as badges: `"shared_topics ×1.25 (finance, career-pivot)"`, `"grad_gap 6 yrs (fit)"`
- Bulk action: "Approve top-1 for all mentees" (iterates queue, approves highest-scored proposal per mentee)
- Every approval writes `mentorship_audit_log` row (see Amendment C above) with `actor_user_id = auth.uid()`, `kind='admin_approved'`, `pair_id`, metadata.

## Verification

1. `npx tsc --noEmit` + `npm run lint` — clean
2. `npm run test` — existing suites pass; add integration test for PATCH pair transitions
3. Manual E2E checklist:
   - [ ] Seed 20 fake alumni via existing CSV importer with varied topics/industry/grad_year
   - [ ] 10 fake mentees submit intake forms via `/forms/[id]`
   - [ ] Admin clicks "Run match round" → 10 proposals appear in queue with scores + signals
   - [ ] Admin approves 8 → pairs go `accepted` → `chat_groups` auto-created (verify row in DB) → `mentor_proposal_accepted` notification fires (verify in Resend log or stub output)
   - [ ] Mentee #9 browses directory, filters by topic, sorts by Relevance → clicks "Request intro" → proposal lands in mentor's Proposals tab
   - [ ] Mentor #9 accepts in-app → chat_group + notification fire
   - [ ] Mentor schedules Google Meet via existing `mentorship_meetings` flow → calendar invite sent (unchanged functionality)
   - [ ] 15-day-old proposal → cron expires it; mentee re-requests successfully
   - [ ] Duplicate proposal (mentee requests same mentor twice) → idempotent, returns existing
   - [ ] Existing Activity / Tasks / Meetings tabs ignore `proposed|declined|expired` rows and remain stable
4. Security checks:
   - [ ] Active_member cannot INSERT pair with `mentee_user_id` ≠ self
   - [ ] Mentor cannot accept another mentor's pending proposal
   - [ ] Cross-org: user in Org A cannot PATCH pair in Org B
   - [ ] Admin override works; non-admin `override_approve` rejected
5. UX / i18n checks:
   - [ ] New mentorship copy is translated in locale files
   - [ ] Mentorship i18n regression test updated for new tab / proposal labels

## Files

**Create**:
- `supabase/migrations/YYYYMMDDHHMMSS_mentorship_intake_form_seed.sql`
- `src/app/api/organizations/[organizationId]/mentorship/suggestions/route.ts`
- `src/app/api/organizations/[organizationId]/mentorship/requests/route.ts`
- `src/app/api/organizations/[organizationId]/mentorship/pairs/[pairId]/route.ts`
- `src/app/api/organizations/[organizationId]/mentorship/admin/queue/route.ts`
- `src/app/api/cron/mentor-match-expire/route.ts`
- `src/lib/notifications/templates/mentorship/proposal_received.ts`
- `src/lib/notifications/templates/mentorship/proposal_accepted.ts`
- `src/lib/notifications/templates/mentorship/proposal_declined.ts`
- `src/components/mentorship/MenteeIntakeBanner.tsx`
- `src/components/mentorship/MentorDetailModal.tsx`
- `src/components/mentorship/MentorRequestDialog.tsx`
- `src/components/mentorship/MentorshipProposalsTab.tsx`
- `src/app/[orgSlug]/mentorship/admin/matches/page.tsx`

**Modify**:
- `src/lib/mentorship/matching-signals.ts` — add `loadMenteeIntakeInput` helper that reads `mentee_latest_intake` and returns `MenteeInput`
- `src/lib/chat/direct-chat.ts` — extract + export `ensureDirectChatGroup` (prerequisite refactor, commit separately)
- `src/lib/schemas/mentorship.ts` — add `menteeIntakeSchema`
- `src/lib/notifications.ts` — extend `NotificationCategory` union + `CATEGORY_PREF_COLUMN` map with `mentorship → mentorship_emails_enabled`, and include the column in the notification preferences query
- `src/components/mentorship/MentorDirectory.tsx` — sort, filters, CTA
- `src/components/mentorship/MentorshipTabShell.tsx` — add proposals tab
- `src/components/mentorship/MentorshipContextStrip.tsx` — Run match round button (keep existing manual creator)
- `src/lib/mentorship/view-state.ts` — add `proposals` tab parsing / type support
- `src/app/[orgSlug]/mentorship/page.tsx` — split working pairs vs proposal rows, mount MenteeIntakeBanner for mentees without intake, and pass proposal data into the new tab
- `src/types/database.ts` — regenerated after migration (`forms`, `notification_preferences`, new view / table exposure if applicable)
- `messages/*.json` — mentorship tab labels, proposal labels, and new CTA copy
- `tests/mentorship-i18n-regressions.test.ts` — cover the new mentorship strings
- `vercel.json` — register expire cron

**Migration contents** (single Phase 2 migration file):
1. ALTER `forms` ADD `system_key`, `form_kind` + CHECK + partial unique index + immutability trigger
2. Seed canonical mentee intake form per org
3. CREATE VIEW `mentee_latest_intake` (reads `fs.data`, filters `fs.deleted_at IS NULL` and `f.deleted_at IS NULL` — see Amendment A)
4. CREATE UNIQUE INDEX `mentorship_pairs_active_pair_unique`
5. CREATE FUNCTION `accept_mentorship_proposal`
6. CREATE TABLE `mentorship_audit_log` + RLS + index

## Exit Criteria (before Phase 3)

- [ ] All manual E2E steps pass
- [ ] No regressions in existing mentorship Activity/Directory/Tasks/Meetings tabs
- [ ] Security checks pass
- [ ] Committed separately from Phase 3
- [ ] User approves before Phase 3 begins

## Downstream

- **Phase 3**: `docs/plans/2026-04-17-003-feat-mentorship-phase-3-ai-assistant-plan.md` — wires `suggest_mentors` AI tool that renders same cards with a "Request intro" CTA posting to this phase's `/requests` route.
