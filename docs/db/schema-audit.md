# Supabase Schema Audit

**Last Updated:** June 27, 2026 (Complete Table Reference reconciled against `database.ts`; prose body still reflects the April 2026 full audit).
**Scope:** Prose subsystem notes reflect migrations through `20261017000000_graduation_rpc_admin_guard.sql` (the last full prose audit). The **Complete Table Reference** below was reconciled to the live table list on June 27, 2026.
**Migration Count:** 266 at last full prose audit — **now 364** (latest `20261226000000_alumni_reinvite_tracking.sql`).

> **Freshness rule.** Header is hand-maintained. To recheck: `ls supabase/migrations/*.sql | wc -l` and `ls supabase/migrations/ | sort | tail -1`. If either drifts more than ~20 migrations, refresh this doc (re-audit the body, not just the header).

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
- User deletion requests (GDPR/COPPA), DSR requests, and enterprise deletion requests
- AI assistant — conversation, audit/spend governance, RAG/embedding pipeline, semantic cache, and confirmation-gated mutation layer (see [`ai-schema.md`](./ai-schema.md))
- Mobile/push — Expo push tokens, iOS Live Activities, Apple Wallet passes, web→mobile auth handoff, notification dispatch queue (see [`mobile-schema.md`](./mobile-schema.md))
- LinkedIn OAuth connections + OIDC connections, Apify enrichment runs, and CRM integrations (Blackbaud)
- Global search (RPC-based cross-entity search across members/alumni/events/announcements/jobs/discussions/feed — see note in the Search section)
- Mentorship tasks and meetings (PM upgrade); mentee preferences/matching, mentorship audit log, and reminders (Phase 2)
- Breach incidents, data access log, user agreements (FERPA / NY Ed Law 2-d incident tracking)
- Content moderation and user blocking (App Store Guideline 1.2)
- Gamification — badges, member badges, attendance streaks, onboarding progress
- AI feedback (thumbs up/down on assistant responses)
- Alumni birth year (opt-in cohort data for reunions and enterprise stats)

---

## Complete Table Reference

### Identity, Membership, and Access

| Table                        | Purpose                                   | Notes                                                                              |
| ---------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `users`                      | App-level user profile mirrored from auth | Synced from `auth.users`                                                           |
| `organizations`              | Top-level tenant entity                   | Branding, nav config, Stripe/org settings, `media_upload_roles`, `feed_post_roles` |
| `user_organization_roles`    | Org membership + role assignment          | `role` includes `parent`; `status`: `pending`, `active`, `revoked`                 |
| `organization_subscriptions` | Org subscription state                    | Alumni/parent access buckets, grace-period data                                    |
| `organization_invites`       | Invite codes for org onboarding           | Unique `(org_id, code)`, optional `token`, `revoked_at`                            |
| `user_deletion_requests`     | GDPR/COPPA account deletion queue         | Status: `pending`, `completed`, `cancelled`; 30-day grace period                   |
| `compliance_audit_log`       | Age-gate compliance events                | Anonymized: no DOB/PII, stores `ip_hash`, `age_bracket`                            |

### Enterprise

| Table                          | Purpose                               | Notes                                             |
| ------------------------------ | ------------------------------------- | ------------------------------------------------- |
| `enterprises`                  | Enterprise tenant entity              | Metadata and billing contact                      |
| `enterprise_subscriptions`     | Enterprise subscription state         | Hybrid alumni-bucket + sub-org pricing            |
| `user_enterprise_roles`        | Enterprise role assignment            | `owner`, `billing_admin`, `org_admin`             |
| `enterprise_adoption_requests` | Org adoption workflow                 | Structured request lifecycle with status          |
| `enterprise_invites`           | Enterprise admin invitations          | Email/token onboarding flow                       |
| `enterprise_audit_logs`        | Admin audit trail                     | Actor email, IP, user agent                       |
| `enterprise_alumni_counts`     | Enterprise-wide org/alumni count view | Capacity planning / enforcement (VIEW, not table) |

### Member Directories

| Table            | Purpose                  | Notes                                                                         |
| ---------------- | ------------------------ | ----------------------------------------------------------------------------- |
| `members`        | Active member profiles   | Soft-delete via `deleted_at`. Enrichment columns: `current_company`, `school` |
| `alumni`         | Alumni profiles          | Extended profile/contact fields including `current_city`                      |
| `parents`        | Parent/guardian profiles | Relationship, student name, notes, optional linked `user_id`                  |
| `parent_invites` | Parent invite onboarding | Code-based invite flow with status, expiry, optional email                    |

### Communication and Community

