-- Migration: Add covering indexes for 81 unindexed foreign keys
--
-- The Supabase performance advisor (lint unindexed_foreign_keys) flagged 81 FK
-- constraints with no covering index. Several were lost in
-- 20260812000001_drop_unused_indexes.sql, which dropped 0-scan indexes that
-- happened to cover these FKs. Uncovered FKs force sequential scans on the
-- referencing table during FK-keyed lookups and ON DELETE/UPDATE CASCADE.
--
-- Plain CREATE INDEX (NOT CONCURRENTLY): Supabase migrations run inside a
-- transaction and CONCURRENTLY cannot (breaks `supabase db reset` on PG15.6+).
-- All affected tables are small (largest ~20k rows, most <500), so the brief
-- SHARE lock per index is milliseconds. Same rationale as 20260812000003 (Part 2)
-- and 20261026000000. All IF NOT EXISTS (idempotent). Additive + reversible.
--
-- Column names verified against live DB (constraint conkey -> pg_attribute):
--   media_items: advisor names reviewed_by_fkey, real column is moderated_by.
--   ai_pending_actions: column is organization_id (FK named ..._org_id_fkey).
--   ai_messages: composite FK (thread_id, user_id, org_id).
--   schedule_allowed_domains: verified_by_org_id, verified_by_user_id.

-- ai_audit_log
CREATE INDEX IF NOT EXISTS idx_ai_audit_log_message_id ON public.ai_audit_log (message_id);
CREATE INDEX IF NOT EXISTS idx_ai_audit_log_thread_id ON public.ai_audit_log (thread_id);

