# Supabase Schema Audit

**Last Updated**: January 2026
**Scope**: All migrations through `20260425100000_push_notifications.sql` (45 migration files)

---

## Tables & Key Columns

### Core Identity & Multi-Tenant

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `users` | Synced from `auth.users` via trigger | `id` (PK, FK to auth.users), `email`, `name`, `avatar_url` |
| `organizations` | Top-level tenant entity | `id`, `slug`, `name`, `logo_url`, `donation_embed_url`, `nav_config` (jsonb), `secondary_color`, `stripe_connect_account_id` |
| `user_organization_roles` | Membership + role assignment | `id`, `user_id`, `organization_id`, `role` (user_role enum), `status` (membership_status enum) |
| `organization_subscriptions` | Stripe subscription state per org | `id`, `organization_id` (unique), `stripe_customer_id`, `stripe_subscription_id`, `base_plan_interval`, `alumni_bucket`, `alumni_plan_interval`, `status`, `current_period_end`, `grace_period_ends_at` |

### Members & Alumni

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `members` | Active member profiles | `id`, `organization_id`, `user_id`, `email`, `first_name`, `last_name`, `photo_url`, `linkedin_url`, `deleted_at` |
| `alumni` | Alumni profiles with extended fields | `id`, `organization_id`, `user_id`, `email`, `first_name`, `last_name`, `photo_url`, `linkedin_url`, `phone_number`, `industry`, `current_company`, `current_city`, `position_title`, `graduation_year`, `deleted_at` |

### Events & RSVPs

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `events` | Organization events | `id`, `organization_id`, `audience` (check: members/alumni/both), `target_user_ids`, `deleted_at` |
| `event_rsvps` | Attendance tracking with check-in | `id`, `event_id`, `user_id`, `organization_id`, `status` (attending/not_attending/maybe), `checked_in_at`, `checked_in_by`, unique on `(event_id, user_id)` |

### Announcements & Notifications

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `announcements` | Audience-targeted announcements | `id`, `organization_id`, `audience` (all/members/active_members/alumni/individuals), `audience_user_ids`, `deleted_at` |
| `notifications` | System notifications | `id`, `organization_id`, `audience` (members/alumni/both), `target_user_ids`, `deleted_at` |
| `notification_preferences` | Per-user notification settings | `id`, `user_id`, `organization_id`, `push_enabled` (boolean, default true) |
| `user_push_tokens` | Expo push tokens per device | `id`, `user_id`, `expo_push_token`, `device_id`, `platform` (ios/android/web), unique on `(user_id, expo_push_token)` |

### Invites

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `organization_invites` | Join codes and tokens | `id`, `organization_id`, `code`, `token` (unique), `role` (admin/active_member/alumni), `uses_remaining`, `expires_at`, `revoked_at`, `created_by_user_id` |

### Mentorship

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `mentorship_pairs` | Mentor/mentee pairings | `id`, `organization_id`, `mentor_user_id`, `mentee_user_id`, `status` |
| `mentorship_logs` | Session notes and progress | `id`, `organization_id`, `pair_id`, `created_by`, `entry_date`, `notes`, `progress_metric` |

### Workouts & Competition

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `workouts` | Workout definitions | `id`, `organization_id`, `title`, `description`, `workout_date`, `external_url`, `created_by` |
| `workout_logs` | User participation tracking | `id`, `organization_id`, `workout_id`, `user_id`, `status`, `notes`, `metrics` (jsonb) |
| `competitions` | Competition containers | `id`, `organization_id` |
| `competition_teams` | Teams within competitions | `id`, `organization_id`, `competition_id`, `name` |
| `competition_points` | Point tracking per team/user | `id`, `organization_id`, `team_id`, `reason`, `created_by`, `deleted_at` |