| Table                 | Purpose                         | Notes                                                                                                          |
| --------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `announcements`       | Audience-targeted announcements | Supports `all`, `members`, `active_members`, `alumni`, `individuals`                                           |
| `notifications`       | Notification records            | Paired with notification preferences and push tokens                                                           |
| `chat_groups`         | Group chat containers           | Approval and moderation workflow                                                                               |
| `chat_group_members`  | Chat membership                 | `added_by`, soft removal via `removed_at`. See `docs/db/chat-members.md`                                       |
| `chat_messages`       | Chat message records            | `message_type` (`text`, `poll`, `form`), `metadata` JSONB, approval state, edit/delete                         |
| `chat_poll_votes`     | Poll votes within chat          | One vote per user per poll (`UNIQUE(message_id, user_id)`), upsert for re-voting                               |
| `chat_form_responses` | Inline form responses in chat   | One response per user per form (`UNIQUE(message_id, user_id)`), immutable by default                           |
| `discussion_threads`  | Discussion threads              | Pinned/locked flags, `reply_count`, `last_activity_at`, soft-delete                                            |
| `discussion_replies`  | Thread replies                  | Reply content with soft-delete                                                                                 |
| `feed_posts`          | Feed posts                      | Community feed content, `comment_count`, `like_count` cached. `post_type` (`text`/`poll`) and `metadata` JSONB |
| `feed_poll_votes`     | Feed post poll votes            | `UNIQUE(post_id, user_id)`, option_index 0–5, org-scoped RLS via `is_org_member()`                             |
| `feed_comments`       | Feed comments                   | Post-level replies/comments, soft-delete                                                                       |
| `feed_likes`          | Feed post likes                 | Hard delete on unlike; `UNIQUE(post_id, user_id)`                                                              |

### Scheduling and Calendar

| Table                       | Purpose                               | Notes                                              |
| --------------------------- | ------------------------------------- | -------------------------------------------------- |
| `events`                    | Org events                            | Audience targeting, optional recurrence            |
| `event_rsvps`               | RSVP/check-in state                   | Check-in and attendance fields                     |
| `academic_schedules`        | User academic commitments             | Personal schedule/availability, supports multi-day |
| `schedule_files`            | Uploaded schedule files               | Per-user uploads                                   |
| `schedule_sources`          | Imported external schedule sources    | URL, connector type, sync stats                    |
| `schedule_events`           | Events from imported schedule sources | `UNIQUE(source_id, external_uid)` for dedup        |
| `calendar_feeds`            | Calendar feed ingestion configs       | Powers calendar sync workflows                     |
| `calendar_events`           | Events parsed from calendar feeds     | `UNIQUE(feed_id, instance_key)` for dedup          |
| `user_calendar_connections` | Google OAuth connection state         | Encrypted token storage                            |
| `event_calendar_entries`    | Event-to-Google Calendar mappings     | Sync status and error state, `target_calendar_id`  |
| `calendar_sync_preferences` | Per-user sync preferences             | Org-scoped preference table                        |

### Schedule Domain Security

