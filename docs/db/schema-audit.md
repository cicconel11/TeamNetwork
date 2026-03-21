# Supabase Schema Audit

**Last Updated:** March 12, 2026  
**Scope:** All migrations in `supabase/migrations/` through `20260701000007_enforce_behavioral_tracking_policy.sql`  
**Current Migration Count:** 155

This document is a current-state schema snapshot. The generated types in `src/types/database.ts` are the best day-to-day source of truth when this doc drifts.

---

## Current Schema Surface

The live schema covers:

- Core identity, org membership, and enterprise billing
- Members, alumni, parents, and parent invites
- Events, announcements, notifications, and RSVPs
- Chat (groups, messages, polls, forms), discussions, and feed
- Forms, document submissions, and media (archive + uploads)
- Calendar sync, schedule imports, and schedule domain security
- Jobs, mentorship, workouts, competition, and philanthropy/donations
- Analytics, usage analytics, telemetry, and operational events
- Error tracking, compliance audit, and dev-admin audit logs
- User deletion requests (GDPR/COPPA)

---

## Complete Table Reference

### Identity, Membership, and Access

| Table | Purpose | Notes |
|-------|---------|-------|
| `users` | App-level user profile mirrored from auth | Synced from `auth.users` |
| `organizations` | Top-level tenant entity | Branding, nav config, Stripe/org settings, `media_upload_roles`, `feed_post_roles` |
| `user_organization_roles` | Org membership + role assignment | `role` includes `parent`; `status`: `pending`, `active`, `revoked` |
| `organization_subscriptions` | Org subscription state | Alumni/parent access buckets, grace-period data |
| `organization_invites` | Invite codes for org onboarding | Unique `(org_id, code)`, optional `token`, `revoked_at` |
| `user_deletion_requests` | GDPR/COPPA account deletion queue | Status: `pending`, `completed`, `cancelled`; 30-day grace period |
| `compliance_audit_log` | Age-gate compliance events | Anonymized: no DOB/PII, stores `ip_hash`, `age_bracket` |

### Enterprise

| Table | Purpose | Notes |
|-------|---------|-------|
| `enterprises` | Enterprise tenant entity | Metadata and billing contact |
| `enterprise_subscriptions` | Enterprise subscription state | Hybrid alumni-bucket + sub-org pricing |
| `user_enterprise_roles` | Enterprise role assignment | `owner`, `billing_admin`, `org_admin` |
| `enterprise_adoption_requests` | Org adoption workflow | Structured request lifecycle with status |
| `enterprise_invites` | Enterprise admin invitations | Email/token onboarding flow |
| `enterprise_audit_logs` | Admin audit trail | Actor email, IP, user agent |
| `enterprise_alumni_counts` | Enterprise-wide org/alumni count view | Capacity planning / enforcement (VIEW, not table) |

### Member Directories

| Table | Purpose | Notes |
|-------|---------|-------|
| `members` | Active member profiles | Soft-delete via `deleted_at` |
| `alumni` | Alumni profiles | Extended profile/contact fields including `current_city` |
| `parents` | Parent/guardian profiles | Relationship, student name, notes, optional linked `user_id` |
| `parent_invites` | Parent invite onboarding | Code-based invite flow with status, expiry, optional email |

### Communication and Community

| Table | Purpose | Notes |
|-------|---------|-------|
| `announcements` | Audience-targeted announcements | Supports `all`, `members`, `active_members`, `alumni`, `individuals` |
| `notifications` | Notification records | Paired with notification preferences and push tokens |
| `chat_groups` | Group chat containers | Approval and moderation workflow |
| `chat_group_members` | Chat membership | `added_by`, soft removal via `removed_at`. See `docs/db/chat-members.md` |
| `chat_messages` | Chat message records | `message_type` (`text`, `poll`, `form`), `metadata` JSONB, approval state, edit/delete |
| `chat_poll_votes` | Poll votes within chat | One vote per user per poll (`UNIQUE(message_id, user_id)`), upsert for re-voting |
| `chat_form_responses` | Inline form responses in chat | One response per user per form (`UNIQUE(message_id, user_id)`), immutable by default |
| `discussion_threads` | Discussion threads | Pinned/locked flags, `reply_count`, `last_activity_at`, soft-delete |
| `discussion_replies` | Thread replies | Reply content with soft-delete |
| `feed_posts` | Feed posts | Community feed content, `comment_count`, `like_count` cached |
| `feed_comments` | Feed comments | Post-level replies/comments, soft-delete |
| `feed_likes` | Feed post likes | Hard delete on unlike; `UNIQUE(post_id, user_id)` |