### Donations & Payments

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `donations` | Legacy donation records | `id`, `organization_id`, `deleted_at` |
| `organization_donations` | Stripe-powered donation events | `id`, `organization_id`, `amount_cents`, `currency`, `status`, `donor_name`, `donor_email`, `stripe_payment_intent_id` (unique), `stripe_checkout_session_id` (unique), `event_id`, `purpose`, `metadata` (jsonb) |
| `organization_donation_stats` | Aggregate donation metrics per org | `organization_id` (PK), `total_amount_cents`, `donation_count`, `last_donation_at` |
| `payment_attempts` | Idempotency ledger for all payment flows | `id`, `idempotency_key` (unique), `user_id`, `organization_id`, `flow_type`, `amount_cents`, `status`, `stripe_checkout_session_id`, `stripe_payment_intent_id`, `checkout_url`, `request_fingerprint`, `last_error`, `metadata` (jsonb) |
| `stripe_events` | Webhook event deduplication | `id`, `event_id` (unique), `type`, `processed_at`, `payload_json` (jsonb) |

### Embeds

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `org_philanthropy_embeds` | Philanthropy links/iframes | `id`, `organization_id`, `title`, `url` (HTTPS check), `embed_type` (link/iframe), `display_order` |
| `org_donation_embeds` | Donation links/iframes | `id`, `organization_id`, `title`, `url` (HTTPS check), `embed_type` (link/iframe), `display_order` |
| `philanthropy_events` | Philanthropy event records | `id`, `organization_id`, `deleted_at` |

### Schedules & Files

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `academic_schedules` | User academic commitments | `id`, `organization_id`, `user_id`, `title`, `occurrence_type` (single/daily/weekly/monthly), `start_time`, `end_time`, `start_date`, `end_date`, `day_of_week` (smallint[]), `day_of_month`, `notes`, `deleted_at` |
| `schedule_files` | Uploaded schedule PDFs/images | `id`, `organization_id`, `user_id`, `file_name`, `file_path`, `file_size`, `mime_type`, `deleted_at` |
| `records` | Organization records | `id`, `organization_id`, `deleted_at` |

### Forms & Documents

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `forms` | Admin-created form templates | `id`, `organization_id`, `title`, `description`, `fields` (jsonb), `is_active`, `created_by`, `deleted_at` |
| `form_submissions` | User responses to forms | `id`, `form_id`, `organization_id`, `user_id`, `responses` (jsonb), `submitted_at` |
| `form_documents` | PDF form templates | `id`, `organization_id`, `title`, `file_name`, `file_path`, `is_active`, `created_by`, `deleted_at` |
| `form_document_submissions` | Filled/signed document uploads | `id`, `document_id`, `organization_id`, `user_id`, `file_name`, `file_path`, `submitted_at` |

### Group Chat

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `chat_groups` | Group chat containers | `id`, `organization_id`, `name`, `description`, `is_default`, `require_approval`, `created_by`, `deleted_at` |
| `chat_group_members` | Chat membership tracking | `id`, `chat_group_id`, `user_id`, `organization_id`, `role` (chat_group_role enum: admin/moderator/member), `joined_at`, `last_read_at`, unique on `(chat_group_id, user_id)` |
| `chat_messages` | Messages with approval workflow | `id`, `chat_group_id`, `organization_id`, `author_id`, `body`, `status` (chat_message_status enum: pending/approved/rejected), `approved_by`, `rejected_by`, `edited_at`, `deleted_at` |

### Google Calendar Sync

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `user_calendar_connections` | OAuth tokens and connection status | `id`, `user_id` (unique), `google_email`, `access_token_encrypted`, `refresh_token_encrypted`, `token_expires_at`, `status` (connected/disconnected/error), `last_sync_at` |
| `event_calendar_entries` | Maps events to Google Calendar IDs | `id`, `event_id`, `user_id`, `organization_id`, `google_event_id`, `sync_status` (pending/synced/failed/deleted), `last_error`, unique on `(event_id, user_id)` |
| `calendar_sync_preferences` | Per-user sync settings per org | `id`, `user_id`, `organization_id`, `sync_general`, `sync_game`, `sync_meeting`, `sync_social`, `sync_fundraiser`, `sync_philanthropy` (all boolean, default true), unique on `(user_id, organization_id)` |

### Expenses

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `expenses` | Organization expense tracking | `id`, `organization_id` |

---

## Enum Types