| Table                      | Purpose                           | Notes                                                                                                                                                                                                   |
| -------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schedule_domain_rules`    | Platform-level domain patterns    | `UNIQUE(pattern)`, vendor ID, status: `active`/`blocked`                                                                                                                                                |
| `schedule_allowed_domains` | Verified/pending domain allowlist | `UNIQUE(hostname)`, status: `pending`/`active`/`blocked`, fingerprint JSONB. FK constraints on `verified_by_user_id` → `auth.users`, `verified_by_org_id` → `organizations` (both `ON DELETE SET NULL`) |

### Forms and Documents

| Table                       | Purpose                       | Notes                                                                                                                                        |
| --------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `forms`                     | Dynamic form definitions      | Org-scoped, `is_active` flag, soft-delete                                                                                                    |
| `form_submissions`          | Form response payloads        | `responses` JSONB, user-generated content. Soft-delete via `deleted_at`. `user_id` nullable for anonymous friction feedback (pre-auth flows) |
| `form_documents`            | Document upload templates     | Org-scoped, `is_active` flag                                                                                                                 |
| `form_document_submissions` | Uploaded document submissions | `file_name`, `file_path`, `mime_type`, `file_size`. Soft-delete via `deleted_at`                                                             |

### Media

| Table               | Purpose                                             | Notes                                                                                                               |
| ------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `media_items`       | Media archive items (photos/videos)                 | Moderation: `status` enum (`pending`, `approved`, `rejected`), tags, visibility, soft-delete                        |
| `media_albums`      | Album containers for media                          | `item_count` cached, soft-delete                                                                                    |
| `media_album_items` | Junction: media items ↔ albums                      | `UNIQUE(album_id, media_item_id)`, `sort_order`                                                                     |
| `media_uploads`     | Upload lifecycle tracking (feed, discussions, jobs) | Status enum: `pending`, `ready`, `failed`, `orphaned`; entity link to `feed_post`/`discussion_thread`/`job_posting` |

**Storage Buckets:**

- `media-archive` — Public bucket for media archive (50MB limit)
- `org-media` — Private bucket for org uploads (25MB limit)
- `feedback-screenshots` — Public bucket for friction feedback screenshots (5MB limit, images only)

### Jobs and Mentorship

| Table                       | Purpose                             | Notes                                                                                                                                               |
| --------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `job_postings`              | Job board posts                     | Org-scoped, `industry`, `experience_level` fields                                                                                                   |
| `mentor_profiles`           | Alumni mentor directory             | `UNIQUE(user_id, org_id)`, `expertise_areas` array, `custom_attributes` JSONB, `bio_source`, `bio_generated_at`, `bio_input_hash`, `is_active` flag |
| `mentor_bio_backfill_queue` | Async mentor bio regeneration queue | Service-role-only queue for org-wide AI bio backfills; pending rows deduped by `(organization_id, mentor_profile_id)`                               |
| `mentorship_pairs`          | Mentor–mentee pairings              | Org-scoped pair records. Soft-delete via `deleted_at`                                                                                               |
| `mentorship_logs`           | Mentorship session logs             | `entry_date`, `notes`, `progress_metric` per pair. Soft-delete via `deleted_at`                                                                     |

### Workouts and Competition

| Table                | Purpose                    | Notes                                                              |
| -------------------- | -------------------------- | ------------------------------------------------------------------ |
| `workouts`           | Workout content            | Title, description, date, optional external URL                    |
| `workout_logs`       | Workout participation logs | Status: `not_started`, `in_progress`, `completed`; `metrics` JSONB |
| `competitions`       | Competition definitions    | Org-scoped competition records                                     |
| `competition_teams`  | Teams within competitions  | Named teams per competition. Soft-delete via `deleted_at`          |
| `competition_points` | Point records              | Per-user/team, `reason`, `created_by`                              |

### Payments, Donations, and Embeds

| Table                         | Purpose                             | Notes                                                                                                                                                    |
| ----------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payment_attempts`            | Idempotency ledger                  | Unique on `idempotency_key`, states: `initiated`, `processing`, `succeeded`, `failed`                                                                    |
| `stripe_events`               | Webhook dedup                       | `UNIQUE(event_id)` prevents double-processing                                                                                                            |
| `organization_donations`      | Stripe Connect donation records     | Per-donation event storage, optional `anonymous` flag. Soft-delete via `deleted_at` (compliance guard)                                                   |
| `organization_donation_stats` | Donation rollups                    | Aggregate stats per org                                                                                                                                  |
| `org_donation_embeds`         | Donation embed/link storage         | Finance surface display                                                                                                                                  |
| `org_philanthropy_embeds`     | Philanthropy embed/link storage     | HTTPS-only URLs, `embed_type`: `link`/`iframe`                                                                                                           |
| `philanthropy_events`         | Philanthropy event records          | Org-scoped philanthropy data                                                                                                                             |
| `donations`                   | Lightweight manual donation entries | `amount`, `campaign`, `date`, `donor_name`/`donor_email`, `notes`, soft-delete. Distinct from Stripe-backed `organization_donations`. FK→`organizations` |
| `expenses`                    | Org expense line items              | `amount`, `expense_type`, `name`, `venmo_link`, `user_id`, soft-delete. FK→`organizations`                                                               |

### Records, Reactions & Misc

| Table                        | Purpose                                              | Notes                                                                                                                                                                                                         |
| ---------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `records`                    | Org record book entries (e.g. team/athletic records) | `category`, `title`, `holder_name`, `value`, `year`, `notes`, soft-delete. FK→`organizations`                                                                                                                 |
| `reactions`                  | Emoji reactions on content                           | `target_kind`/`target_id`, `emoji`. FKs→`organizations`/`users`                                                                                                                                               |
| `org_member_role_audit`      | Audit of org membership role/status changes          | `previous_role`/`new_role`, `previous_status`/`new_status`, `source` (`manual`/`ai_pending_action`), `actor_user_id`, `reason`. FKs→`organizations`/`users`/`ai_pending_actions` (migration `20261203000003`) |
| `performance_notes`          | Free-form ops/performance log entries                | `note_type`, `description`, `created_at`. No FKs                                                                                                                                                              |
| `internal_advisor_snapshots` | Periodic snapshots of internal advisor data          | `advisors` JSON, `captured_at`. No FKs                                                                                                                                                                        |
| `mcp_resources`              | MCP server resource catalog                          | `uri`, `title`, `description`, `body`, `category`, `mime_type`, `metadata`. No FKs                                                                                                                            |

### Analytics and Telemetry

| Table                  | Purpose                            | Notes                                                                                                                                                                    |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `analytics_consent`    | Org/user analytics consent         | Composite PK `(org_id, user_id)`                                                                                                                                         |
| `analytics_events`     | Behavioral analytics events        | Event name enum + allowlisted props; hardened by July 2026 migrations; enum extended Dec 2026 (`20261225000000`/`20261225000100`)                                        |
| `analytics_ops_events` | Product/ops analytics event stream | `event_name`, `route`, `platform`, `device_class`, `consent_state`, `session_id`, `payload`. Service-role RLS. FK→`organizations` (nullable). Distinct from `ops_events` |
| `ops_events`           | Operational event log              | System/ops signals                                                                                                                                                       |
| `rate_limit_analytics` | Analytics rate limit windows       | `UNIQUE(user_id, org_id, window_start)`, cleaned by daily cron                                                                                                           |

### Usage Analytics (FERPA/COPPA-compliant)

