-- Fix enqueue_ai_embedding() to compare only fields that exist on each source table.
-- The hardened generic trigger in 20260712000000_ai_rag_hardening.sql referenced
-- NEW.body / OLD.body for all sources, which breaks updates on events rows.

CREATE OR REPLACE FUNCTION public.enqueue_ai_embedding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
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

  -- Skip updates where deleted_at is already set.
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
    END IF;
  END IF;

  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  VALUES (NEW.organization_id, TG_TABLE_NAME, NEW.id, 'upsert')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_ai_embedding() IS 'Trigger function: enqueues embedding work only when source-table-specific indexed content changes';