| Enum | Values |
|------|--------|
| `user_role` | `admin`, `active_member`, `alumni` (legacy `member` and `viewer` migrated) |
| `membership_status` | `active`, `revoked`, `pending` |
| `chat_message_status` | `pending`, `approved`, `rejected` |
| `chat_group_role` | `admin`, `moderator`, `member` |

---

## RLS Policy Summary

### Pattern Key
- **Org members** = `has_active_role(organization_id, ARRAY['admin','active_member','alumni'])` or `is_org_member(organization_id)`
- **Admin only** = `has_active_role(organization_id, ARRAY['admin'])` or `is_org_admin(organization_id)`
- **Page editors** = `can_edit_page(organization_id, '/path')` (role-based page editing from `nav_config`)
- **Self only** = `auth.uid() = user_id`
- **Service only** = `auth.role() = 'service_role'`

### Access Rules by Table

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `users` | All authenticated | -- | Self only | -- |
| `user_organization_roles` | Self or admin | Self (join flow) | Admin or self (limited) | Admin only |
| `organizations` | Org members | -- | -- | -- |
| `members` | Org members | Admin only | Admin or self (profile owner) | Admin only |
| `alumni` | Org members | Page editors + `can_add_alumni()` | Page editors or self (profile owner) | Page editors |
| `events` | Org members | Admin only | Admin only | Admin only |
| `event_rsvps` | Org members | Self (with active role) | Self or admin | Self |
| `announcements` | `can_view_announcement()` | Admin only | Admin only | Admin only |
| `donations` | Org members | Page editors | Page editors | Page editors |
| `organization_donations` | Org members | Page editors | Page editors | Page editors |
| `organization_donation_stats` | Org members | Page editors | Page editors | Page editors |
| `org_philanthropy_embeds` | Org members | Page editors | Page editors | Page editors |
| `org_donation_embeds` | Org members | Page editors | Page editors | Page editors |
| `philanthropy_events` | Org members | Page editors | Page editors | Page editors |
| `notifications` | Org members | Admin only | Admin only | Admin only |
| `notification_preferences` | Self only | Self only | Self only | -- |
| `organization_invites` | Admin or valid token lookup | Admin only | Admin only | Admin only |
| `mentorship_pairs` | Org members | Admin or self (alumni) | Admin or self (participant) | Admin or self (participant) |
| `mentorship_logs` | Org members | Admin or pair participant | Admin or pair participant | Admin only |
| `workouts` | Org members | Admin only | Admin only | Admin only |
| `workout_logs` | Org members | Admin only | Admin only | Admin only |
| `competitions` | Org members | Admin only | Admin only | Admin only |
| `competition_teams` | Org members | Admin only | Admin only | Admin only |
| `competition_points` | Org members | Admin only | Admin only | Admin only |
| `academic_schedules` | Self or admin | Self only | Self only | Self only |
| `schedule_files` | Self or admin | Self only | Self only | Self only |
| `forms` | Admin (all) or members (active only) | Admin only | Admin only | Admin only |
| `form_submissions` | Self or admin | Self (with active role) | -- | -- |
| `form_documents` | Admin (all) or members (active only) | Admin only | Admin only | Admin only |
| `form_document_submissions` | Self or admin | Self (with active role) | -- | Self |
| `chat_groups` | Org member + group member (or admin) | Admin only | Admin only | Admin only |
| `chat_group_members` | Group member or admin | Admin/moderator | Admin/moderator | Admin/moderator |
| `chat_messages` | Group member (approved msgs + own pending) | Group member | Author or moderator | Author or moderator |
| `user_calendar_connections` | Self only | Self only | Self only | Self only |
| `event_calendar_entries` | Self or admin | Self or admin | Self or admin | Self or admin |
| `calendar_sync_preferences` | Self only | Self (with active role) | Self only | Self only |
| `user_push_tokens` | Self only | Self only | Self only | Self only |
| `payment_attempts` | Service only | Service only | Service only | Service only |
| `stripe_events` | Service only | Service only | Service only | Service only |
| `expenses` | Org members | Page editors | Page editors | Page editors |

---

## Security Functions

### Role-Checking Helpers

