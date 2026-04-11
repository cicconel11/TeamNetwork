-- FalkorDB people graph foundation
-- Adds an async sync queue for member/alumni/mentorship graph projection,
-- queue RPCs, and a recursive mentorship-distance RPC for SQL fallback parity.

-- =============================================================================
-- 1. Queue table
-- =============================================================================

CREATE TABLE public.graph_sync_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_table    text NOT NULL
                  CHECK (source_table IN ('members', 'alumni', 'mentorship_pairs')),
  source_id       uuid NOT NULL,
  action          text NOT NULL CHECK (action IN ('upsert', 'delete')),
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  error           text,
  attempts        smallint NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.graph_sync_queue IS 'Async queue for Falkor people-graph sync work';
COMMENT ON COLUMN public.graph_sync_queue.action IS 'upsert = merge graph state, delete = remove graph state if no active sources remain';
COMMENT ON COLUMN public.graph_sync_queue.payload IS 'Trigger-side context such as prior user_id or prior org_id for re-keyed rows';

CREATE INDEX idx_graph_sync_queue_pending
  ON public.graph_sync_queue(created_at)
  WHERE processed_at IS NULL AND attempts < 3;

ALTER TABLE public.graph_sync_queue ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 2. Trigger functions
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enqueue_graph_sync_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_action text;
  v_payload jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id)
       AND (NEW.user_id IS NOT DISTINCT FROM OLD.user_id)
       AND (NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at)
       AND (NEW.status IS NOT DISTINCT FROM OLD.status)
       AND (NEW.first_name IS NOT DISTINCT FROM OLD.first_name)
       AND (NEW.last_name IS NOT DISTINCT FROM OLD.last_name)
       AND (NEW.email IS NOT DISTINCT FROM OLD.email)
       AND (NEW.role IS NOT DISTINCT FROM OLD.role)
       AND (NEW.current_company IS NOT DISTINCT FROM OLD.current_company)
       AND (NEW.graduation_year IS NOT DISTINCT FROM OLD.graduation_year)
    THEN
      RETURN NEW;
    END IF;

    v_payload := jsonb_build_object(
      'old_user_id', OLD.user_id,
      'old_organization_id', OLD.organization_id
    );
  END IF;

  IF NEW.deleted_at IS NOT NULL OR NEW.status IS DISTINCT FROM 'active' THEN
    v_action := 'delete';
  ELSE
    v_action := 'upsert';
  END IF;

  INSERT INTO public.graph_sync_queue(org_id, source_table, source_id, action, payload)
  VALUES (NEW.organization_id, 'members', NEW.id, v_action, v_payload);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_graph_sync_member() IS 'Trigger function for member -> graph queue sync';

CREATE OR REPLACE FUNCTION public.enqueue_graph_sync_alumni()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_action text;
  v_payload jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id)
       AND (NEW.user_id IS NOT DISTINCT FROM OLD.user_id)
       AND (NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at)
       AND (NEW.first_name IS NOT DISTINCT FROM OLD.first_name)
       AND (NEW.last_name IS NOT DISTINCT FROM OLD.last_name)
       AND (NEW.email IS NOT DISTINCT FROM OLD.email)
       AND (NEW.major IS NOT DISTINCT FROM OLD.major)
       AND (NEW.current_company IS NOT DISTINCT FROM OLD.current_company)
       AND (NEW.industry IS NOT DISTINCT FROM OLD.industry)
       AND (NEW.current_city IS NOT DISTINCT FROM OLD.current_city)
       AND (NEW.graduation_year IS NOT DISTINCT FROM OLD.graduation_year)
       AND (NEW.position_title IS NOT DISTINCT FROM OLD.position_title)
       AND (NEW.job_title IS NOT DISTINCT FROM OLD.job_title)
    THEN
      RETURN NEW;
    END IF;

    v_payload := jsonb_build_object(
      'old_user_id', OLD.user_id,
      'old_organization_id', OLD.organization_id
    );
  END IF;

  IF NEW.deleted_at IS NOT NULL THEN
    v_action := 'delete';
  ELSE
    v_action := 'upsert';
  END IF;

  INSERT INTO public.graph_sync_queue(org_id, source_table, source_id, action, payload)
  VALUES (NEW.organization_id, 'alumni', NEW.id, v_action, v_payload);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_graph_sync_alumni() IS 'Trigger function for alumni -> graph queue sync';