| Table             | Purpose                                | Notes                                                                                                |
| ----------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `usage_events`    | Raw behavioral events                  | No PII; event types: `page_view`, `feature_enter`, `feature_exit`, `nav_click`; purged after 90 days |
| `usage_summaries` | Aggregated per-user/org feature usage  | `UNIQUE(user_id, org_id, feature, period_start)`                                                     |
| `ui_profiles`     | LLM-generated personalization profiles | Cached with `expires_at` (7-day TTL), `UNIQUE(user_id, org_id)`                                      |

### Error Tracking

| Table          | Purpose                      | Notes                                                                                                        |
| -------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `error_groups` | Aggregated error groups      | `UNIQUE(env, fingerprint)`, severity, rolling counts (`count_1h`, `count_24h`, `total_count`), triage status |
| `error_events` | Individual error occurrences | Linked to `error_groups`, stores message, stack, route, meta JSONB                                           |

### AI Assistant

| Table                    | Purpose                                           | Notes                                                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai_threads`             | AI conversation threads                           | Scoped to user + org + surface. Soft-delete via `deleted_at`. Surfaces: `general`, `members`, `analytics`, `events`                                                                                                                      |
| `ai_messages`            | Messages within AI threads                        | Denormalized `user_id`/`org_id` with composite FK to `ai_threads(id, user_id, org_id)`. Idempotency key. Status: `pending`, `streaming`, `complete`, `error`. Role/content constraint check                                              |
| `ai_audit_log`           | AI request audit trail (one row/request)          | Service-role only (RLS enabled, no policies). No FK on `user_id`/`org_id` — intentional for audit survival. 90-day TTL. Cache + context + RAG-grounding + safety columns; `stage_timings` JSONB; `write_action_id`/`write_action_status` |
| `ai_spend_ledger`        | Per-org monthly AI spend cap ledger               | `UNIQUE(org_id, period_start)`, `spend_microusd`. Charged via `charge_ai_spend()`, gated via `get_ai_spend_for_period()`. Override: `organization_subscriptions.ai_monthly_cap_cents`                                                    |
| `ai_semantic_cache`      | Exact-hash response cache                         | Keyed by `(org_id, surface, permission_scope_key, cache_version, prompt_hash) WHERE invalidated_at IS NULL`. TTL via `expires_at`. Service-role only. `general` surface eligible in v1                                                   |
| `ai_embedding_queue`     | RAG embedding work queue                          | Populated by `enqueue_ai_embedding()` triggers on 8 source tables; `action` `upsert`/`delete`, `attempts`, `processed_at`                                                                                                                |
| `ai_document_chunks`     | RAG chunks + pgvector embeddings (768-dim)        | `source_table` CHECK over 8 sources; `metadata.audience`; searched via `search_ai_documents()`. Soft-delete via `deleted_at`                                                                                                             |
| `knowledge_documents`    | Admin-curated org knowledge base (8th RAG source) | Admin-only RLS; `audience` (`all`/`admins`), `tags[]`. _(Migration `20261224000000`; not yet in `database.ts`/OKF — regen types.)_                                                                                                       |
| `ai_indexing_exclusions` | Admin exclusions from indexing/RAG                | `(org_id, source_table, source_id)`, `excluded_by` SET NULL on user deletion                                                                                                                                                             |
| `ai_pending_actions`     | Confirmation-gated AI write actions               | `action_type`, `payload`/`previous_payload`, `status`, `revise_count`, `result_entity_*`, `expires_at`. The only path the assistant mutates data                                                                                         |
| `ai_draft_sessions`      | Multi-turn draft continuation state               | Service-role only. `draft_type` CHECK (create/update/delete announcement/job/event + send message + discussion reply/thread), `missing_fields[]`, `pending_action_id`                                                                    |
| `ai_feedback`            | Per-message thumbs/ratings                        | `message_id`, `rating`, optional `comment`. Users r/w own; admins read within org. Feeds `evals:ai:feedback`                                                                                                                             |

### LinkedIn, Enrichment & Integrations

| Table                           | Purpose                                                    | Notes                                                                                                                                                 |
| ------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_linkedin_connections`     | LinkedIn OAuth connection state                            | Mirrors `user_calendar_connections`. `UNIQUE(user_id)`, encrypted tokens, sync status `connected`/`disconnected`/`error`                              |
| `linkedin_connections`          | LinkedIn OIDC connection (Sign In with LinkedIn)           | Newer/separate from the OAuth table above. `linkedin_sub`, name/email/picture, `connected_at`/`disconnected_at`. No outbound FKs                      |
| `linkedin_enrichment_runs`      | Async LinkedIn/Apify enrichment run tracking               | `run_id`, `status`, `target_kind`, `linkedin_url`; nullable soft links to `alumni_id`/`organization_id`/`user_id`                                     |
| `linkedin_manual_sync_attempts` | Manual LinkedIn sync quota tracking                        | Per `user_id` + `month_key`; `status` `reserved`/`completed`/`released`; reservation rollback on provider failure                                     |
| `apify_webhook_events`          | Inbound Apify webhook event log                            | `run_id`, `event_type`, `received_at` — dedup/audit for async enrichment                                                                              |
| `org_integrations`              | Per-org per-provider CRM/OAuth connection (e.g. Blackbaud) | Encrypted `access_token_enc`/`refresh_token_enc`, `provider_config`, `status`, last-sync stats. FK→`organizations`                                    |
| `org_integration_oauth_state`   | One-time OAuth CSRF/redirect state                         | `provider`, `redirect_path`, single-use `used`, `user_id`. FK→`organizations`                                                                         |
| `integration_sync_log`          | Per-sync run record for an org integration                 | `sync_type`, `status`, created/updated/skipped/unchanged counts, timing/error. FK→`org_integrations`                                                  |
| `alumni_external_ids`           | Maps alumni to external CRM record IDs                     | `external_id`, `external_data`, `last_synced_at`. FKs→`alumni`, `org_integrations`                                                                    |
| `organization_email_domains`    | Per-org verified email sending domain (Resend)             | `domain`, `resend_domain_id`, `status`, `dns_records`, sender fields. Service-role RLS. _(Migration `20261219000000`; not yet in `database.ts`/OKF.)_ |

