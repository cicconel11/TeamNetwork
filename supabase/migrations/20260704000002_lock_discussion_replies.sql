DROP POLICY IF EXISTS "discussion_replies_insert" ON public.discussion_replies;

CREATE POLICY "discussion_replies_insert" ON public.discussion_replies
  FOR INSERT WITH CHECK (
    author_id = auth.uid()
    AND has_active_role(organization_id, array['admin','active_member','alumni'])
    AND EXISTS (
      SELECT 1
      FROM public.discussion_threads
      WHERE public.discussion_threads.id = public.discussion_replies.thread_id
        AND public.discussion_threads.organization_id = public.discussion_replies.organization_id
        AND public.discussion_threads.deleted_at IS NULL
        AND public.discussion_threads.is_locked = false
    )
  );
