-- knowledge_documents hardening — three Phase-3 review fixes.
--
-- The base table shipped in 20261224000000. This follow-up addresses gaps a
-- review flagged (cannot edit an applied migration in place):
--
--   1. (#3) audience accepted arbitrary text, but retrieval gating depends on
--      exact tokens. Add a CHECK to the supported allowlist.
--   2. (#2) the embedding trigger was AFTER INSERT OR UPDATE only. A hard DELETE
--      (the admin FOR ALL policy permits it) left orphaned, still-searchable
--      chunks in ai_document_chunks — a retrieval/security leak. Add an
--      AFTER DELETE path that enqueues chunk cleanup using OLD.
--   3. (#4) backfill_ai_embedding_queue scanned only 6 of the 8 indexed source
--      tables; mentor_profiles and form_submissions had no backfill path. Add
--      them so every embedding-worker SourceTable can be backfilled.

-- =============================================================================
-- 1. (#3) audience allowlist CHECK
--
-- Tokens mirror audienceFilterForRole() / search_ai_documents gating:
--   'all'/'both'/unset -> visible to everyone
--   'admins'           -> admin-only
--   'members'/'active_members'/'alumni' -> reserved for finer role gating
-- Live data only contains 'all' and 'admins' today, so this adds no risk of
-- rejecting existing rows. NOT VALID would defer the scan, but the table is
-- tiny and fully conformant, so validate immediately.
-- =============================================================================

ALTER TABLE public.knowledge_documents
  DROP CONSTRAINT IF EXISTS knowledge_documents_audience_check;

ALTER TABLE public.knowledge_documents
  ADD CONSTRAINT knowledge_documents_audience_check
  CHECK (audience IN ('all', 'both', 'members', 'active_members', 'alumni', 'admins'));

-- =============================================================================
-- 2. (#2) hard-delete cleanup
--
-- A dedicated DELETE handler (OLD is the deleted row; NEW is NULL on DELETE, so
-- the shared enqueue_ai_embedding() cannot be reused verbatim). Enqueues a
-- 'delete' action mirroring the soft-delete branch in enqueue_ai_embedding().
-- General by table name so the same handler can guard other indexed sources if
-- their hard-delete paths are wired later; for now only knowledge_documents has
-- the admin FOR ALL policy that makes hard delete reachable, so only it is wired.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enqueue_ai_embedding_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  VALUES (OLD.organization_id, TG_TABLE_NAME, OLD.id, 'delete')
  ON CONFLICT DO NOTHING;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.enqueue_ai_embedding_delete() IS 'AFTER DELETE trigger fn: enqueues chunk cleanup for a hard-deleted indexed source row (uses OLD)';

DROP TRIGGER IF EXISTS trg_ai_embed_delete_knowledge_documents ON public.knowledge_documents;

CREATE TRIGGER trg_ai_embed_delete_knowledge_documents
  AFTER DELETE ON public.knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_ai_embedding_delete();

-- =============================================================================
-- 3. (#4) backfill parity — add mentor_profiles + form_submissions blocks
--
-- Recreated from the live 6-table version (20261224000000) plus the two missing
-- source tables. mentor_profiles has no deleted_at column (its rows are hard
-- managed), so its block omits the deleted_at predicate; form_submissions has
-- deleted_at like the rest.
-- =============================================================================

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
  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'announcements', a.id, 'upsert'
  FROM public.announcements a
  WHERE a.organization_id = p_org_id
    AND a.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id AND c.source_table = 'announcements'
        AND c.source_id = a.id AND c.deleted_at IS NULL
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'events', e.id, 'upsert'
  FROM public.events e
  WHERE e.organization_id = p_org_id
    AND e.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id AND c.source_table = 'events'
        AND c.source_id = e.id AND c.deleted_at IS NULL
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'discussion_threads', dt.id, 'upsert'
  FROM public.discussion_threads dt
  WHERE dt.organization_id = p_org_id
    AND dt.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id AND c.source_table = 'discussion_threads'
        AND c.source_id = dt.id AND c.deleted_at IS NULL
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'discussion_replies', dr.id, 'upsert'
  FROM public.discussion_replies dr
  WHERE dr.organization_id = p_org_id
    AND dr.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id AND c.source_table = 'discussion_replies'
        AND c.source_id = dr.id AND c.deleted_at IS NULL
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'job_postings', jp.id, 'upsert'
  FROM public.job_postings jp
  WHERE jp.organization_id = p_org_id
    AND jp.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id AND c.source_table = 'job_postings'
        AND c.source_id = jp.id AND c.deleted_at IS NULL
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'mentor_profiles', mp.id, 'upsert'
  FROM public.mentor_profiles mp
  WHERE mp.organization_id = p_org_id
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id AND c.source_table = 'mentor_profiles'
        AND c.source_id = mp.id AND c.deleted_at IS NULL
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'form_submissions', fs.id, 'upsert'
  FROM public.form_submissions fs
  WHERE fs.organization_id = p_org_id
    AND fs.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id AND c.source_table = 'form_submissions'
        AND c.source_id = fs.id AND c.deleted_at IS NULL
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'knowledge_documents', kd.id, 'upsert'
  FROM public.knowledge_documents kd
  WHERE kd.organization_id = p_org_id
    AND kd.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id AND c.source_table = 'knowledge_documents'
        AND c.source_id = kd.id AND c.deleted_at IS NULL
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  RETURN jsonb_build_object('enqueued', total_enqueued);
END;
$$;
