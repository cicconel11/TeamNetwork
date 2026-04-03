-- Add FK to public.users so PostgREST can resolve the join
-- (The existing FK to auth.users handles CASCADE deletes from auth)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chat_group_members_user_id_public_users_fkey'
      AND table_name = 'chat_group_members'
  ) THEN
    ALTER TABLE public.chat_group_members
      ADD CONSTRAINT chat_group_members_user_id_public_users_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
