-- Sync ai_document_chunks.source_table CHECK to the 7 sources chunker.ts actually inserts.
-- The original foundation migration listed only 5; mentor_profiles + form_submissions
-- were added to the worker/chunker without updating the constraint. Data-integrity fix.
ALTER TABLE public.ai_document_chunks
  DROP CONSTRAINT IF EXISTS ai_document_chunks_source_table_check;

ALTER TABLE public.ai_document_chunks
  ADD CONSTRAINT ai_document_chunks_source_table_check
  CHECK (source_table IN (
    'announcements', 'discussion_threads', 'discussion_replies',
    'events', 'job_postings', 'mentor_profiles', 'form_submissions'
  ))
  NOT VALID;

ALTER TABLE public.ai_document_chunks
  VALIDATE CONSTRAINT ai_document_chunks_source_table_check;

CREATE OR REPLACE FUNCTION public.enqueue_ai_embedding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'mentor_profiles' THEN
    IF TG_OP = 'UPDATE'
       AND NEW.is_active = false
       AND OLD.is_active = true
    THEN
      INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
      VALUES (NEW.organization_id, TG_TABLE_NAME, NEW.id, 'delete')
      ON CONFLICT DO NOTHING;
      RETURN NEW;
    END IF;

    IF NEW.is_active = false THEN
      RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.bio IS NOT DISTINCT FROM OLD.bio
       AND NEW.topics IS NOT DISTINCT FROM OLD.topics
       AND NEW.industries IS NOT DISTINCT FROM OLD.industries
       AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active
    THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
    VALUES (NEW.organization_id, TG_TABLE_NAME, NEW.id, 'upsert')
    ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  -- Soft-delete: deleted_at changed from NULL to non-NULL.
  IF TG_OP = 'UPDATE'
     AND NEW.deleted_at IS NOT NULL
     AND OLD.deleted_at IS NULL
  THEN
    INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
    VALUES (NEW.organization_id, TG_TABLE_NAME, NEW.id, 'delete')
    ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  -- Skip inserts or updates where deleted_at is already set.
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- For UPDATE: only enqueue if indexed content for this source table changed.
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'announcements' THEN
      IF NEW.title IS NOT DISTINCT FROM OLD.title
         AND NEW.body IS NOT DISTINCT FROM OLD.body
         AND NEW.audience IS NOT DISTINCT FROM OLD.audience
         AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at
      THEN
        RETURN NEW;
      END IF;
    ELSIF TG_TABLE_NAME = 'events' THEN
      IF NEW.title IS NOT DISTINCT FROM OLD.title
         AND NEW.description IS NOT DISTINCT FROM OLD.description
         AND NEW.start_date IS NOT DISTINCT FROM OLD.start_date
         AND NEW.end_date IS NOT DISTINCT FROM OLD.end_date
         AND NEW.location IS NOT DISTINCT FROM OLD.location
         AND NEW.audience IS NOT DISTINCT FROM OLD.audience
      THEN
        RETURN NEW;
      END IF;
    ELSIF TG_TABLE_NAME = 'discussion_threads' THEN
      IF NEW.title IS NOT DISTINCT FROM OLD.title
         AND NEW.body IS NOT DISTINCT FROM OLD.body
      THEN
        RETURN NEW;
      END IF;
    ELSIF TG_TABLE_NAME = 'discussion_replies' THEN
      IF NEW.body IS NOT DISTINCT FROM OLD.body
         AND NEW.thread_id IS NOT DISTINCT FROM OLD.thread_id
      THEN
        RETURN NEW;
      END IF;
    ELSIF TG_TABLE_NAME = 'job_postings' THEN
      IF NEW.title IS NOT DISTINCT FROM OLD.title
         AND NEW.company IS NOT DISTINCT FROM OLD.company
         AND NEW.description IS NOT DISTINCT FROM OLD.description
         AND NEW.location IS NOT DISTINCT FROM OLD.location
         AND NEW.location_type IS NOT DISTINCT FROM OLD.location_type
      THEN
        RETURN NEW;
      END IF;
    ELSIF TG_TABLE_NAME = 'form_submissions' THEN
      IF NEW.form_id IS NOT DISTINCT FROM OLD.form_id
         AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
         AND NEW.data IS NOT DISTINCT FROM OLD.data
      THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  VALUES (NEW.organization_id, TG_TABLE_NAME, NEW.id, 'upsert')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_ai_embedding() IS 'Trigger function: enqueues embedding work only when source-table-specific indexed content changes';