CREATE OR REPLACE FUNCTION public.enqueue_graph_sync_mentorship_pair()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_action text;
  v_payload jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id)
       AND (NEW.mentor_user_id IS NOT DISTINCT FROM OLD.mentor_user_id)
       AND (NEW.mentee_user_id IS NOT DISTINCT FROM OLD.mentee_user_id)
       AND (NEW.status IS NOT DISTINCT FROM OLD.status)
       AND (NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at)
    THEN
      RETURN NEW;
    END IF;

    v_payload := jsonb_build_object(
      'old_mentor_user_id', OLD.mentor_user_id,
      'old_mentee_user_id', OLD.mentee_user_id,
      'old_organization_id', OLD.organization_id
    );
  END IF;

  IF NEW.deleted_at IS NOT NULL OR NEW.status IS DISTINCT FROM 'active' THEN
    v_action := 'delete';
  ELSE
    v_action := 'upsert';
  END IF;

  INSERT INTO public.graph_sync_queue(org_id, source_table, source_id, action, payload)
  VALUES (NEW.organization_id, 'mentorship_pairs', NEW.id, v_action, v_payload);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_graph_sync_mentorship_pair() IS 'Trigger function for mentorship_pairs -> graph queue sync';

CREATE TRIGGER trg_graph_sync_members
  AFTER INSERT OR UPDATE ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_graph_sync_member();

CREATE TRIGGER trg_graph_sync_alumni
  AFTER INSERT OR UPDATE ON public.alumni
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_graph_sync_alumni();

CREATE TRIGGER trg_graph_sync_mentorship_pairs
  AFTER INSERT OR UPDATE ON public.mentorship_pairs
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_graph_sync_mentorship_pair();

-- =============================================================================
-- 3. Queue RPCs
-- =============================================================================

