# Supabase Schema Audit

**Last Updated:** April 16, 2026
**Scope:** All migrations in `supabase/migrations/` through `20261017000000_graduation_rpc_admin_guard.sql`
**Current Migration Count:** 266

> **Freshness rule.** Header is hand-maintained. To recheck: `ls supabase/migrations/*.sql | wc -l` and `ls supabase/migrations/ | sort | tail -1`. If either drifts more than ~20 migrations, refresh this doc.

This document is a current-state schema snapshot. The generated types in `src/types/database.ts` are the best day-to-day source of truth when this doc drifts. For per-policy RLS detail, grep the corresponding migration rather than duplicating SQL here.

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
- AI assistant (threads, messages, audit log, semantic cache)
- LinkedIn OAuth connections and enrichment
- Global search (cross-entity search across members/alumni/events/announcements/jobs/discussions/feed)
- Mentorship tasks and meetings (PM upgrade: task lists, scheduled meetings, cascade deletion)
- Breach incidents, data access log, user agreements (FERPA / NY Ed Law 2-d incident tracking)
- AI feedback (thumbs up/down on assistant responses)
- Alumni birth year (opt-in cohort data for reunions and enterprise stats)

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
| `members` | Active member profiles | Soft-delete via `deleted_at`. Enrichment columns: `current_company`, `school` |
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
| `feed_posts` | Feed posts | Community feed content, `comment_count`, `like_count` cached. `post_type` (`text`/`poll`) and `metadata` JSONB |
| `feed_poll_votes` | Feed post poll votes | `UNIQUE(post_id, user_id)`, option_index 0–5, org-scoped RLS via `is_org_member()` |
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
| `schedule_allowed_domains` | Verified/pending domain allowlist | `UNIQUE(hostname)`, status: `pending`/`active`/`blocked`, fingerprint JSONB. FK constraints on `verified_by_user_id` → `auth.users`, `verified_by_org_id` → `organizations` (both `ON DELETE SET NULL`) |

### Forms and Documents

| Table | Purpose | Notes |
|-------|---------|-------|
| `forms` | Dynamic form definitions | Org-scoped, `is_active` flag, soft-delete |
| `form_submissions` | Form response payloads | `responses` JSONB, user-generated content. Soft-delete via `deleted_at`. `user_id` nullable for anonymous friction feedback (pre-auth flows) |
| `form_documents` | Document upload templates | Org-scoped, `is_active` flag |
| `form_document_submissions` | Uploaded document submissions | `file_name`, `file_path`, `mime_type`, `file_size`. Soft-delete via `deleted_at` |

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
- `feedback-screenshots` — Public bucket for friction feedback screenshots (5MB limit, images only)

### Jobs and Mentorship

| Table | Purpose | Notes |
|-------|---------|-------|
| `job_postings` | Job board posts | Org-scoped, `industry`, `experience_level` fields |
| `mentor_profiles` | Alumni mentor directory | `UNIQUE(user_id, org_id)`, `expertise_areas` array, `is_active` flag |
| `mentorship_pairs` | Mentor–mentee pairings | Org-scoped pair records. Soft-delete via `deleted_at` |
| `mentorship_logs` | Mentorship session logs | `entry_date`, `notes`, `progress_metric` per pair. Soft-delete via `deleted_at` |

### Workouts and Competition

| Table | Purpose | Notes |
|-------|---------|-------|
| `workouts` | Workout content | Title, description, date, optional external URL |
| `workout_logs` | Workout participation logs | Status: `not_started`, `in_progress`, `completed`; `metrics` JSONB |
| `competitions` | Competition definitions | Org-scoped competition records |
| `competition_teams` | Teams within competitions | Named teams per competition. Soft-delete via `deleted_at` |
| `competition_points` | Point records | Per-user/team, `reason`, `created_by` |

### Payments, Donations, and Embeds

