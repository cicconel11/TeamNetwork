-- Add FK to public.users so PostgREST can resolve the relationship
-- (the existing FK to auth.users remains valid for referential integrity)
ALTER TABLE public.media_items
  ADD CONSTRAINT media_items_uploaded_by_users_fkey
  FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE CASCADE;
