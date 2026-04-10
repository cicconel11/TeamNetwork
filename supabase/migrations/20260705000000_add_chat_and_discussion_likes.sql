-- Add likes for chat messages and discussion replies.
-- Mirrors the existing feed_likes toggle pattern with cached counts.

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS like_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.discussion_replies
  ADD COLUMN IF NOT EXISTS like_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.chat_message_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  chat_group_id uuid NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_message_likes_message
  ON public.chat_message_likes (message_id);

CREATE INDEX IF NOT EXISTS idx_chat_message_likes_group_user
  ON public.chat_message_likes (chat_group_id, user_id);

CREATE INDEX IF NOT EXISTS idx_chat_message_likes_org
  ON public.chat_message_likes (organization_id);

ALTER TABLE public.chat_message_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_message_likes_select ON public.chat_message_likes;
CREATE POLICY chat_message_likes_select ON public.chat_message_likes
  FOR SELECT USING (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni', 'parent'])
    AND (
      is_chat_group_member(chat_group_id) = TRUE
      OR has_active_role(organization_id, array['admin'])
    )
  );

DROP POLICY IF EXISTS chat_message_likes_insert ON public.chat_message_likes;
CREATE POLICY chat_message_likes_insert ON public.chat_message_likes
  FOR INSERT WITH CHECK (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni', 'parent'])
    AND (
      is_chat_group_member(chat_group_id) = TRUE
      OR has_active_role(organization_id, array['admin'])
    )
    AND user_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS chat_message_likes_delete ON public.chat_message_likes;
CREATE POLICY chat_message_likes_delete ON public.chat_message_likes
  FOR DELETE USING (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni', 'parent'])
    AND (
      is_chat_group_member(chat_group_id) = TRUE
      OR has_active_role(organization_id, array['admin'])
    )
    AND user_id = (SELECT auth.uid())
  );

ALTER TABLE public.chat_message_likes REPLICA IDENTITY FULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_message_likes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_message_likes;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.discussion_reply_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reply_id uuid NOT NULL REFERENCES public.discussion_replies(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.discussion_threads(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reply_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_discussion_reply_likes_reply
  ON public.discussion_reply_likes (reply_id);

CREATE INDEX IF NOT EXISTS idx_discussion_reply_likes_thread_user
  ON public.discussion_reply_likes (thread_id, user_id);

CREATE INDEX IF NOT EXISTS idx_discussion_reply_likes_org
  ON public.discussion_reply_likes (organization_id);

ALTER TABLE public.discussion_reply_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS discussion_reply_likes_select ON public.discussion_reply_likes;
CREATE POLICY discussion_reply_likes_select ON public.discussion_reply_likes
  FOR SELECT USING (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni', 'parent'])
  );

DROP POLICY IF EXISTS discussion_reply_likes_insert ON public.discussion_reply_likes;
CREATE POLICY discussion_reply_likes_insert ON public.discussion_reply_likes
  FOR INSERT WITH CHECK (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni', 'parent'])
    AND user_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS discussion_reply_likes_delete ON public.discussion_reply_likes;
CREATE POLICY discussion_reply_likes_delete ON public.discussion_reply_likes
  FOR DELETE USING (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni', 'parent'])
    AND user_id = (SELECT auth.uid())
  );

CREATE OR REPLACE FUNCTION public.update_chat_message_like_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.chat_messages
    SET like_count = like_count + 1
    WHERE id = NEW.message_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.chat_messages
    SET like_count = GREATEST(like_count - 1, 0)
    WHERE id = OLD.message_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.update_discussion_reply_like_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.discussion_replies
    SET like_count = like_count + 1
    WHERE id = NEW.reply_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.discussion_replies
    SET like_count = GREATEST(like_count - 1, 0)
    WHERE id = OLD.reply_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS chat_message_likes_insert_trigger ON public.chat_message_likes;
CREATE TRIGGER chat_message_likes_insert_trigger
  AFTER INSERT ON public.chat_message_likes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_chat_message_like_count();

DROP TRIGGER IF EXISTS chat_message_likes_delete_trigger ON public.chat_message_likes;
CREATE TRIGGER chat_message_likes_delete_trigger
  AFTER DELETE ON public.chat_message_likes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_chat_message_like_count();

DROP TRIGGER IF EXISTS discussion_reply_likes_insert_trigger ON public.discussion_reply_likes;
CREATE TRIGGER discussion_reply_likes_insert_trigger
  AFTER INSERT ON public.discussion_reply_likes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_discussion_reply_like_count();

DROP TRIGGER IF EXISTS discussion_reply_likes_delete_trigger ON public.discussion_reply_likes;
CREATE TRIGGER discussion_reply_likes_delete_trigger
  AFTER DELETE ON public.discussion_reply_likes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_discussion_reply_like_count();

NOTIFY pgrst, 'reload schema';