| Table | Purpose | Notes |
|-------|---------|-------|
| `payment_attempts` | Idempotency ledger | Unique on `idempotency_key`, states: `initiated`, `processing`, `succeeded`, `failed` |
| `stripe_events` | Webhook dedup | `UNIQUE(event_id)` prevents double-processing |
| `organization_donations` | Stripe Connect donation records | Per-donation event storage, optional `anonymous` flag. Soft-delete via `deleted_at` (compliance guard) |
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

### AI Assistant

| Table | Purpose | Notes |
|-------|---------|-------|
| `ai_threads` | AI conversation threads | Scoped to user + org + surface. Soft-delete via `deleted_at`. Surfaces: `general`, `members`, `analytics`, `events` |
| `ai_messages` | Messages within AI threads | Denormalized `user_id`/`org_id` with composite FK to `ai_threads(id, user_id, org_id)`. Idempotency key. Status: `pending`, `streaming`, `complete`, `error`. Role/content constraint check |
| `ai_audit_log` | AI request audit trail | Service-role only (RLS enabled, no policies). No FK on `user_id`/`org_id` — intentional for audit survival. TTL: 90 days. Cache columns: `cache_status`, `cache_entry_id`, `cache_bypass_reason`. Context columns: `context_surface`, `context_token_estimate`. Stage telemetry column: `stage_timings` JSONB |
| `ai_semantic_cache` | Semantic response cache | Org-scoped, keyed by `(org_id, surface, permission_scope_key, cache_version, prompt_hash)`. TTL via `expires_at`, soft-invalidation via `invalidated_at`. Service-role only |

### LinkedIn Integration

| Table | Purpose | Notes |
|-------|---------|-------|
| `user_linkedin_connections` | LinkedIn OAuth connection state | Mirrors `user_calendar_connections` pattern. `UNIQUE(user_id)`, encrypted tokens, sync status: `connected`/`disconnected`/`error` |

### Mentorship PM (Oct 2026)

| Table | Purpose | Notes |
|-------|---------|-------|
| `mentorship_tasks` | Tasks attached to a mentorship pair | Status, due date, optional assignee. Soft-delete via `deleted_at`. Cascade on pair deletion |
| `mentorship_meetings` | Scheduled meetings within a pair | Start/end timestamps, notes, optional calendar link. Soft-delete via `deleted_at`. Cascade on pair deletion |

### Search (Oct 2026)

| Table | Purpose | Notes |
|-------|---------|-------|
| `global_search_entries` | Cross-entity search index | Materialized search surface covering members, alumni, events, announcements, jobs, discussions, feed. Refreshed by triggers / scheduled job. See migration `20261015110000_global_search.sql` |
| `search_behavioral_analytics` | Search query telemetry | Query text (hashed/truncated), result counts, click-through events. PII-minimized |

### Compliance & Security (Oct 2026)

| Table | Purpose | Notes |
|-------|---------|-------|
| `breach_incidents` | Security/privacy incident tracking | Discovery/containment/resolution timestamps, severity tier, notification log. Backs `docs/Incident_Response_Runbook.md` |
| `data_access_log` | Record-level access telemetry | Who accessed which resource when (for FERPA / NY Ed Law 2-d audit). IP stored hashed |
| `user_agreements` | User acceptance of ToS / Privacy / DSA versions | `user_id`, `agreement_type`, `version`, `accepted_at` |

### AI Feedback (Oct 2026)

| Table | Purpose | Notes |
|-------|---------|-------|
| `ai_feedback` | Per-message thumbs/ratings on assistant responses | `message_id`, `user_id`, `rating`, optional `comment`. RLS: users read/write only their own feedback; admins read within org |

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
| `analytics_event_name` | `app_open`, `route_view`, `nav_click`, `page_dwell_bucket`, `directory_view`, `directory_filter_apply`, `profile_card_open`, `events_view`, `event_open`, `rsvp_update`, `donation_flow_start`, `donation_checkout_start`, `donation_checkout_result`, `chat_thread_open`, `chat_message_send`, `chat_participants_change` (realigned Mar 2026 — deprecated events removed) |