### Mobile, Push & Notifications

| Table                       | Purpose                                                                              | Notes                                                                                                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `notifications`             | In-app notification records                                                          | Audience, channel, type, `resource_id`, `target_user_ids`. FK→`organizations`                                                                                                                                                                                                  |
| `notification_reads`        | Per-user read receipts                                                               | `notification_id`, `user_id`, `read_at`. FK→`notifications`                                                                                                                                                                                                                    |
| `notification_preferences`  | Per-user/org push toggles                                                            | 33 cols: per-category `*_push_enabled`, quiet hours, channel enables. FK→`organizations`                                                                                                                                                                                       |
| `notification_jobs`         | Outbound notification/push dispatch queue                                            | Leased via `dispatch_notification_jobs_lease()` (`FOR UPDATE SKIP LOCKED`). `kind`, `status`, `attempts`, `target_user_ids`, `push_type`. FK→`organizations`                                                                                                                   |
| `user_push_tokens`          | Per-device Expo push tokens                                                          | `expo_push_token`, `device_id`, `platform`; conflict `user_id,expo_push_token`; pruned by `cleanup_stale_push_tokens()`. The one push table the mobile client writes                                                                                                           |
| `live_activity_tokens`      | iOS Live Activity APNs tokens                                                        | PK `activity_id`; partial unique active per `(user_id, event_id)`. Service-role only. FKs→`users`/`events`/`organizations`                                                                                                                                                     |
| `wallet_pass_registrations` | Apple Wallet (PassKit) device registrations — **Phase 4 placeholder, not yet wired** | `pass_type_identifier`/`serial_number`/`device_library_identifier` unique; `push_token`, `authentication_token`. Service-role only. No app code reads/writes it yet (no `/api/wallet/v1/devices/...` endpoints). _(Migration `20261206000001`; not yet in `database.ts`/OKF.)_ |
| `mobile_auth_handoffs`      | Web→mobile encrypted session handoff                                                 | `code_hash`, encrypted access/refresh tokens, `expires_at`, `consumed_at`. Consumed via `consume_mobile_auth_handoff()`                                                                                                                                                        |
| `event_reminder_sends`      | Event-reminder idempotency log                                                       | Composite PK `(event_id, kind)`, `sent_at`. FK→`events`. Service-role only                                                                                                                                                                                                     |

### Mentorship PM (Oct 2026)

| Table                 | Purpose                             | Notes                                                                                                       |
| --------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `mentorship_tasks`    | Tasks attached to a mentorship pair | Status, due date, optional assignee. Soft-delete via `deleted_at`. Cascade on pair deletion                 |
| `mentorship_meetings` | Scheduled meetings within a pair    | Start/end timestamps, notes, optional calendar link. Soft-delete via `deleted_at`. Cascade on pair deletion |

### Search (Oct 2026)

> **Correction (June 2026):** Earlier revisions of this doc listed `global_search_entries` and `search_behavioral_analytics` as tables. **Neither exists.** Global search was shipped as **RPC functions** (`search_org_content`, `is_member_directory_visible`, `is_alumni_directory_visible`) plus pg_trgm indexes (migration `20261015110000_global_search.sql`); search telemetry is recorded through the existing analytics pipeline via the `search_used` / `search_result_click` analytics events (`20261015120000`), not a dedicated table. There is no materialized search table.

### Mentorship — Phase 2

