-- Ensure member_status enum has 'pending'
DO $$
BEGIN
  ALTER TYPE public.member_status ADD VALUE IF NOT EXISTS 'pending';
EXCEPTION
  WHEN undefined_object THEN null; -- type might not exist
  WHEN duplicate_object THEN null;
END $$;

-- Add user_id column to members and alumni if it doesn't exist
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

-- Create index for performance
CREATE INDEX IF NOT EXISTS members_user_id_idx ON public.members(user_id);
CREATE INDEX IF NOT EXISTS alumni_user_id_idx ON public.alumni(user_id);

-- Trigger to sync user_organization_roles changes to members and alumni tables
CREATE OR REPLACE FUNCTION public.handle_org_member_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_email text;
  v_first_name text;
  v_last_name text;
  v_avatar_url text;
  v_member_id uuid;
  v_alumni_id uuid;
BEGIN
  -- Get user details from auth.users
  SELECT 
    email,
    COALESCE(raw_user_meta_data->>'first_name', split_part(COALESCE(raw_user_meta_data->>'full_name', 'Member'), ' ', 1)),
    COALESCE(raw_user_meta_data->>'last_name', split_part(COALESCE(raw_user_meta_data->>'full_name', ''), ' ', 2)),
    raw_user_meta_data->>'avatar_url'
  INTO v_user_email, v_first_name, v_last_name, v_avatar_url
  FROM auth.users
  WHERE id = NEW.user_id;

  -- Ensure we have defaults if auth data is missing
  v_first_name := COALESCE(v_first_name, 'Member');
  v_last_name := COALESCE(v_last_name, '');

  -- 1. Sync to public.members
  -- Check if member entry exists for this user+org (by user_id OR email)
  SELECT id INTO v_member_id 
  FROM public.members 
  WHERE organization_id = NEW.organization_id 
    AND (user_id = NEW.user_id OR (email IS NOT NULL AND email = v_user_email))
  LIMIT 1;

  IF v_member_id IS NOT NULL THEN
    -- Update existing member
    UPDATE public.members
    SET 
      user_id = NEW.user_id, -- Link user_id if it was missing
      role = NEW.role,
      status = NEW.status::text::public.member_status,
      updated_at = now()
    WHERE id = v_member_id;
  ELSE
    -- Insert new member
    INSERT INTO public.members (
      organization_id,
      user_id,
      first_name,
      last_name,
      email,
      photo_url,
      role,
      status
    )
    VALUES (
      NEW.organization_id,
      NEW.user_id,
      v_first_name,
      v_last_name,
      v_user_email,
      v_avatar_url,
      NEW.role,
      NEW.status::text::public.member_status
    );
  END IF;

  -- 2. Sync to public.alumni if role is ALUMNI
  IF NEW.role = 'alumni' THEN
    SELECT id INTO v_alumni_id
    FROM public.alumni
    WHERE organization_id = NEW.organization_id
      AND (user_id = NEW.user_id OR (email IS NOT NULL AND email = v_user_email))
    LIMIT 1;

    IF v_alumni_id IS NOT NULL THEN
       -- Existing alumni, just link user_id and touch updated_at
       UPDATE public.alumni 
       SET 
         user_id = NEW.user_id,
         updated_at = now() 
       WHERE id = v_alumni_id;
    ELSE
       -- Create alumni profile
       INSERT INTO public.alumni (
         organization_id,
         user_id,
         first_name,
         last_name,
         email,
         photo_url
       )
       VALUES (
         NEW.organization_id,
         NEW.user_id,
         v_first_name,
         v_last_name,
         v_user_email,
         v_avatar_url
       );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Create the trigger
DROP TRIGGER IF EXISTS on_org_member_sync ON public.user_organization_roles;
CREATE TRIGGER on_org_member_sync
  AFTER INSERT OR UPDATE ON public.user_organization_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_org_member_sync();

-- Backfill: Touch all existing roles to trigger the sync for missing members
-- We use a dummy update that doesn't change data but fires the trigger
UPDATE public.user_organization_roles
SET status = status
WHERE true;