## Extensions

| Extension | Schema | Purpose |
|-----------|--------|---------|
| `vector` | `extensions` | pgvector — enabled for future embedding-based similarity search (AI semantic cache) |

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
| `save_user_linkedin_url(uuid, text)` | Sync LinkedIn URL across member/alumni/parent profiles | `20260703000000` |
| `sync_user_linkedin_profile_fields(uuid, text, text, text)` | Sync name/photo from LinkedIn to profiles | `20260704000000` |
| `sync_user_linkedin_enrichment(uuid, text...)` | Sync Proxycurl enrichment data to member/alumni | `20260707000000` |
| `purge_expired_ai_semantic_cache()` | TTL cleanup for AI semantic cache (service-role only, batch 500) | `20260321100001` |

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

### AI Assistant

- `ai_threads` scoped to `(user_id, org_id, surface)` with soft-delete. Surfaces map to feature areas: `general`, `members`, `analytics`, `events`.
- `ai_messages` denormalized with `user_id`/`org_id` from parent thread. Composite FK `(thread_id, user_id, org_id)` → `ai_threads(id, user_id, org_id)` prevents drift. RLS uses direct `user_id = auth.uid()` + EXISTS for `deleted_at IS NULL` filtering.
- `ai_messages` enforces role/content invariants via CHECK constraint (user messages require content, assistant messages in `complete` status require content, etc.).
- `ai_messages.idempotency_key` prevents duplicate user messages from retries (unique partial index where key IS NOT NULL).
- `ai_audit_log` is service-role-only (no RLS policies). Logs model, tokens, latency, cache status, retrieval decision metadata, and per-stage timing/status in `stage_timings`. 90-day TTL via `expires_at`.
- `ai_semantic_cache` deduplicates by `(org_id, surface, permission_scope_key, cache_version, prompt_hash)` where `invalidated_at IS NULL`. TTL-based expiry with `purge_expired_ai_semantic_cache()` function (batched, service-role only).
- pgvector extension (`vector` in `extensions` schema) enabled for future embedding-based similarity search.

### LinkedIn Integration

- `user_linkedin_connections` follows the `user_calendar_connections` pattern — one connection per user, encrypted tokens, sync status tracking.
- Three service-role RPCs propagate LinkedIn data across member/alumni/parent profiles: URL sync, profile field sync (name/photo), and enrichment sync (Proxycurl data).
- Enrichment RPCs use `COALESCE` to only fill NULL fields, preserving manual user edits.

### Feed Polls

- `feed_posts.post_type` distinguishes `text` vs `poll` posts. Poll options stored in `metadata` JSONB.
- `feed_poll_votes` mirrors the `feed_likes` RLS pattern: org members can view all votes, users can modify their own. `UNIQUE(post_id, user_id)` allows vote changing via upsert.

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
| Mar 2026 | Alumni bulk import, quota fixes, AI assistant foundations (threads, messages, audit log), semantic response cache (pgvector), architecture fixes (soft-delete on 6 tables, ai_messages denormalization, composite FK integrity, schedule domain FKs), LinkedIn OAuth connections + enrichment RPCs, feed polls, member enrichment columns, analytics event enum realignment, feedback screenshots bucket, anonymous friction feedback |
| Apr 2026 | Stripe idempotency, Google Calendar sync, calendar feeds, schedule sources/events, schedule domain allowlist, performance/security fixes |
| May 2026 | Enterprise hybrid pricing, event recurrence, discussions, jobs, mentor profiles, feed, media uploads, dev-admin audit |
| Jun 2026 | Media archive + moderation + albums, parent invites, parent role propagation (feed, announcements, chat, remaining tables), donations anonymous flag, chat polls/forms, alumni quota fixes, member soft-delete sync |
| Jul 2026 | Parent invite redemption fixes, analytics hardening (allowlisted props, enum validation, behavioral tracking policy), AI context enrichment columns (`context_surface`, `context_token_estimate` on `ai_audit_log`), AI stage timing telemetry (`stage_timings` on `ai_audit_log`) |
| Aug 2026 | Audit log retention, RAG hardening follow-ups, security definer search-path hardening |
| Sep 2026 | Enterprise invite hardening, invite pagination indexes, enterprise member count RPC, enterprise invite role cast fix |
| Oct 2026 | Duplicate OAuth account merge, user agreements, `data_access_log`, IP hash backfill, `breach_incidents`, mentorship tasks + meetings + pair cascade deletion, parent role added to remaining RLS policies, parent discussion posting, alumni birth year (+ enterprise stats, bulk-import column), announcement visibility reconciliation, member restore on re-approval, `global_search` surface, org `hide_donor_names`, org `base_color`, search behavioral analytics, AI feedback, graduation RPC admin guard |

