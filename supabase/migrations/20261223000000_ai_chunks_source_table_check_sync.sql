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
  ));
