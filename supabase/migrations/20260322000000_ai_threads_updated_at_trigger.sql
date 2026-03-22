-- Attach the existing updated_at trigger to ai_threads so that any UPDATE
-- to a thread row automatically refreshes the updated_at timestamp.
-- The update_updated_at_column() function is defined in
-- 20251215000000_embeds_fix_and_approvals.sql.
DROP TRIGGER IF EXISTS ai_threads_updated_at ON public.ai_threads;
CREATE TRIGGER ai_threads_updated_at
  BEFORE UPDATE ON public.ai_threads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