> For per-migration detail, use `git log supabase/migrations/` — this table is intentionally coarse and will no longer be extended month-by-month once the next schema refresh lands.

---

## Known Intentional Divergences

1. **`error_events.user_id`** — Stored as `text`, not `uuid`. No FK to `auth.users`. Intentional: the telemetry endpoint (`/api/telemetry/error`) accepts unauthenticated requests with client-generated user identifiers that may not be valid UUIDs. All other user_id columns in the schema are `uuid` with FK constraints.

2. **`ai_audit_log.user_id` / `ai_audit_log.org_id`** — `uuid NOT NULL` with no FK constraints. Intentional: audit logs must survive user and org deletion. Adding FK with CASCADE would destroy audit data; SET NULL conflicts with NOT NULL. Table is service-role-only (RLS enabled with zero policies).

3. **`ai_messages` composite FK** — `(thread_id, user_id, org_id)` references `ai_threads(id, user_id, org_id)` instead of a simple `thread_id` FK. Intentional: enforces ownership consistency at the DB level so RLS does not need subquery joins for ownership verification — only for `deleted_at` filtering. The composite FK also prevents user_id/org_id drift between messages and their parent thread.

4. **`ai_messages.idempotency_key` uniqueness scope** — The unique constraint on `idempotency_key` is table-wide, not scoped to `(org_id, user_id)`. Intentional: idempotency keys are client-generated UUIDs (v4) that must be globally unique to guarantee exactly-once delivery across the entire cluster. Scoping the constraint to a user or org would allow a key collision across organizations in a hypothetical multi-tenant replay attack scenario. The per-request key generation (`crypto.randomUUID()`) makes accidental cross-org collisions statistically impossible, and the broader constraint gives the strongest safety guarantee with no practical downside. See `src/app/api/ai/[orgId]/chat/handler.ts` for key generation and `src/hooks/useAIStream.ts` for client-side handling.

---

## Remaining Cautions

1. Prefer `src/types/database.ts` when checking exact column names or enums.
2. Re-run this audit after major migration batches; the schema changes frequently.
3. Treat compliance docs that omit parent records or say "no behavioral data" as stale unless updated after the July 2026 migrations.
4. `rls-playbook.md` in this directory is the evergreen RLS pattern reference (`(select auth.uid())`, policy consolidation, SECURITY DEFINER helpers, indexing RLS-referenced columns). The old `rls-and-schema-fixes.md` was a one-off Dec 2025 post-mortem — consult migration history for per-fix detail.

## Suggested Future Automation

This doc is currently hand-maintained. Drift is inevitable. Two small scripts would keep it honest:

1. **Header regeneration** — script that reads `supabase/migrations/` and rewrites the `Last Updated` / `Scope` / `Current Migration Count` block. Wire into `npm run gen:types`.
2. **Policy + index matrix** — dump `pg_policies` and `pg_indexes` from a staging DB to `docs/db/rls-matrix.generated.md` and `docs/db/indexes.generated.md`. Link from this audit. Keeps "who can SELECT on X" and "is column Y indexed" out of human memory.

Both are deferred (YAGNI) until drift becomes painful again.
