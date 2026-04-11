-- Prevent concurrent syncs for the same integration by enforcing
-- a unique partial index on running sync log entries.
--
-- Existing environments may already contain duplicate running rows from the
-- old race condition. Keep the newest running row per integration and mark
-- older duplicates failed before adding the unique index.
LOCK TABLE public.integration_sync_log IN ACCESS EXCLUSIVE MODE;

WITH ranked_running_logs AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY integration_id
      ORDER BY started_at DESC, id DESC
    ) AS running_rank
  FROM public.integration_sync_log
  WHERE status = 'running'
),
duplicate_running_logs AS (
  SELECT id
  FROM ranked_running_logs
  WHERE running_rank > 1
)
UPDATE public.integration_sync_log AS log
SET
  status = 'failed',
  error_message = COALESCE(
    log.error_message,
    'Marked failed during migration cleanup before adding running sync uniqueness'
  ),
  completed_at = COALESCE(log.completed_at, now())
FROM duplicate_running_logs
WHERE log.id = duplicate_running_logs.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_log_running_unique
  ON public.integration_sync_log (integration_id)
  WHERE status = 'running';