CREATE OR REPLACE FUNCTION public.dequeue_graph_sync_queue(p_batch_size int DEFAULT 50)
RETURNS SETOF public.graph_sync_queue
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.graph_sync_queue
  SET processed_at = now()
  WHERE id IN (
    SELECT id
    FROM public.graph_sync_queue
    WHERE processed_at IS NULL
      AND attempts < 3
    ORDER BY created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

COMMENT ON FUNCTION public.dequeue_graph_sync_queue IS 'Atomically dequeues graph sync work with row-level locking';

REVOKE EXECUTE ON FUNCTION public.dequeue_graph_sync_queue FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dequeue_graph_sync_queue FROM anon;
REVOKE EXECUTE ON FUNCTION public.dequeue_graph_sync_queue FROM authenticated;
GRANT EXECUTE ON FUNCTION public.dequeue_graph_sync_queue TO service_role;

CREATE OR REPLACE FUNCTION public.increment_graph_sync_attempts(
  p_id uuid,
  p_error text
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.graph_sync_queue
  SET attempts = attempts + 1,
      error = left(p_error, 500),
      processed_at = NULL
  WHERE id = p_id;
$$;

COMMENT ON FUNCTION public.increment_graph_sync_attempts IS 'Atomically increments graph queue attempts and re-enqueues the item';

REVOKE EXECUTE ON FUNCTION public.increment_graph_sync_attempts FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_graph_sync_attempts FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_graph_sync_attempts FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_graph_sync_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.purge_graph_sync_queue()
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
    FROM public.graph_sync_queue
    WHERE created_at < now() - interval '7 days'
      AND (processed_at IS NOT NULL OR attempts >= 3)
    ORDER BY created_at
    LIMIT 1000
  )
  DELETE FROM public.graph_sync_queue
  WHERE id IN (SELECT id FROM doomed);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION public.purge_graph_sync_queue IS 'Purges processed/dead-letter graph sync rows older than 7 days';

REVOKE EXECUTE ON FUNCTION public.purge_graph_sync_queue FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purge_graph_sync_queue FROM anon;
REVOKE EXECUTE ON FUNCTION public.purge_graph_sync_queue FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_graph_sync_queue TO service_role;

CREATE OR REPLACE FUNCTION public.backfill_graph_sync_queue(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  total_enqueued integer := 0;
  batch_count integer;
BEGIN
  INSERT INTO public.graph_sync_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'members', m.id, 'upsert'
  FROM public.members m
  WHERE m.organization_id = p_org_id
    AND m.deleted_at IS NULL
    AND m.status = 'active';
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  INSERT INTO public.graph_sync_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'alumni', a.id, 'upsert'
  FROM public.alumni a
  WHERE a.organization_id = p_org_id
    AND a.deleted_at IS NULL;
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  INSERT INTO public.graph_sync_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'mentorship_pairs', mp.id, 'upsert'
  FROM public.mentorship_pairs mp
  WHERE mp.organization_id = p_org_id
    AND mp.deleted_at IS NULL
    AND mp.status = 'active';
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  RETURN jsonb_build_object('enqueued', total_enqueued);
END;
$$;

COMMENT ON FUNCTION public.backfill_graph_sync_queue IS 'Enqueues all current people-graph sources for an org';

REVOKE EXECUTE ON FUNCTION public.backfill_graph_sync_queue FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.backfill_graph_sync_queue FROM anon;
REVOKE EXECUTE ON FUNCTION public.backfill_graph_sync_queue FROM authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_graph_sync_queue TO service_role;

-- =============================================================================
-- 4. SQL fallback mentorship-distance RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_mentorship_distances(
  p_org_id uuid,
  p_user_id uuid
)
RETURNS TABLE(user_id uuid, distance integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH RECURSIVE edges AS (
    SELECT mentor_user_id, mentee_user_id
    FROM public.mentorship_pairs
    WHERE organization_id = p_org_id
      AND deleted_at IS NULL
      AND status = 'active'
  ),
  walk AS (
    SELECT
      CASE
        WHEN e.mentor_user_id = p_user_id THEN e.mentee_user_id
        ELSE e.mentor_user_id
      END AS user_id,
      1 AS distance,
      ARRAY[
        p_user_id,
        CASE
          WHEN e.mentor_user_id = p_user_id THEN e.mentee_user_id
          ELSE e.mentor_user_id
        END
      ] AS path
    FROM edges e
    WHERE e.mentor_user_id = p_user_id OR e.mentee_user_id = p_user_id

    UNION ALL

    SELECT
      nxt.user_id,
      w.distance + 1,
      w.path || nxt.user_id
    FROM walk w
    JOIN edges e
      ON e.mentor_user_id = w.user_id OR e.mentee_user_id = w.user_id
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN e.mentor_user_id = w.user_id THEN e.mentee_user_id
        ELSE e.mentor_user_id
      END AS user_id
    ) nxt
    WHERE w.distance < 2
      AND NOT nxt.user_id = ANY(w.path)
  )
  SELECT walk.user_id, MIN(walk.distance)::integer AS distance
  FROM walk
  WHERE walk.user_id <> p_user_id
  GROUP BY walk.user_id
  HAVING MIN(walk.distance) <= 2;
$$;

COMMENT ON FUNCTION public.get_mentorship_distances IS 'Returns direct and second-degree mentorship distances for one user inside one org';

REVOKE EXECUTE ON FUNCTION public.get_mentorship_distances FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_mentorship_distances FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_mentorship_distances FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_mentorship_distances TO service_role;