| Function | Signature | Purpose |
|----------|-----------|---------|
| `has_active_role` | `(org_id uuid, allowed_roles text[]) -> boolean` | Checks if current user has one of the specified active roles in org |
| `is_org_member` | `(org_id uuid) -> boolean` | Checks if current user has any active membership in org |
| `is_org_admin` | `(org_id uuid) -> boolean` | Checks if current user is admin in org |
| `can_view_announcement` | `(announcement_row) -> boolean` | Audience-based visibility check (all/members/alumni/individuals) |
| `can_edit_page` | `(org_id uuid, path text) -> boolean` | Checks if user's role allows editing the given page path (via `nav_config` jsonb) |

### Chat Helpers

| Function | Signature | Purpose |
|----------|-----------|---------|
| `is_chat_group_member` | `(group_id uuid) -> boolean` | Checks if current user belongs to the chat group |
| `is_chat_group_moderator` | `(group_id uuid) -> boolean` | Checks if current user is admin or moderator in the chat group |

### Alumni Quota Functions

| Function | Signature | Purpose |
|----------|-----------|---------|
| `alumni_bucket_limit` | `(p_bucket text) -> integer` | Maps bucket string to numeric limit (IMMUTABLE) |
| `get_alumni_quota` | `(p_org_id uuid) -> jsonb` | Returns quota info: bucket, limit, count, remaining (admin only) |
| `can_add_alumni` | `(p_org_id uuid) -> boolean` | Returns true if org has alumni capacity remaining |
| `assert_alumni_quota` | `(p_org_id uuid) -> void` | Raises exception if alumni quota exceeded |

### RPC Functions

| Function | Signature | Purpose |
|----------|-----------|---------|
| `create_org_invite` | `(p_organization_id, p_role, p_uses, p_expires_at) -> organization_invites` | Admin-only invite creation with secure code/token generation; enforces alumni quota for alumni invites |
| `redeem_org_invite` | `(p_code text) -> jsonb` | Validates invite, creates active membership, decrements uses |
| `redeem_org_invite_by_token` | `(p_token text) -> jsonb` | Token-based wrapper around redeem_org_invite |
| `get_dropdown_options` | `(p_organization_id uuid) -> jsonb` | Returns aggregated filter options (graduation years, industries, companies, cities, positions, etc.) |
| `check_in_event_attendee` | `(p_rsvp_id uuid, p_undo boolean) -> jsonb` | Admin-only check-in/undo for event attendees |
| `increment_donation_stats` | `(p_org_id, p_amount_delta, p_count_delta, p_last) -> void` | Atomically increments donation aggregates via upsert |

### Utility Functions

| Function | Signature | Purpose |
|----------|-----------|---------|
| `handle_new_user` | `() -> trigger` | Syncs `auth.users` to `public.users` on insert/update |
| `handle_org_member_sync` | `() -> trigger` | Syncs `user_organization_roles` to `members`/`alumni` tables; enforces alumni quota |
| `update_updated_at_column` | `() -> trigger` | Generic `updated_at = now()` trigger function |
| `protect_checkin_columns` | `() -> trigger` | Blocks non-admins from directly updating `checked_in_at`/`checked_in_by` |
| `protect_rsvp_org_id` | `() -> trigger` | Prevents changing `organization_id` on event_rsvps |
| `gen_random_bytes` | `(integer) -> bytea` | Public schema wrapper for `extensions.gen_random_bytes` |

All SECURITY DEFINER functions use `SET search_path = ''` (or `= public`) to prevent search-path injection, except `handle_org_member_sync()` (`20260412093000`) which still needs hardening.

---

## Triggers

### User & Membership Sync

| Trigger | Table | Event | Function |
|---------|-------|-------|----------|
| `on_auth_user_created` | `auth.users` | AFTER INSERT | `handle_new_user()` |
| `on_auth_user_updated` | `auth.users` | AFTER UPDATE | `handle_new_user()` |
| `on_org_member_sync` | `user_organization_roles` | AFTER INSERT OR UPDATE | `handle_org_member_sync()` |

### Check-In Security

| Trigger | Table | Event | Function |
|---------|-------|-------|----------|
| `event_rsvps_protect_checkin` | `event_rsvps` | BEFORE UPDATE | `protect_checkin_columns()` |
| `event_rsvps_protect_org_id` | `event_rsvps` | BEFORE UPDATE | `protect_rsvp_org_id()` |