### Scheduling and Calendar

| Table | Purpose | Notes |
|-------|---------|-------|
| `events` | Org events | Audience targeting, optional recurrence |
| `event_rsvps` | RSVP/check-in state | Check-in and attendance fields |
| `academic_schedules` | User academic commitments | Personal schedule/availability, supports multi-day |
| `schedule_files` | Uploaded schedule files | Per-user uploads |
| `schedule_sources` | Imported external schedule sources | URL, connector type, sync stats |
| `schedule_events` | Events from imported schedule sources | `UNIQUE(source_id, external_uid)` for dedup |
| `calendar_feeds` | Calendar feed ingestion configs | Powers calendar sync workflows |
| `calendar_events` | Events parsed from calendar feeds | `UNIQUE(feed_id, instance_key)` for dedup |
| `user_calendar_connections` | Google OAuth connection state | Encrypted token storage |
| `event_calendar_entries` | Event-to-Google Calendar mappings | Sync status and error state, `target_calendar_id` |
| `calendar_sync_preferences` | Per-user sync preferences | Org-scoped preference table |

### Schedule Domain Security

| Table | Purpose | Notes |
|-------|---------|-------|
| `schedule_domain_rules` | Platform-level domain patterns | `UNIQUE(pattern)`, vendor ID, status: `active`/`blocked` |
| `schedule_allowed_domains` | Verified/pending domain allowlist | `UNIQUE(hostname)`, status: `pending`/`active`/`blocked`, fingerprint JSONB |

### Forms and Documents

| Table | Purpose | Notes |
|-------|---------|-------|
| `forms` | Dynamic form definitions | Org-scoped, `is_active` flag, soft-delete |
| `form_submissions` | Form response payloads | `responses` JSONB, user-generated content |
| `form_documents` | Document upload templates | Org-scoped, `is_active` flag |
| `form_document_submissions` | Uploaded document submissions | `file_name`, `file_path`, `mime_type`, `file_size` |

### Media

| Table | Purpose | Notes |
|-------|---------|-------|
| `media_items` | Media archive items (photos/videos) | Moderation: `status` enum (`pending`, `approved`, `rejected`), tags, visibility, soft-delete |
| `media_albums` | Album containers for media | `item_count` cached, soft-delete |
| `media_album_items` | Junction: media items ↔ albums | `UNIQUE(album_id, media_item_id)`, `sort_order` |
| `media_uploads` | Upload lifecycle tracking (feed, discussions, jobs) | Status enum: `pending`, `ready`, `failed`, `orphaned`; entity link to `feed_post`/`discussion_thread`/`job_posting` |

**Storage Buckets:**
- `media-archive` — Public bucket for media archive (50MB limit)
- `org-media` — Private bucket for org uploads (25MB limit)

### Jobs and Mentorship

| Table | Purpose | Notes |
|-------|---------|-------|
| `job_postings` | Job board posts | Org-scoped, `industry`, `experience_level` fields |
| `mentor_profiles` | Alumni mentor directory | `UNIQUE(user_id, org_id)`, `expertise_areas` array, `is_active` flag |
| `mentorship_pairs` | Mentor–mentee pairings | Org-scoped pair records |
| `mentorship_logs` | Mentorship session logs | `entry_date`, `notes`, `progress_metric` per pair |

### Workouts and Competition

| Table | Purpose | Notes |
|-------|---------|-------|
| `workouts` | Workout content | Title, description, date, optional external URL |
| `workout_logs` | Workout participation logs | Status: `not_started`, `in_progress`, `completed`; `metrics` JSONB |
| `competitions` | Competition definitions | Org-scoped competition records |
| `competition_teams` | Teams within competitions | Named teams per competition |
| `competition_points` | Point records | Per-user/team, `reason`, `created_by` |

### Payments, Donations, and Embeds

| Table | Purpose | Notes |
|-------|---------|-------|
| `payment_attempts` | Idempotency ledger | Unique on `idempotency_key`, states: `initiated`, `processing`, `succeeded`, `failed` |
| `stripe_events` | Webhook dedup | `UNIQUE(event_id)` prevents double-processing |
| `organization_donations` | Stripe Connect donation records | Per-donation event storage, optional `anonymous` flag |
| `organization_donation_stats` | Donation rollups | Aggregate stats per org |
| `org_donation_embeds` | Donation embed/link storage | Finance surface display |
| `org_philanthropy_embeds` | Philanthropy embed/link storage | HTTPS-only URLs, `embed_type`: `link`/`iframe` |
| `philanthropy_events` | Philanthropy event records | Org-scoped philanthropy data |

