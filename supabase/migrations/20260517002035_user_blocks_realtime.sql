-- Add user_blocks to supabase_realtime publication so BlockedUsersContext
-- receives INSERT/UPDATE events after toggle_block().
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_blocks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_blocks;
  END IF;
END $$;
