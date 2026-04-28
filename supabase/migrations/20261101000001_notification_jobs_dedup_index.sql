-- =====================================================
-- Migration: notification_jobs dedup index for reminder crons
-- =====================================================
-- The event-reminders cron runs every 5 minutes with overlapping 10-min
-- windows; without dedup, the same (event, user, reminder_window) row would
-- be inserted twice. This unique partial index lets the cron use
-- `INSERT ... ON CONFLICT DO NOTHING` for idempotency.
--
-- Scoped to recent rows (6h) so old jobs don't bloat the index. Reminders
-- happen in 1h / 24h windows, both of which fall well inside the 6h scope
-- when the cron is running every 5 min.

CREATE UNIQUE INDEX IF NOT EXISTS notification_jobs_reminder_dedup_idx
  ON public.notification_jobs (
    push_type,
    push_resource_id,
    (data ->> 'reminder_window')
  )
  WHERE
    push_type IS NOT NULL
    AND push_resource_id IS NOT NULL
    AND (data ->> 'reminder_window') IS NOT NULL
    AND created_at > now() - interval '6 hours';