### Analytics and Telemetry

| Table | Purpose | Notes |
|-------|---------|-------|
| `analytics_consent` | Org/user analytics consent | Composite PK `(org_id, user_id)` |
| `analytics_events` | Behavioral analytics events | Event name enum + allowlisted props; hardened by July 2026 migrations |
| `ops_events` | Operational event log | System/ops signals |
| `rate_limit_analytics` | Analytics rate limit windows | `UNIQUE(user_id, org_id, window_start)`, cleaned by daily cron |

### Usage Analytics (FERPA/COPPA-compliant)

| Table | Purpose | Notes |
|-------|---------|-------|
| `usage_events` | Raw behavioral events | No PII; event types: `page_view`, `feature_enter`, `feature_exit`, `nav_click`; purged after 90 days |
| `usage_summaries` | Aggregated per-user/org feature usage | `UNIQUE(user_id, org_id, feature, period_start)` |
| `ui_profiles` | LLM-generated personalization profiles | Cached with `expires_at` (7-day TTL), `UNIQUE(user_id, org_id)` |

### Error Tracking

| Table | Purpose | Notes |
|-------|---------|-------|
| `error_groups` | Aggregated error groups | `UNIQUE(env, fingerprint)`, severity, rolling counts (`count_1h`, `count_24h`, `total_count`), triage status |
| `error_events` | Individual error occurrences | Linked to `error_groups`, stores message, stack, route, meta JSONB |

### Audit Logs

| Table | Purpose | Notes |
|-------|---------|-------|
| `dev_admin_audit_logs` | Dev/platform admin audit trail | Action, target type/id/slug, IP, user agent, metadata JSONB |
| `enterprise_audit_logs` | Enterprise admin audit trail | Actor email, IP, user agent (see Enterprise section) |

---

## Enum Highlights

| Enum | Current Values |
|------|----------------|
| `user_role` | `admin`, `active_member`, `alumni`, `parent` (plus legacy compat in some code paths) |
| `membership_status` | `pending`, `active`, `revoked` |
| `chat_group_role` | `admin`, `moderator`, `member` |
| `chat_message_status` | `pending`, `approved`, `rejected` |
| `enterprise_role` | `owner`, `billing_admin`, `org_admin` |
| `media_status` | `pending`, `approved`, `rejected` |
| `media_upload_status` | `pending`, `ready`, `failed`, `orphaned` |
| `media_entity_type` | `feed_post`, `discussion_thread`, `job_posting` |

---

## RLS Helper Functions

| Function | Purpose |
|----------|---------|
| `is_org_admin(org_id)` | Current user is admin for org |
| `is_org_member(org_id)` | Current user is active member of org |
| `has_active_role(org_id, roles[])` | Current user has one of the specified roles |
| `is_enterprise_member(ent_id)` | Current user has any role in enterprise |
| `is_enterprise_admin(ent_id)` | Current user is owner/billing_admin/org_admin |
| `is_chat_group_member(group_id)` | Current user is active (non-removed) group member |
| `is_chat_group_moderator(group_id)` | Current user is admin/moderator and not removed |
| `is_chat_group_creator(group_id)` | Current user is `created_by` on chat_groups |
| `check_analytics_rate_limit(...)` | Atomic rate limit check with upsert (SECURITY DEFINER) |

---

## Key RPC Functions

| Function | Purpose | Migration |
|----------|---------|-----------|
| `create_org_invite(...)` | Create org invite with code generation | `20251217100000` |
| `redeem_parent_invite(...)` | Atomic parent invite redemption | `20260625000000` + fixes through `20260701000003` |
| `resolve_alumni_quota(...)` | Alumni quota enforcement | `20260628000000` |
| `purge_analytics_events()` | Purge expired analytics data | Used by analytics-purge cron |
| `purge_ops_events()` | Purge expired ops events | Used by analytics-purge cron |
| `get_subscription_status(...)` | Get org subscription status | `20260430120000` |

---

## Important Implementation Notes

### Chat Polls & Forms

- `chat_messages` extended with `message_type` (`text`, `poll`, `form`) and `metadata` JSONB.
- `chat_poll_votes`: One vote per user per poll; `allow_change` metadata flag controls re-voting via upsert.
- `chat_form_responses`: One response per user per form; immutable by default.
- Both tables are added to Supabase realtime publication with `REPLICA IDENTITY FULL`.
- RLS: group members can read all votes/responses; users can modify their own.

