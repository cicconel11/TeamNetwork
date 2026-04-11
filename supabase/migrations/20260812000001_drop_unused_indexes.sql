-- Migration: Drop unused indexes with 0 scans
-- These non-unique indexes have never been read and only slow writes / waste storage.
-- Uses DROP INDEX IF EXISTS (not CONCURRENTLY) for Supabase migration compatibility.
-- Unique/constraint indexes are intentionally preserved.

-- ============================================================
-- dev_admin_audit_logs (4 indexes)
-- ============================================================
DROP INDEX IF EXISTS dev_admin_audit_logs_created_at_idx;
DROP INDEX IF EXISTS dev_admin_audit_logs_action_idx;
DROP INDEX IF EXISTS dev_admin_audit_logs_admin_user_idx;
DROP INDEX IF EXISTS dev_admin_audit_logs_target_id_idx;

-- ============================================================
-- alumni single-column (superseded by composite alumni_enterprise_filter_idx)
-- ============================================================
DROP INDEX IF EXISTS alumni_graduation_year_idx;
DROP INDEX IF EXISTS alumni_industry_idx;
DROP INDEX IF EXISTS alumni_current_company_idx;
DROP INDEX IF EXISTS alumni_current_city_idx;
DROP INDEX IF EXISTS alumni_position_title_idx;
DROP INDEX IF EXISTS idx_alumni_enrichment_pending;
DROP INDEX IF EXISTS idx_alumni_org_lower_email;

-- ============================================================
-- alumni_external_ids
-- ============================================================
DROP INDEX IF EXISTS idx_alumni_external_ids_alumni;

-- ============================================================
-- media_items (4 indexes)
-- ============================================================
DROP INDEX IF EXISTS idx_media_items_listing;
DROP INDEX IF EXISTS idx_media_items_user_uploads;
DROP INDEX IF EXISTS idx_media_items_moderated_by;
DROP INDEX IF EXISTS idx_media_items_tags;

-- ============================================================
-- media_albums (1 index)
-- ============================================================
DROP INDEX IF EXISTS idx_media_albums_cover_media_id;
-- KEPT: idx_media_albums_org_sort — used by src/app/api/media/albums/route.ts:65
--   (organization_id + deleted_at IS NULL + ORDER BY sort_order, created_at)
-- KEPT: idx_media_albums_draft_cleanup — used by src/app/api/cron/media-cleanup/route.ts:67
--   (is_upload_draft + item_count + deleted_at IS NULL + created_at < cutoff)

-- ============================================================
-- media_uploads
-- ============================================================
-- KEPT: idx_media_uploads_pending_cleanup — used by src/app/api/cron/media-cleanup/route.ts:29
--   (status='pending' + deleted_at IS NULL + created_at < cutoff)

-- ============================================================
-- error tracking (5 indexes)
-- ============================================================
DROP INDEX IF EXISTS idx_error_groups_env_last_seen;
DROP INDEX IF EXISTS idx_error_groups_status_last_seen;
DROP INDEX IF EXISTS idx_error_events_group_created;
DROP INDEX IF EXISTS idx_error_events_created_at;
DROP INDEX IF EXISTS idx_error_events_user_id;

-- ============================================================
-- feed tables (5 indexes)
-- ============================================================
DROP INDEX IF EXISTS idx_feed_posts_author_id;
DROP INDEX IF EXISTS idx_feed_comments_author_id;
DROP INDEX IF EXISTS idx_feed_comments_org_id;
DROP INDEX IF EXISTS idx_feed_likes_org_id;
DROP INDEX IF EXISTS idx_feed_likes_post;

-- ============================================================
-- discussion tables (3 indexes)
-- ============================================================
DROP INDEX IF EXISTS idx_discussion_replies_org_id;
DROP INDEX IF EXISTS idx_discussion_replies_thread;
DROP INDEX IF EXISTS discussion_replies_author_idx;
DROP INDEX IF EXISTS idx_discussion_threads_listing;

-- ============================================================
-- analytics (3 indexes)
-- ============================================================
DROP INDEX IF EXISTS idx_analytics_events_session;
DROP INDEX IF EXISTS idx_ops_events_created_brin;
DROP INDEX IF EXISTS idx_analytics_ops_events_name_day;