| Table                  | Purpose                                                  | Notes                                                                                                                                                                                             |
| ---------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mentee_preferences`   | Structured mentee matching preferences + derived signals | Preferred industries/positions/sports/topics/role_families arrays, `seeking_mentorship`, `goals`; `derived_signals`/`derived_signals_input_hash` (migration `20261216000000`). FK→`organizations` |
| `mentorship_audit_log` | Audit trail of pairing actions                           | `kind`, `actor_user_id`, `metadata`. FKs→`mentorship_pairs` (nullable), `organizations`                                                                                                           |
| `mentorship_reminders` | Admin nudges to mentors with pending proposals           | `mentor_user_id`, `pending_count`, `sent_by`; rate-limited per (org, mentor) 24h. FK→`organizations`                                                                                              |

> `mentee_derived_signals` is **not** a table — migration `20261216000000` adds `derived_signals` columns to `mentee_preferences` (+ `match_why`/`match_why_model` on `mentorship_pairs`) and an `upsert_mentee_derived_signals` RPC.

### Gamification & Engagement

| Table                      | Purpose                                   | Notes                                                                                                                                  |
| -------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `badges`                   | Seed catalog of earnable achievements     | `slug`, `title`, `description`, `icon`, `criteria` JSON; migration-seeded                                                              |
| `member_badges`            | Badges earned per (user, org)             | `earned_at`; eligibility evaluated by streaks-recompute cron. FKs→`badges`/`organizations`/`users`                                     |
| `member_streaks`           | Per-(user, org) weekly attendance streaks | `current_weeks`/`longest_weeks`, `last_qualifying_week_start`; qualifying = checked-in RSVP that ISO week. FKs→`organizations`/`users` |
| `user_onboarding_progress` | Per-user onboarding/tour completion       | `completed_items`/`visited_items` JSON, `welcome_seen_at`, `tour_completed_at`, `dismissed_at`. FK→`organizations`                     |

### Moderation & Safety (App Store Guideline 1.2)

| Table             | Purpose                       | Notes                                                                                                                        |
| ----------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `content_reports` | UGC content/user report queue | `target_type`/`target_id`, `reason`, `reported_user_id`, `status`, reviewer fields, soft-delete. FKs→`organizations`/`users` |
| `user_blocks`     | User-to-user blocks           | `blocker_id`/`blocked_id` (CHECK distinct), soft-delete, unique active pair. FK→`users`                                      |

### Compliance & Security (Oct 2026)

| Table                          | Purpose                                              | Notes                                                                                                                                                          |
| ------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `breach_incidents`             | Security/privacy incident tracking                   | Discovery/containment/resolution timestamps, severity tier, notification log. Backs `docs/Incident_Response_Runbook.md`                                        |
| `data_access_log`              | Record-level access telemetry                        | Who accessed which resource when (for FERPA / NY Ed Law 2-d audit). IP stored hashed                                                                           |
| `user_agreements`              | User acceptance of ToS / Privacy / DSA versions      | `user_id`, `agreement_type`, `version`, `accepted_at`                                                                                                          |
| `dsr_requests`                 | Data Subject Request intake/SLA tracking (GDPR/CCPA) | 25 cols: `request_type`, requester identity, `ack_due_at`/`resolve_due_at`, status, resolution. FKs→`data_access_log`/`organizations`/`user_deletion_requests` |
| `enterprise_deletion_requests` | 30-day soft-delete grace for enterprises             | `status` `pending`/`completed`/`cancelled`, `scheduled_deletion_at`; mirrors `user_deletion_requests` + cron. FK→`enterprises`                                 |

### Audit Logs

| Table                   | Purpose                        | Notes                                                       |
| ----------------------- | ------------------------------ | ----------------------------------------------------------- |
| `dev_admin_audit_logs`  | Dev/platform admin audit trail | Action, target type/id/slug, IP, user agent, metadata JSONB |
| `enterprise_audit_logs` | Enterprise admin audit trail   | Actor email, IP, user agent (see Enterprise section)        |

---

## Enum Highlights

| Enum                   | Current Values                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_role`            | `admin`, `active_member`, `alumni`, `parent` (plus legacy compat in some code paths)                                                                                                                                                                                                                                                                                        |
| `membership_status`    | `pending`, `active`, `revoked`                                                                                                                                                                                                                                                                                                                                              |
| `chat_group_role`      | `admin`, `moderator`, `member`                                                                                                                                                                                                                                                                                                                                              |
| `chat_message_status`  | `pending`, `approved`, `rejected`                                                                                                                                                                                                                                                                                                                                           |
| `enterprise_role`      | `owner`, `billing_admin`, `org_admin`                                                                                                                                                                                                                                                                                                                                       |
| `media_status`         | `pending`, `approved`, `rejected`                                                                                                                                                                                                                                                                                                                                           |
| `media_upload_status`  | `pending`, `ready`, `failed`, `orphaned`                                                                                                                                                                                                                                                                                                                                    |
| `media_entity_type`    | `feed_post`, `discussion_thread`, `job_posting`                                                                                                                                                                                                                                                                                                                             |
| `analytics_event_name` | `app_open`, `route_view`, `nav_click`, `page_dwell_bucket`, `directory_view`, `directory_filter_apply`, `profile_card_open`, `events_view`, `event_open`, `rsvp_update`, `donation_flow_start`, `donation_checkout_start`, `donation_checkout_result`, `chat_thread_open`, `chat_message_send`, `chat_participants_change` (realigned Mar 2026 — deprecated events removed) |

## Extensions

