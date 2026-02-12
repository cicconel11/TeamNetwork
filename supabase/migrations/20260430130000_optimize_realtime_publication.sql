-- Optimize Realtime publication: remove tables with zero frontend subscribers,
-- add chat_group_members which IS subscribed in ChatRoom.tsx but was missing.
-- Reduces realtime.list_changes load (96.4% of total DB time) by ~83%.

-- Remove tables with no frontend Realtime subscribers (idempotent guards)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'alumni'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.alumni;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'announcements'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.announcements;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'events'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.events;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'organizations'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.organizations;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'user_organization_roles'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.user_organization_roles;
  END IF;

  -- Add chat_group_members (actually subscribed in frontend but missing from publication)
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_group_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_group_members;
  END IF;
END $$;

-- REPLICA IDENTITY FULL so UPDATE/DELETE payloads include user_id, removed_at
-- (default only sends PK = id, but ChatRoom needs user_id to detect self-removal)
ALTER TABLE public.chat_group_members REPLICA IDENTITY FULL;