### Chat Member Management

- `chat_group_members` supports soft removal via `removed_at`.
- Re-adding is UPDATE (clear `removed_at`), not INSERT (unique constraint).
- See `docs/db/chat-members.md` for full detail.

### Media Architecture

Two parallel media systems exist:
1. **Media Archive** (`media_items`, `media_albums`, `media_album_items`): Full archive with moderation workflow, tags, visibility levels. Storage bucket: `media-archive`.
2. **Media Uploads** (`media_uploads`): Upload lifecycle for feed posts, discussions, and jobs. Entity-linked. Storage bucket: `org-media`.

Media moderation adds `status` enum to `media_items`: pending → approved/rejected. Admins see all statuses; members see only approved.

### Schedule Domain Security

Two-tier verification:
- `schedule_domain_rules`: Platform-maintained vendor patterns (seeded with known providers).
- `schedule_allowed_domains`: Runtime-verified hostnames with fingerprint, confidence, and verification method.

### Navigation and Role Access

- Parent access propagates through org navigation and feature gates.
- Generated types and migrations are aligned on `parent` as a first-class role.
- `feed_post_roles` and `media_upload_roles` columns on `organizations` enable per-org role customization.

### Analytics

- Behavioral analytics hardened by July 2026 migrations (allowlisted props, enum validation, tracking policy enforcement).
- Usage analytics tables (`usage_events`, `usage_summaries`, `ui_profiles`) are FERPA/COPPA-compliant with no PII.
- `rate_limit_analytics` prevents analytics abuse; cleaned daily by cron.

### Error Tracking

- `error_groups` deduplicate by `(env, fingerprint)` with rolling hourly/daily/total counts.
- Hourly baselines reset by `error-baselines` cron for spike detection.
- `error_events` store individual occurrences with stack traces and metadata.

### Enterprise Typing

- Enterprise tables are present in generated database types.
- Some code still uses `as any` for service-role or auth-schema queries.

### Compliance and Deletion

- `user_deletion_requests` tracks GDPR/COPPA deletion with 30-day grace period.
- `compliance_audit_log` stores anonymized age-gate events (no DOB/PII, only `ip_hash`).

### Notification Delivery

- Email delivery uses Resend when `RESEND_API_KEY` is configured.
- SMS delivery remains a stub integration point.

---

## Migration Timeline Highlights

| Period | Key Additions |
|--------|---------------|
| Dec 2025 | Core tables, org invites, RLS policies, donations, RSVP |
| Jan 2026 | Chat groups, academic schedules, forms, documents |
| Feb 2026 | Enterprise accounts, error tracking, analytics, graduation, user deletion, compliance |
| Mar 2026 | Alumni bulk import, quota fixes |
| Apr 2026 | Stripe idempotency, Google Calendar sync, calendar feeds, schedule sources/events, schedule domain allowlist, performance/security fixes |
| May 2026 | Enterprise hybrid pricing, event recurrence, discussions, jobs, mentor profiles, feed, media uploads, dev-admin audit |
| Jun 2026 | Media archive + moderation + albums, parent invites, parent role propagation (feed, announcements, chat, remaining tables), donations anonymous flag, chat polls/forms, alumni quota fixes, member soft-delete sync |
| Jul 2026 | Parent invite redemption fixes, analytics hardening (allowlisted props, enum validation, behavioral tracking policy) |

---

## Known Intentional Divergences

1. **`error_events.user_id`** — Stored as `text`, not `uuid`. No FK to `auth.users`. Intentional: the telemetry endpoint (`/api/telemetry/error`) accepts unauthenticated requests with client-generated user identifiers that may not be valid UUIDs. All other user_id columns in the schema are `uuid` with FK constraints.

2. **`ai_audit_log.user_id` / `ai_audit_log.org_id`** — `uuid NOT NULL` with no FK constraints. Intentional: audit logs must survive user and org deletion. Adding FK with CASCADE would destroy audit data; SET NULL conflicts with NOT NULL. Table is service-role-only (RLS enabled with zero policies).

---

## Remaining Cautions

1. Prefer `src/types/database.ts` when checking exact column names or enums.
2. Re-run this audit after major migration batches; the schema changes frequently.
3. Treat compliance docs that omit parent records or say "no behavioral data" as stale unless updated after the July 2026 migrations.
4. `rls-and-schema-fixes.md` in this directory is a historical reference for early Dec 2025 fixes; the patterns described there (RLS performance, `(select auth.uid())`) remain valid guidance.