-- ai_draft_sessions
CREATE INDEX IF NOT EXISTS idx_ai_draft_sessions_organization_id ON public.ai_draft_sessions (organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_draft_sessions_pending_action_id ON public.ai_draft_sessions (pending_action_id);
CREATE INDEX IF NOT EXISTS idx_ai_draft_sessions_user_id ON public.ai_draft_sessions (user_id);

-- ai_feedback
CREATE INDEX IF NOT EXISTS idx_ai_feedback_user_id ON public.ai_feedback (user_id);

-- ai_indexing_exclusions
CREATE INDEX IF NOT EXISTS idx_ai_indexing_exclusions_excluded_by ON public.ai_indexing_exclusions (excluded_by);

-- ai_messages — COMPOSITE FK (thread_id, user_id, org_id) REFERENCES ai_threads(id, user_id, org_id)
CREATE INDEX IF NOT EXISTS idx_ai_messages_thread_owner ON public.ai_messages (thread_id, user_id, org_id);

-- ai_pending_actions  (column is organization_id, not org_id)
CREATE INDEX IF NOT EXISTS idx_ai_pending_actions_organization_id ON public.ai_pending_actions (organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_pending_actions_user_id ON public.ai_pending_actions (user_id);

-- ai_semantic_cache
CREATE INDEX IF NOT EXISTS idx_ai_semantic_cache_source_message_id ON public.ai_semantic_cache (source_message_id);

-- alumni_external_ids
CREATE INDEX IF NOT EXISTS idx_alumni_external_ids_alumni_id ON public.alumni_external_ids (alumni_id);

-- announcements
CREATE INDEX IF NOT EXISTS idx_announcements_created_by_user_id ON public.announcements (created_by_user_id);

-- calendar_feeds
CREATE INDEX IF NOT EXISTS idx_calendar_feeds_connected_user_id ON public.calendar_feeds (connected_user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_feeds_organization_id ON public.calendar_feeds (organization_id);

-- chat_form_responses
CREATE INDEX IF NOT EXISTS idx_chat_form_responses_organization_id ON public.chat_form_responses (organization_id);
CREATE INDEX IF NOT EXISTS idx_chat_form_responses_user_id ON public.chat_form_responses (user_id);

-- chat_group_members
CREATE INDEX IF NOT EXISTS idx_chat_group_members_added_by ON public.chat_group_members (added_by);

-- chat_groups
CREATE INDEX IF NOT EXISTS idx_chat_groups_created_by ON public.chat_groups (created_by);

-- chat_messages
CREATE INDEX IF NOT EXISTS idx_chat_messages_approved_by ON public.chat_messages (approved_by);
CREATE INDEX IF NOT EXISTS idx_chat_messages_author_id ON public.chat_messages (author_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_rejected_by ON public.chat_messages (rejected_by);

-- chat_poll_votes
CREATE INDEX IF NOT EXISTS idx_chat_poll_votes_organization_id ON public.chat_poll_votes (organization_id);
CREATE INDEX IF NOT EXISTS idx_chat_poll_votes_user_id ON public.chat_poll_votes (user_id);

-- content_reports
CREATE INDEX IF NOT EXISTS idx_content_reports_reviewed_by ON public.content_reports (reviewed_by);

-- dev_admin_audit_logs
CREATE INDEX IF NOT EXISTS idx_dev_admin_audit_logs_admin_user_id ON public.dev_admin_audit_logs (admin_user_id);

-- discussion_replies
CREATE INDEX IF NOT EXISTS idx_discussion_replies_author_id ON public.discussion_replies (author_id);
CREATE INDEX IF NOT EXISTS idx_discussion_replies_organization_id ON public.discussion_replies (organization_id);

-- dsr_requests
CREATE INDEX IF NOT EXISTS idx_dsr_requests_linked_access_log_id ON public.dsr_requests (linked_access_log_id);
CREATE INDEX IF NOT EXISTS idx_dsr_requests_linked_deletion_request_id ON public.dsr_requests (linked_deletion_request_id);
CREATE INDEX IF NOT EXISTS idx_dsr_requests_school_owner_user_id ON public.dsr_requests (school_owner_user_id);

-- enterprise_adoption_requests
CREATE INDEX IF NOT EXISTS idx_enterprise_adoption_requests_requested_by ON public.enterprise_adoption_requests (requested_by);
CREATE INDEX IF NOT EXISTS idx_enterprise_adoption_requests_responded_by ON public.enterprise_adoption_requests (responded_by);

-- enterprise_audit_logs
CREATE INDEX IF NOT EXISTS idx_enterprise_audit_logs_actor_user_id ON public.enterprise_audit_logs (actor_user_id);

-- enterprise_deletion_requests
CREATE INDEX IF NOT EXISTS idx_enterprise_deletion_requests_requested_by ON public.enterprise_deletion_requests (requested_by);

-- enterprise_invites
CREATE INDEX IF NOT EXISTS idx_enterprise_invites_created_by_user_id ON public.enterprise_invites (created_by_user_id);

-- error_events
CREATE INDEX IF NOT EXISTS idx_error_events_group_id ON public.error_events (group_id);

-- event_rsvps  (FK columns checked_in_by + organization_id; other event_rsvps indexes already exist)
CREATE INDEX IF NOT EXISTS idx_event_rsvps_checked_in_by ON public.event_rsvps (checked_in_by);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_organization_id ON public.event_rsvps (organization_id);

-- expenses
CREATE INDEX IF NOT EXISTS idx_expenses_user_id ON public.expenses (user_id);

-- feed_comments
CREATE INDEX IF NOT EXISTS idx_feed_comments_author_id ON public.feed_comments (author_id);
CREATE INDEX IF NOT EXISTS idx_feed_comments_organization_id ON public.feed_comments (organization_id);

-- feed_likes
CREATE INDEX IF NOT EXISTS idx_feed_likes_organization_id ON public.feed_likes (organization_id);

-- feed_poll_votes
CREATE INDEX IF NOT EXISTS idx_feed_poll_votes_organization_id ON public.feed_poll_votes (organization_id);
CREATE INDEX IF NOT EXISTS idx_feed_poll_votes_user_id ON public.feed_poll_votes (user_id);

-- feed_posts
CREATE INDEX IF NOT EXISTS idx_feed_posts_author_id ON public.feed_posts (author_id);

-- form_document_submissions
CREATE INDEX IF NOT EXISTS idx_form_document_submissions_organization_id ON public.form_document_submissions (organization_id);

-- form_documents
CREATE INDEX IF NOT EXISTS idx_form_documents_created_by ON public.form_documents (created_by);

-- forms
CREATE INDEX IF NOT EXISTS idx_forms_created_by ON public.forms (created_by);

-- live_activity_tokens
CREATE INDEX IF NOT EXISTS idx_live_activity_tokens_organization_id ON public.live_activity_tokens (organization_id);

-- media_albums
CREATE INDEX IF NOT EXISTS idx_media_albums_cover_media_id ON public.media_albums (cover_media_id);

-- media_items  (advisor names reviewed_by_fkey; real column is moderated_by)
CREATE INDEX IF NOT EXISTS idx_media_items_moderated_by ON public.media_items (moderated_by);

-- mentee_preferences
CREATE INDEX IF NOT EXISTS idx_mentee_preferences_user_id ON public.mentee_preferences (user_id);

-- mentor_bio_backfill_queue
CREATE INDEX IF NOT EXISTS idx_mentor_bio_backfill_queue_mentor_profile_id ON public.mentor_bio_backfill_queue (mentor_profile_id);

-- mentorship_audit_log
CREATE INDEX IF NOT EXISTS idx_mentorship_audit_log_actor_user_id ON public.mentorship_audit_log (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_mentorship_audit_log_pair_id ON public.mentorship_audit_log (pair_id);

-- mentorship_meetings
CREATE INDEX IF NOT EXISTS idx_mentorship_meetings_created_by ON public.mentorship_meetings (created_by);
CREATE INDEX IF NOT EXISTS idx_mentorship_meetings_organization_id ON public.mentorship_meetings (organization_id);

-- mentorship_pairs
CREATE INDEX IF NOT EXISTS idx_mentorship_pairs_proposed_by ON public.mentorship_pairs (proposed_by);

-- mentorship_reminders
CREATE INDEX IF NOT EXISTS idx_mentorship_reminders_mentor_user_id ON public.mentorship_reminders (mentor_user_id);
CREATE INDEX IF NOT EXISTS idx_mentorship_reminders_sent_by ON public.mentorship_reminders (sent_by);

-- mentorship_tasks
CREATE INDEX IF NOT EXISTS idx_mentorship_tasks_created_by ON public.mentorship_tasks (created_by);
CREATE INDEX IF NOT EXISTS idx_mentorship_tasks_organization_id ON public.mentorship_tasks (organization_id);

-- mobile_auth_handoffs
CREATE INDEX IF NOT EXISTS idx_mobile_auth_handoffs_user_id ON public.mobile_auth_handoffs (user_id);

-- org_integration_oauth_state
CREATE INDEX IF NOT EXISTS idx_org_integration_oauth_state_organization_id ON public.org_integration_oauth_state (organization_id);
CREATE INDEX IF NOT EXISTS idx_org_integration_oauth_state_user_id ON public.org_integration_oauth_state (user_id);

-- org_integrations
CREATE INDEX IF NOT EXISTS idx_org_integrations_connected_by ON public.org_integrations (connected_by);

-- org_member_role_audit
CREATE INDEX IF NOT EXISTS idx_org_member_role_audit_actor_user_id ON public.org_member_role_audit (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_org_member_role_audit_target_user_id ON public.org_member_role_audit (target_user_id);

-- organization_donations
CREATE INDEX IF NOT EXISTS idx_organization_donations_event_id ON public.organization_donations (event_id);

-- organization_invites
CREATE INDEX IF NOT EXISTS idx_organization_invites_created_by_user_id ON public.organization_invites (created_by_user_id);

-- parent_invites
CREATE INDEX IF NOT EXISTS idx_parent_invites_invited_by ON public.parent_invites (invited_by);

-- schedule_allowed_domains
CREATE INDEX IF NOT EXISTS idx_schedule_allowed_domains_verified_by_org_id ON public.schedule_allowed_domains (verified_by_org_id);
CREATE INDEX IF NOT EXISTS idx_schedule_allowed_domains_verified_by_user_id ON public.schedule_allowed_domains (verified_by_user_id);

-- schedule_files
CREATE INDEX IF NOT EXISTS idx_schedule_files_user_id ON public.schedule_files (user_id);

-- schedule_sources
CREATE INDEX IF NOT EXISTS idx_schedule_sources_connected_user_id ON public.schedule_sources (connected_user_id);
CREATE INDEX IF NOT EXISTS idx_schedule_sources_created_by ON public.schedule_sources (created_by);

-- ui_profiles
CREATE INDEX IF NOT EXISTS idx_ui_profiles_organization_id ON public.ui_profiles (organization_id);

-- usage_summaries
CREATE INDEX IF NOT EXISTS idx_usage_summaries_organization_id ON public.usage_summaries (organization_id);

-- user_enterprise_roles
CREATE INDEX IF NOT EXISTS idx_user_enterprise_roles_enterprise_id ON public.user_enterprise_roles (enterprise_id);

-- user_onboarding_progress
CREATE INDEX IF NOT EXISTS idx_user_onboarding_progress_organization_id ON public.user_onboarding_progress (organization_id);