### Updated-At Timestamps

These tables have BEFORE UPDATE triggers calling `update_updated_at_column()` (or table-specific equivalents):

`members`, `alumni`, `events`, `announcements`, `mentorship_pairs`, `mentorship_logs`, `workouts`, `workout_logs`, `notification_preferences`, `org_philanthropy_embeds`, `org_donation_embeds`, `organization_donations`, `organization_donation_stats`, `chat_groups`, `event_rsvps`, `payment_attempts`, `user_calendar_connections`, `event_calendar_entries`, `calendar_sync_preferences`, `user_push_tokens`

---

## Indexes

### Partial Indexes (Soft Delete)

| Index | Table | Columns | Filter |
|-------|-------|---------|--------|
| `alumni_org_deleted_idx` | `alumni` | `organization_id` | `WHERE deleted_at IS NULL` |
| `members_org_not_deleted_idx` | `members` | `organization_id` | `WHERE deleted_at IS NULL` |

### Organization-Scoped Indexes

| Index | Table | Columns |
|-------|-------|---------|
| `idx_members_org` | `members` | `organization_id` |
| `idx_events_org` | `events` | `organization_id` |
| `idx_announcements_org` | `announcements` | `organization_id` |
| `idx_donations_org` | `donations` | `organization_id` |
| `idx_notifications_org` | `notifications` | `organization_id` |
| `idx_philanthropy_events_org` | `philanthropy_events` | `organization_id` |
| `idx_records_org` | `records` | `organization_id` |
| `idx_competitions_org` | `competitions` | `organization_id` |
| `organization_subscriptions_org_idx` | `organization_subscriptions` | `organization_id` (unique) |

### Alumni Search Indexes

| Index | Table | Column |
|-------|-------|--------|
| `alumni_graduation_year_idx` | `alumni` | `graduation_year` |
| `alumni_industry_idx` | `alumni` | `industry` |
| `alumni_current_company_idx` | `alumni` | `current_company` |
| `alumni_current_city_idx` | `alumni` | `current_city` |
| `alumni_position_title_idx` | `alumni` | `position_title` |

### Invite Indexes

| Index | Table | Columns | Notes |
|-------|-------|---------|-------|
| `organization_invites_org_code_idx` | `organization_invites` | `(organization_id, code)` | Unique |
| `organization_invites_token_idx` | `organization_invites` | `token` | Partial: WHERE token IS NOT NULL |
| `organization_invites_org_id_idx` | `organization_invites` | `organization_id` |

### Embed Indexes

| Index | Table | Columns |
|-------|-------|---------|
| `org_philanthropy_embeds_org_idx` | `org_philanthropy_embeds` | `organization_id` |
| `org_philanthropy_embeds_org_order_idx` | `org_philanthropy_embeds` | `(organization_id, display_order)` |
| `org_donation_embeds_org_idx` | `org_donation_embeds` | `organization_id` |
| `org_donation_embeds_org_order_idx` | `org_donation_embeds` | `(organization_id, display_order)` |

### Donation & Payment Indexes

| Index | Table | Columns | Notes |
|-------|-------|---------|-------|
| `organization_donations_org_idx` | `organization_donations` | `organization_id` |
| `organization_donations_status_idx` | `organization_donations` | `(organization_id, status)` |
| `organization_donations_pi_unique` | `organization_donations` | `stripe_payment_intent_id` | Unique |
| `organization_donations_checkout_session_unique` | `organization_donations` | `stripe_checkout_session_id` | Unique |
| `payment_attempts_checkout_session_unique` | `payment_attempts` | `stripe_checkout_session_id` | Partial unique |
| `payment_attempts_payment_intent_unique` | `payment_attempts` | `stripe_payment_intent_id` | Partial unique |
| `payment_attempts_transfer_unique` | `payment_attempts` | `stripe_transfer_id` | Partial unique |
| `payment_attempts_payout_unique` | `payment_attempts` | `stripe_payout_id` | Partial unique |
| `payment_attempts_org_flow_idx` | `payment_attempts` | `(organization_id, flow_type)` |
| `payment_attempts_status_idx` | `payment_attempts` | `status` |
| `stripe_events_type_idx` | `stripe_events` | `type` |