-- ============================================================
-- enterprise (9 indexes)
-- ============================================================
DROP INDEX IF EXISTS enterprise_invites_token_idx;
DROP INDEX IF EXISTS enterprise_invites_code_idx;
DROP INDEX IF EXISTS enterprise_subscriptions_pricing_model_idx;
DROP INDEX IF EXISTS enterprise_audit_logs_enterprise_created_idx;
DROP INDEX IF EXISTS enterprise_audit_logs_action_created_idx;
DROP INDEX IF EXISTS enterprise_audit_logs_actor_created_idx;
DROP INDEX IF EXISTS enterprise_adoption_requests_status_idx;
DROP INDEX IF EXISTS user_enterprise_roles_user_idx;
DROP INDEX IF EXISTS user_enterprise_roles_enterprise_idx;

-- ============================================================
-- payments/donations (6 indexes)
-- ============================================================
DROP INDEX IF EXISTS organization_donations_org_idx;
DROP INDEX IF EXISTS organization_donations_pi_idx;
DROP INDEX IF EXISTS idx_org_donations_event_id;
DROP INDEX IF EXISTS idx_payment_attempts_user_id;
DROP INDEX IF EXISTS payment_attempts_user_trial_lookup_idx;
DROP INDEX IF EXISTS org_donation_embeds_org_idx;

-- ============================================================
-- AI tables (6 indexes, preserving HNSW vector index)
-- ============================================================
DROP INDEX IF EXISTS idx_ai_messages_org_id;
DROP INDEX IF EXISTS idx_ai_audit_log_expires;
DROP INDEX IF EXISTS idx_ai_chunks_org_source;
DROP INDEX IF EXISTS idx_ai_pending_actions_thread_pending;
DROP INDEX IF EXISTS idx_ai_draft_sessions_expires;
DROP INDEX IF EXISTS idx_ai_semantic_cache_invalidated_at;

-- ============================================================
-- chat
-- ============================================================
DROP INDEX IF EXISTS chat_messages_author_idx;
DROP INDEX IF EXISTS idx_chat_messages_group_type;

-- ============================================================
-- calendar
-- ============================================================
DROP INDEX IF EXISTS calendar_feeds_connected_user_idx;
DROP INDEX IF EXISTS calendar_feeds_org_scope_idx;
DROP INDEX IF EXISTS user_calendar_connections_status_idx;

-- ============================================================
-- schedules
-- ============================================================
DROP INDEX IF EXISTS idx_academic_schedules_org_user;
DROP INDEX IF EXISTS idx_schedule_files_org;

-- ============================================================
-- compliance/oauth
-- ============================================================
DROP INDEX IF EXISTS idx_compliance_audit_ip_time;
DROP INDEX IF EXISTS idx_compliance_audit_event_type;
DROP INDEX IF EXISTS idx_oauth_state_cleanup;

-- ============================================================
-- organization invites / announcements / notifications
-- ============================================================
DROP INDEX IF EXISTS idx_organization_invites_created_by_user_id;
DROP INDEX IF EXISTS idx_announcements_created_by_user_id;
DROP INDEX IF EXISTS idx_notifications_created_at;

-- ============================================================
-- members / subscriptions
-- ============================================================
DROP INDEX IF EXISTS idx_members_graduation_pending;
DROP INDEX IF EXISTS idx_org_subscriptions_grace_period;

-- ============================================================
-- expenses
-- ============================================================
DROP INDEX IF EXISTS idx_expenses_org_deleted;
DROP INDEX IF EXISTS idx_expenses_user;

-- ============================================================
-- event_rsvps
-- ============================================================
DROP INDEX IF EXISTS event_rsvps_org_id_idx;
DROP INDEX IF EXISTS event_rsvps_checked_in_idx;

-- ============================================================
-- forms
-- ============================================================
DROP INDEX IF EXISTS idx_form_submissions_not_deleted;
DROP INDEX IF EXISTS idx_form_document_submissions_not_deleted;

-- ============================================================
-- parents
-- ============================================================
DROP INDEX IF EXISTS parents_org_idx;
DROP INDEX IF EXISTS parents_student_name_idx;
DROP INDEX IF EXISTS parents_relationship_idx;
DROP INDEX IF EXISTS parents_org_relationship_idx;
DROP INDEX IF EXISTS parent_invites_org_email_status_idx;

-- ============================================================
-- user deletion requests
-- ============================================================
DROP INDEX IF EXISTS idx_user_deletion_requests_user_id;
DROP INDEX IF EXISTS idx_user_deletion_requests_pending;

-- ============================================================
-- usage events
-- ============================================================
DROP INDEX IF EXISTS idx_usage_events_type_created;

-- ============================================================
-- linkedin
-- ============================================================
DROP INDEX IF EXISTS user_linkedin_connections_status_idx;
DROP INDEX IF EXISTS linkedin_manual_sync_attempts_user_month_idx;
