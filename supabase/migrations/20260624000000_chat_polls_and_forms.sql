-- =====================================================
-- Chat Polls & Inline Forms
-- Extends chat_messages with message_type + metadata,
-- adds chat_poll_votes and chat_form_responses tables.
-- =====================================================

-- 1A. Extend chat_messages with message_type and metadata
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS message_type text,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

-- CHECK constraint: message_type must be null, 'text', 'poll', or 'form'
ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_message_type_check
  CHECK (message_type IS NULL OR message_type IN ('text', 'poll', 'form'));

-- Index for filtering by message_type within a group
CREATE INDEX IF NOT EXISTS idx_chat_messages_group_type
  ON public.chat_messages (chat_group_id, message_type)
  WHERE deleted_at IS NULL AND message_type IS NOT NULL;

-- 1B. Create chat_poll_votes table
CREATE TABLE IF NOT EXISTS public.chat_poll_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  chat_group_id uuid NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  option_index smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);

-- Index for fetching all votes for a poll
CREATE INDEX IF NOT EXISTS idx_chat_poll_votes_message
  ON public.chat_poll_votes (message_id);

-- Index for user lookups within a group
CREATE INDEX IF NOT EXISTS idx_chat_poll_votes_group_user
  ON public.chat_poll_votes (chat_group_id, user_id);

-- Enable RLS
ALTER TABLE public.chat_poll_votes ENABLE ROW LEVEL SECURITY;

-- RLS: group members can read all votes in their groups
CREATE POLICY chat_poll_votes_select ON public.chat_poll_votes
  FOR SELECT USING (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
    AND is_chat_group_member(chat_group_id) = TRUE
  );

-- RLS: group members can insert their own votes
CREATE POLICY chat_poll_votes_insert ON public.chat_poll_votes
  FOR INSERT WITH CHECK (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
    AND is_chat_group_member(chat_group_id) = TRUE
    AND user_id = (SELECT auth.uid())
  );

-- RLS: users can update their own votes (change vote)
CREATE POLICY chat_poll_votes_update ON public.chat_poll_votes
  FOR UPDATE USING (
    user_id = (SELECT auth.uid())
  );

-- RLS: users can delete own votes; moderators/admins can delete any
CREATE POLICY chat_poll_votes_delete ON public.chat_poll_votes
  FOR DELETE USING (
    user_id = (SELECT auth.uid())
    OR is_chat_group_moderator(chat_group_id) = TRUE
    OR has_active_role(organization_id, array['admin'])
  );

-- Realtime: REPLICA IDENTITY FULL for vote change detection
ALTER TABLE public.chat_poll_votes REPLICA IDENTITY FULL;

-- Add to realtime publication
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_poll_votes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_poll_votes;
  END IF;
END $$;

-- 1C. Create chat_form_responses table
CREATE TABLE IF NOT EXISTS public.chat_form_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  chat_group_id uuid NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  responses jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);

-- Index for fetching responses for a form message
CREATE INDEX IF NOT EXISTS idx_chat_form_responses_message
  ON public.chat_form_responses (message_id);

-- Index for user lookups within a group
CREATE INDEX IF NOT EXISTS idx_chat_form_responses_group_user
  ON public.chat_form_responses (chat_group_id, user_id);

-- Enable RLS
ALTER TABLE public.chat_form_responses ENABLE ROW LEVEL SECURITY;

-- RLS: group members can read all responses in their groups
CREATE POLICY chat_form_responses_select ON public.chat_form_responses
  FOR SELECT USING (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
    AND is_chat_group_member(chat_group_id) = TRUE
  );

-- RLS: group members can insert their own responses
CREATE POLICY chat_form_responses_insert ON public.chat_form_responses
  FOR INSERT WITH CHECK (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
    AND is_chat_group_member(chat_group_id) = TRUE
    AND user_id = (SELECT auth.uid())
  );

-- RLS: users can update their own responses
CREATE POLICY chat_form_responses_update ON public.chat_form_responses
  FOR UPDATE USING (
    user_id = (SELECT auth.uid())
  );

-- RLS: users can delete own responses; moderators/admins can delete any
CREATE POLICY chat_form_responses_delete ON public.chat_form_responses
  FOR DELETE USING (
    user_id = (SELECT auth.uid())
    OR is_chat_group_moderator(chat_group_id) = TRUE
    OR has_active_role(organization_id, array['admin'])
  );

-- Realtime: REPLICA IDENTITY FULL for response change detection
ALTER TABLE public.chat_form_responses REPLICA IDENTITY FULL;

-- Add to realtime publication
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_form_responses'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_form_responses;
  END IF;
END $$;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