### Event RSVP Indexes

| Index | Table | Columns | Notes |
|-------|-------|---------|-------|
| `event_rsvps_event_id_idx` | `event_rsvps` | `event_id` |
| `event_rsvps_user_id_idx` | `event_rsvps` | `user_id` |
| `event_rsvps_org_id_idx` | `event_rsvps` | `organization_id` |
| `event_rsvps_checked_in_idx` | `event_rsvps` | `(event_id, checked_in_at)` | Partial: WHERE checked_in_at IS NOT NULL |

### Chat Indexes

| Index | Table | Columns | Notes |
|-------|-------|---------|-------|
| `chat_groups_org_idx` | `chat_groups` | `organization_id` |
| `chat_groups_org_default_idx` | `chat_groups` | `(organization_id, is_default)` | Filtered |
| `chat_group_members_group_idx` | `chat_group_members` | `chat_group_id` |
| `chat_group_members_user_idx` | `chat_group_members` | `user_id` |
| `chat_group_members_org_idx` | `chat_group_members` | `organization_id` |
| `chat_messages_group_idx` | `chat_messages` | `chat_group_id` |
| `chat_messages_org_idx` | `chat_messages` | `organization_id` |
| `chat_messages_author_idx` | `chat_messages` | `author_id` |
| `chat_messages_created_idx` | `chat_messages` | `created_at` | Filtered: WHERE deleted_at IS NULL |
| `chat_messages_pending_idx` | `chat_messages` | `(chat_group_id, status)` | Filtered: WHERE status = 'pending' |

### Schedule & Form Indexes

| Index | Table | Columns |
|-------|-------|---------|
| `idx_academic_schedules_org_user` | `academic_schedules` | `(organization_id, user_id, deleted_at)` |
| `idx_academic_schedules_org` | `academic_schedules` | `(organization_id, deleted_at)` |
| `idx_schedule_files_org` | `schedule_files` | `(organization_id, deleted_at)` |
| `idx_schedule_files_user` | `schedule_files` | `(organization_id, user_id, deleted_at)` |
| `idx_forms_org` | `forms` | `(organization_id, deleted_at)` |
| `idx_forms_active` | `forms` | `(organization_id, is_active, deleted_at)` |
| `idx_form_submissions_form` | `form_submissions` | `form_id` |
| `idx_form_submissions_org` | `form_submissions` | `organization_id` |
| `idx_form_submissions_user` | `form_submissions` | `user_id` |
| `idx_form_documents_org` | `form_documents` | `(organization_id, deleted_at)` |
| `idx_form_documents_active` | `form_documents` | `(organization_id, is_active, deleted_at)` |
| `idx_form_doc_submissions_doc` | `form_document_submissions` | `document_id` |
| `idx_form_doc_submissions_org` | `form_document_submissions` | `organization_id` |
| `idx_form_doc_submissions_user` | `form_document_submissions` | `user_id` |

### Calendar Sync Indexes

| Index | Table | Columns |
|-------|-------|---------|
| `user_calendar_connections_user_id_idx` | `user_calendar_connections` | `user_id` |
| `user_calendar_connections_status_idx` | `user_calendar_connections` | `status` |
| `event_calendar_entries_event_id_idx` | `event_calendar_entries` | `event_id` |
| `event_calendar_entries_user_id_idx` | `event_calendar_entries` | `user_id` |
| `event_calendar_entries_org_id_idx` | `event_calendar_entries` | `organization_id` |
| `event_calendar_entries_sync_status_idx` | `event_calendar_entries` | `sync_status` |
| `calendar_sync_preferences_user_id_idx` | `calendar_sync_preferences` | `user_id` |
| `calendar_sync_preferences_org_id_idx` | `calendar_sync_preferences` | `organization_id` |

### Subscription Indexes

| Index | Table | Columns | Notes |
|-------|-------|---------|-------|
| `idx_org_subscriptions_grace_period` | `organization_subscriptions` | `grace_period_ends_at` | Partial: WHERE grace_period_ends_at IS NOT NULL |