| Extension | Schema       | Purpose                                                                                                                                                                        |
| --------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vector`  | `extensions` | pgvector — backs the shipped RAG pipeline (`ai_document_chunks` 768-dim embeddings, `search_ai_documents()`). The semantic _cache_ is exact-hash, not vector-similarity, in v1 |

---

## RLS Helper Functions

| Function                            | Purpose                                                |
| ----------------------------------- | ------------------------------------------------------ |
| `is_org_admin(org_id)`              | Current user is admin for org                          |
| `is_org_member(org_id)`             | Current user is active member of org                   |
| `has_active_role(org_id, roles[])`  | Current user has one of the specified roles            |
| `is_enterprise_member(ent_id)`      | Current user has any role in enterprise                |
| `is_enterprise_admin(ent_id)`       | Current user is owner/billing_admin/org_admin          |
| `is_chat_group_member(group_id)`    | Current user is active (non-removed) group member      |
| `is_chat_group_moderator(group_id)` | Current user is admin/moderator and not removed        |
| `is_chat_group_creator(group_id)`   | Current user is `created_by` on chat_groups            |
| `check_analytics_rate_limit(...)`   | Atomic rate limit check with upsert (SECURITY DEFINER) |

---

## Key RPC Functions

| Function                                                    | Purpose                                                                           | Migration                                         |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| `create_org_invite(...)`                                    | Create org invite with code generation                                            | `20251217100000`                                  |
| `redeem_parent_invite(...)`                                 | Atomic parent invite redemption                                                   | `20260625000000` + fixes through `20260701000003` |
| `resolve_alumni_quota(...)`                                 | Alumni quota enforcement                                                          | `20260628000000`                                  |
| `purge_analytics_events()`                                  | Purge expired analytics data                                                      | Used by analytics-purge cron                      |
| `purge_ops_events()`                                        | Purge expired ops events                                                          | Used by analytics-purge cron                      |
| `get_subscription_status(...)`                              | Get org subscription status                                                       | `20260430120000`                                  |
| `save_user_linkedin_url(uuid, text)`                        | Sync LinkedIn URL across member/alumni/parent profiles                            | `20260703000000`                                  |
| `sync_user_linkedin_profile_fields(uuid, text, text, text)` | Sync name/photo from LinkedIn to profiles                                         | `20260704000000`                                  |
| `sync_user_linkedin_enrichment(uuid, text...)`              | Sync Proxycurl enrichment data to member/alumni                                   | `20260707000000`                                  |
| `purge_expired_ai_semantic_cache()`                         | TTL cleanup for AI semantic cache (service-role only, batch 500)                  | `20260321100001`                                  |
| `init_ai_chat(...)`                                         | Create/reuse AI thread + insert user message (`p_skip_user_message` for refusals) | `20261211000000`                                  |
| `charge_ai_spend(...)` / `get_ai_spend_for_period(...)`     | Atomic AI spend charge + pre-call cap gate (`ai_spend_ledger`)                    | AI spend cap batch                                |
| `search_ai_documents(..., p_audience_filter)`               | RAG retrieval over `ai_document_chunks` with audience scoping                     | `20261220000000`                                  |
| `enqueue_ai_embedding()` / `backfill_ai_embedding_queue()`  | Embedding-queue triggers + backfill over 8 RAG sources                            | `20261224000000`                                  |
| `dispatch_notification_jobs_lease(p_batch_size)`            | Lease pending `notification_jobs` (`FOR UPDATE SKIP LOCKED`)                      | `20261201000000`                                  |
| `cleanup_stale_push_tokens(interval)`                       | Prune Expo push tokens stale >90 days                                             | `20261202000002`                                  |
| `consume_mobile_auth_handoff(p_code_hash)`                  | Single-use web→mobile session handoff                                             | mobile-handoff batch                              |
| `execute_member_role_change(...)`                           | Role/status change with `org_member_role_audit` trail                             | `20261204000000`                                  |

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

- Email delivery uses Resend when `RESEND_API_KEY` is configured; per-org verified sending domains live in `organization_email_domains`.
- Push delivery is queue-based: `notification_jobs` is leased by the `notification-dispatch` cron via `dispatch_notification_jobs_lease()` (`FOR UPDATE SKIP LOCKED`) and sent to Expo using `user_push_tokens`; iOS Live Activities and Apple Wallet passes have their own APNs paths. See [`mobile-schema.md`](./mobile-schema.md).
- SMS delivery remains a stub integration point.

---

## Migration Timeline Highlights

| Period   | Key Additions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dec 2025 | Core tables, org invites, RLS policies, donations, RSVP                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Jan 2026 | Chat groups, academic schedules, forms, documents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Feb 2026 | Enterprise accounts, error tracking, analytics, graduation, user deletion, compliance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Mar 2026 | Alumni bulk import, quota fixes, AI assistant foundations (threads, messages, audit log), semantic response cache (pgvector), architecture fixes (soft-delete on 6 tables, ai_messages denormalization, composite FK integrity, schedule domain FKs), LinkedIn OAuth connections + enrichment RPCs, feed polls, member enrichment columns, analytics event enum realignment, feedback screenshots bucket, anonymous friction feedback                                                                                                                                                                                                                                                                  |
| Apr 2026 | Stripe idempotency, Google Calendar sync, calendar feeds, schedule sources/events, schedule domain allowlist, performance/security fixes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| May 2026 | Enterprise hybrid pricing, event recurrence, discussions, jobs, mentor profiles, feed, media uploads, dev-admin audit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Jun 2026 | Media archive + moderation + albums, parent invites, parent role propagation (feed, announcements, chat, remaining tables), donations anonymous flag, chat polls/forms, alumni quota fixes, member soft-delete sync                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Jul 2026 | Parent invite redemption fixes, analytics hardening (allowlisted props, enum validation, behavioral tracking policy), AI context enrichment columns (`context_surface`, `context_token_estimate` on `ai_audit_log`), AI stage timing telemetry (`stage_timings` on `ai_audit_log`)                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Aug 2026 | Audit log retention, RAG hardening follow-ups, security definer search-path hardening                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Sep 2026 | Enterprise invite hardening, invite pagination indexes, enterprise member count RPC, enterprise invite role cast fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Oct 2026 | Duplicate OAuth account merge, user agreements, `data_access_log`, IP hash backfill, `breach_incidents`, mentorship tasks + meetings + pair cascade deletion, parent role added to remaining RLS policies, parent discussion posting, alumni birth year (+ enterprise stats, bulk-import column), announcement visibility reconciliation, member restore on re-approval, RPC-based `global_search`, org `hide_donor_names`, org `base_color`, AI feedback, graduation RPC admin guard                                                                                                                                                                                                                  |
| Nov 2026 | Notification dispatch queue + push prefs (`notification_jobs`, lease RPC, `user_push_tokens` cleanup), iOS `live_activity_tokens`, `claim_alumni_profiles` RPCs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Dec 2026 | `event_reminder_sends` + event check-in mode + "track on lock screen", `wallet_pass_registrations`, donation-eligible-iOS flag, `org_member_role_audit` + role-change RPC, AI spend cap + ledger, AI draft mutation sessions, init-skip-user-message, RAG audience scoping + chunk-source sync, `knowledge_documents` (8th RAG source), `enterprise_deletion_requests`, GDPR FK delete actions, security-definer view fix, FK covering indexes, `mentee_derived_signals` (columns + RPC), mentor bio requeue triggers, alumni enrichment provenance, `organization_email_domains`, graph_sync_queue teardown (retired → dropped), analytics event-name allowlist extension, `alumni_reinvite_tracking` |

> For per-migration detail, use `git log supabase/migrations/` — this table is intentionally coarse.

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

---

## Production Incidents

### 2026-06-02 — v2 org checkout provisioning broken by an unapplied migration

**Symptom.** A customer paid for an org (`New York Edge MS 127X – THE CASTLE HILL`, slug `new-york-edge-ms-127x-the-castle-hill`) via the v2 self-serve flow, was charged on Stripe, but the org never appeared on their orgs page. The org row existed with **zero `user_organization_roles`** and **no `organization_subscriptions` row**, and the `payment_attempts` row was stuck in `processing`.

**Root cause.** Migration `20260429120000_pricing_v2_subscription_columns.sql` (adds `pricing_model_version` + `pricing_v2_snapshot` to `organization_subscriptions` **and** `enterprise_subscriptions`) was committed to the repo but **never applied to production**. The `org_v2` / `enterprise_v2` branches in `apps/web/src/app/api/stripe/webhook/handler.ts` write those columns via `ensureSubscriptionSeedV2`. With the columns missing, `checkout.session.completed` threw `Could not find the 'pricing_model_version' column of 'organization_subscriptions' in the schema cache` _after_ the org was created but _before_ the subscription row, the admin-role grant, and the `payment_attempts` finalization. The failure is deterministic, so every Stripe retry hit the same wall and the `stripe_events` row never reached `processed_at`. Net effect: **every actually-paid v2 checkout would half-provision** (blast radius at the time was a single live paid org; all other stuck `*_v2_checkout` attempts were unpaid/abandoned dev tests).

**Fix.** Applied the missing migration to production, then manually replayed the webhook's provisioning steps for the affected org (insert the v2 `organization_subscriptions` row, grant the purchaser `admin`/`active`, mark the `payment_attempts` row `succeeded` + linked to the org, mark the `stripe_events` row processed). `stripe_customer_id` and `current_period_end` were backfilled approximately and will be corrected by the next subscription webhook (noted in `pricing_v2_snapshot.backfilled_by`).

**Follow-ups to look into.**

- **Migration-ledger drift.** `supabase_migrations.schema_migrations` is missing ~116 repo migration _version strings_. This is **mostly renumbering noise, not missing schema** — the repo's migration history appears to have been rebased/renumbered to later dates, and spot-checked "missing" migrations (`reactions`, `enterprise_deletion_requests`, `bulk_import_alumni_rich` birth*year, `enterprise_hard_org_limit`) already exist in prod under their original version numbers. The pricing_v2 migration is the one case confirmed to be \_genuinely* unapplied schema. Worth a proper reconciliation pass (`supabase migration repair`) plus an object-level audit to confirm nothing else is truly missing, and a CI guard so a committed-but-unapplied migration can't silently ship again.
- **Webhook resilience.** A deterministic handler error half-provisions a paid org with no alerting surfaced to an operator. Consider failing _before_ org creation when required schema is absent, and/or an alert when a `checkout.session.completed` for a paid session never reaches `processed_at`.
