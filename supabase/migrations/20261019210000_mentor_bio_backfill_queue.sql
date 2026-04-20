-- Async queue for mentor bio regeneration/backfill.
-- Existing mentor profiles can be reprocessed without blocking admin requests.

CREATE TABLE public.mentor_bio_backfill_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mentor_profile_id uuid NOT NULL REFERENCES public.mentor_profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text,
  attempts smallint NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.mentor_bio_backfill_queue IS
  'Async queue for regenerating mentor bios after metadata changes or admin backfill requests.';

CREATE INDEX idx_mentor_bio_backfill_queue_pending
  ON public.mentor_bio_backfill_queue(created_at)
  WHERE processed_at IS NULL AND attempts < 3;

CREATE UNIQUE INDEX idx_mentor_bio_backfill_queue_pending_dedupe
  ON public.mentor_bio_backfill_queue(organization_id, mentor_profile_id)
  WHERE processed_at IS NULL;

ALTER TABLE public.mentor_bio_backfill_queue ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.backfill_mentor_bio_queue(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  queued_count integer;
BEGIN
  WITH inserted AS (
    INSERT INTO public.mentor_bio_backfill_queue(organization_id, mentor_profile_id)
    SELECT mp.organization_id, mp.id
    FROM public.mentor_profiles mp
    WHERE mp.organization_id = p_org_id
      AND mp.bio_source IS DISTINCT FROM 'manual'
      AND (
        COALESCE(mp.bio, '') = ''
        OR mp.bio_generated_at IS NULL
        OR mp.bio_input_hash IS NULL
        OR mp.bio_source = 'ai_generated'
      )
    ON CONFLICT DO NOTHING
    RETURNING id
  )
  SELECT count(*) INTO queued_count FROM inserted;

  RETURN jsonb_build_object('enqueued', queued_count);
END;
$$;

COMMENT ON FUNCTION public.backfill_mentor_bio_queue(uuid) IS
  'Enqueue existing mentor profiles for AI bio regeneration/backfill.';

REVOKE EXECUTE ON FUNCTION public.backfill_mentor_bio_queue(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.backfill_mentor_bio_queue(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.backfill_mentor_bio_queue(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_mentor_bio_queue(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.dequeue_mentor_bio_backfill_queue(p_batch_size int DEFAULT 25)
RETURNS SETOF public.mentor_bio_backfill_queue
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.mentor_bio_backfill_queue
  SET processed_at = now(),
      updated_at = now()
  WHERE id IN (
    SELECT id
    FROM public.mentor_bio_backfill_queue
    WHERE processed_at IS NULL
      AND attempts < 3
    ORDER BY created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

COMMENT ON FUNCTION public.dequeue_mentor_bio_backfill_queue(int) IS
  'Atomically dequeue mentor bio backfill rows with row-level locking.';

REVOKE EXECUTE ON FUNCTION public.dequeue_mentor_bio_backfill_queue(int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dequeue_mentor_bio_backfill_queue(int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.dequeue_mentor_bio_backfill_queue(int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.dequeue_mentor_bio_backfill_queue(int) TO service_role;

CREATE OR REPLACE FUNCTION public.increment_mentor_bio_backfill_attempts(
  p_id uuid,
  p_error text
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.mentor_bio_backfill_queue
  SET attempts = attempts + 1,
      error = left(p_error, 500),
      processed_at = NULL,
      updated_at = now()
  WHERE id = p_id;
$$;

COMMENT ON FUNCTION public.increment_mentor_bio_backfill_attempts(uuid, text) IS
  'Increment mentor bio backfill attempts and re-enqueue the row for retry.';

REVOKE EXECUTE ON FUNCTION public.increment_mentor_bio_backfill_attempts(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_mentor_bio_backfill_attempts(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_mentor_bio_backfill_attempts(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_mentor_bio_backfill_attempts(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.purge_mentor_bio_backfill_queue()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH doomed AS (
    SELECT id
    FROM public.mentor_bio_backfill_queue
    WHERE created_at < now() - interval '7 days'
      AND (processed_at IS NOT NULL OR attempts >= 3)
    ORDER BY created_at
    LIMIT 1000
  )
  DELETE FROM public.mentor_bio_backfill_queue
  WHERE id IN (SELECT id FROM doomed);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION public.purge_mentor_bio_backfill_queue() IS
  'Purge processed and dead-letter mentor bio backfill rows older than 7 days.';

REVOKE EXECUTE ON FUNCTION public.purge_mentor_bio_backfill_queue() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purge_mentor_bio_backfill_queue() FROM anon;
REVOKE EXECUTE ON FUNCTION public.purge_mentor_bio_backfill_queue() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_mentor_bio_backfill_queue() TO service_role;