### Push Notification Indexes

| Index | Table | Columns |
|-------|-------|---------|
| `user_push_tokens_user_id_idx` | `user_push_tokens` | `user_id` |
| `user_push_tokens_token_idx` | `user_push_tokens` | `expo_push_token` |

### Other Indexes

| Index | Table | Columns |
|-------|-------|---------|
| `members_user_id_idx` | `members` | `user_id` |
| `alumni_user_id_idx` | `alumni` | `user_id` |
| `users_email_idx` | `users` | `email` |
| `user_org_roles_org_idx` | `user_organization_roles` | `organization_id` |
| `user_org_roles_user_idx` | `user_organization_roles` | `user_id` |
| `user_org_roles_active_idx` | `user_organization_roles` | `(organization_id, user_id, status)` |

---

## Realtime

Tables added to the `supabase_realtime` publication with REPLICA IDENTITY FULL:

- `events`
- `announcements`
- `alumni`
- `user_organization_roles`
- `organizations`
- `chat_messages`

---

## Storage Buckets

| Bucket | Access | Size Limit | Allowed Types |
|--------|--------|------------|---------------|
| `org-branding` | Public read | 5 MB | image/png, image/jpeg, image/jpg, image/webp, image/gif |

---

## Extensions

| Extension | Purpose |
|-----------|---------|
| `pgcrypto` | `gen_random_bytes()` for secure invite code generation |

---

## Critical Issue Status

Issues identified in the original December 2025 audit and their resolution status:

| # | Issue | Status | Resolution |
|---|-------|--------|------------|
| 1 | Missing `public.users` sync trigger | **Resolved** | `handle_new_user()` trigger added in `20251217100000_schema_fixes.sql`, fires on auth.users INSERT and UPDATE |
| 2 | Invite codes generated client-side | **Resolved** | `create_org_invite()` RPC generates secure codes server-side with `gen_random_bytes()` |
| 3 | Invite redemption via direct insert | **Resolved** | `redeem_org_invite()` SECURITY DEFINER RPC handles validation and membership creation |
| 4 | Announcement email notifications are stubs | **Outstanding** | `sendEmail()` in `src/lib/notifications.ts` still logs only; Resend API integration needed |
| 5 | Missing `is_org_member` / `is_org_admin` helpers | **Resolved** | Both functions created in `20251217100000_schema_fixes.sql` |

### Additional Security Improvements (Post-Audit)

- All SECURITY DEFINER functions hardened with `SET search_path = ''` (`20260107120000`), except `handle_org_member_sync()` added later in `20260412093000`
- RLS policies use `(select auth.uid())` initplan pattern for performance (`20260421130000`)
- Unused tables dropped: `class_action_docs`, `class_action_personas`, `class_actions`, `leads` (`20260107120000`)
- Event check-in protected by `protect_checkin_columns()` trigger preventing non-admin self-check-in (`20260124100000`)
- Cross-org check-in bypass prevented by `protect_rsvp_org_id()` trigger and authoritative event org lookup (`20260124110000`)
- Alumni quota enforcement in invite creation and member sync (`20260412093000`)
- Chat function permissions fixed with proper GRANT statements (`20260421140000`)
- Alumni self-edit column protection: `protect_alumni_self_edit()` trigger prevents self-editors from changing `organization_id`, `user_id`, or `deleted_at` (`20260127120000`)

---

## Migration Timeline