DROP TRIGGER IF EXISTS trg_ai_embed_mentor_profiles ON public.mentor_profiles;
CREATE TRIGGER trg_ai_embed_mentor_profiles
  AFTER INSERT OR UPDATE ON public.mentor_profiles
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_ai_embedding();

DROP TRIGGER IF EXISTS trg_ai_embed_form_submissions ON public.form_submissions;
CREATE TRIGGER trg_ai_embed_form_submissions
  AFTER INSERT OR UPDATE ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_ai_embedding();

CREATE OR REPLACE FUNCTION public.backfill_ai_embedding_queue(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  total_enqueued integer := 0;
  batch_count integer;
BEGIN
  -- Announcements
  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'announcements', a.id, 'upsert'
  FROM public.announcements a
  WHERE a.organization_id = p_org_id
    AND a.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id
        AND c.source_table = 'announcements'
        AND c.source_id = a.id
        AND c.deleted_at IS NULL
    );
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  -- Events
  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'events', e.id, 'upsert'
  FROM public.events e
  WHERE e.organization_id = p_org_id
    AND e.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id
        AND c.source_table = 'events'
        AND c.source_id = e.id
        AND c.deleted_at IS NULL
    );
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  -- Discussion threads
  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'discussion_threads', dt.id, 'upsert'
  FROM public.discussion_threads dt
  WHERE dt.organization_id = p_org_id
    AND dt.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id
        AND c.source_table = 'discussion_threads'
        AND c.source_id = dt.id
        AND c.deleted_at IS NULL
    );
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  -- Discussion replies
  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'discussion_replies', dr.id, 'upsert'
  FROM public.discussion_replies dr
  WHERE dr.organization_id = p_org_id
    AND dr.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id
        AND c.source_table = 'discussion_replies'
        AND c.source_id = dr.id
        AND c.deleted_at IS NULL
    );
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  -- Job postings
  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'job_postings', jp.id, 'upsert'
  FROM public.job_postings jp
  WHERE jp.organization_id = p_org_id
    AND jp.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id
        AND c.source_table = 'job_postings'
        AND c.source_id = jp.id
        AND c.deleted_at IS NULL
    );
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  -- Mentor profiles
  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'mentor_profiles', mp.id, 'upsert'
  FROM public.mentor_profiles mp
  WHERE mp.organization_id = p_org_id
    AND mp.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id
        AND c.source_table = 'mentor_profiles'
        AND c.source_id = mp.id
        AND c.deleted_at IS NULL
    );
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  -- Form submissions
  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'form_submissions', fs.id, 'upsert'
  FROM public.form_submissions fs
  WHERE fs.organization_id = p_org_id
    AND fs.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id
        AND c.source_table = 'form_submissions'
        AND c.source_id = fs.id
        AND c.deleted_at IS NULL
    );
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  RETURN jsonb_build_object('enqueued', total_enqueued);
END;
$$;

COMMENT ON FUNCTION public.backfill_ai_embedding_queue IS 'Enqueues all unindexed content for an org across all source tables';

REVOKE EXECUTE ON FUNCTION public.backfill_ai_embedding_queue FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.backfill_ai_embedding_queue FROM anon;
REVOKE EXECUTE ON FUNCTION public.backfill_ai_embedding_queue FROM authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_ai_embedding_queue TO service_role;