| Migration | Date | Description |
|-----------|------|-------------|
| `20251208120000` | Dec 2025 | Stripe subscription table, soft delete columns on 9 tables |
| `20251211090000` | Dec 2025 | RBAC enum expansion (active_member/alumni), mentorship, workouts, competitions |
| `20251214000000` | Dec 2025 | Alumni extended fields, philanthropy embeds, invite token/revoke columns |
| `20251215000000` | Dec 2025 | Embed indexes, updated_at trigger function, pending membership status |
| `20251216000000` | Dec 2025 | Announcement audience overhaul, donation embeds table, `can_view_announcement()` |
| `20251217000000` | Dec 2025 | Organization invites table |
| `20251217100000` | Dec 2025 | Major schema fixes: users sync trigger, helper functions, invite RPCs, comprehensive RLS/indexes |
| `20251222215000` | Dec 2025 | Enable pgcrypto extension |
| `20251222215500` | Dec 2025 | Fix invite role check constraint (allow admin/active_member/alumni) |
| `20251222220000` | Dec 2025 | Rewrite `redeem_org_invite()` with enhanced validation |
| `20251222220500` | Dec 2025 | Add pending status to membership_status enum |
| `20251222221500` | Dec 2025 | Member sync trigger: `user_organization_roles` -> `members`/`alumni` |
| `20251222223000` | Dec 2025 | Auto-approve invite redemptions (skip pending), backfill existing pending |
| `20251222232000` | Dec 2025 | Consolidated member schema and sync repair |
| `20251222235000` | Dec 2025 | Ensure `org_donation_embeds` table exists with backfill |
| `20251222235500` | Dec 2025 | Add `nav_config` jsonb to organizations |
| `20260101000000` | Jan 2026 | Mentorship self-service permissions (mentor/mentee can manage own pairs) |
| `20260102010000` | Jan 2026 | `can_edit_page()` function, role-based page editing RLS for donations/philanthropy |
| `20260102020000` | Jan 2026 | Members/alumni self-edit profile RLS policies |
| `20260105090000` | Jan 2026 | Stripe donations refactor: `organization_donations`, `organization_donation_stats`, `increment_donation_stats()` |
| `20260107100000` | Jan 2026 | Event RSVPs table with attending/not_attending/maybe statuses |
| `20260107120000` | Jan 2026 | Security lint: drop unused tables, fix search_path on all functions, alumni quota functions |
| `20260108000000` | Jan 2026 | Academic schedules table |
| `20260108010000` | Jan 2026 | Schedule files table |
| `20260108020000` | Jan 2026 | Forms and form submissions tables |
| `20260108030000` | Jan 2026 | Form documents and document submissions tables |
| `20260112200000` | Jan 2026 | Group chat: chat_groups, chat_group_members, chat_messages with approval workflow |
| `20260114100000` | Jan 2026 | Update alumni bucket tiers to new pricing (0-250, 251-500, etc.) |
| `20260114120000` | Jan 2026 | Enable Supabase Realtime for mobile tables |
| `20260123100000` | Jan 2026 | Event check-in columns on event_rsvps |
| `20260124100000` | Jan 2026 | Check-in RLS: `check_in_event_attendee()` RPC, `protect_checkin_columns()` trigger |
| `20260124110000` | Jan 2026 | Cross-org check-in fix: `protect_rsvp_org_id()`, authoritative event org lookup |
| `20260127120000` | Jan 2026 | Alumni editRoles: replace `is_org_admin()` with `can_edit_page('/alumni')` for INSERT/UPDATE/DELETE policies + self-edit column protection trigger |
| `20260410120000` | Apr 2026 | Payment idempotency: `payment_attempts`, `stripe_events` tables |
| `20260412093000` | Apr 2026 | Alumni quota enforcement in invite creation and member sync |
| `20260415120000` | Apr 2026 | Org branding: `secondary_color` column, `org-branding` storage bucket |
| `20260416100000` | Apr 2026 | Academic schedule multi-day support (`day_of_week` -> smallint array) |
| `20260416120000` | Apr 2026 | Fix `gen_random_bytes` wrapper in public schema for invite code generation |
| `20260420100000` | Apr 2026 | Subscription grace period: `grace_period_ends_at` column + partial index |
| `20260420110000` | Apr 2026 | Fix `gen_random_bytes` search_path security |
| `20260420120000` | Apr 2026 | Google Calendar sync: connections, entries, preferences tables |
| `20260421130000` | Apr 2026 | Performance/security lint: initplan pattern, index cleanup, RLS policy consolidation |
| `20260421140000` | Apr 2026 | Fix chat function permissions: GRANT EXECUTE, recreate with SECURITY DEFINER |
| `20260422100000` | Apr 2026 | Fix chat group visibility: COALESCE in membership checks, refined SELECT policies |
| `20260425100000` | Apr 2026 | Push notifications: `user_push_tokens` table, `push_enabled` on notification_preferences |
