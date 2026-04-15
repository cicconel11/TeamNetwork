-- Update sync trigger to restore soft-deleted member/alumni rows when UOR re-activates.
-- Prevents "ghost approved" state where user's UOR is active but profile stays hidden
-- because alumni/members row still has deleted_at set from prior admin delete.

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
  SELECT
    email,
    COALESCE(raw_user_meta_data->>'first_name', split_part(COALESCE(raw_user_meta_data->>'full_name', 'Member'), ' ', 1)),
    COALESCE(raw_user_meta_data->>'last_name', split_part(COALESCE(raw_user_meta_data->>'full_name', ''), ' ', 2)),
    raw_user_meta_data->>'avatar_url'
  INTO v_user_email, v_first_name, v_last_name, v_avatar_url
  FROM auth.users
  WHERE id = NEW.user_id;

  v_first_name := COALESCE(v_first_name, 'Member');
  v_last_name := COALESCE(v_last_name, '');

  -- 1. Sync to public.members (prefer live row; fall back to soft-deleted to restore)
  SELECT id INTO v_member_id
  FROM public.members
  WHERE organization_id = NEW.organization_id
    AND (user_id = NEW.user_id OR (email IS NOT NULL AND email = v_user_email))
  ORDER BY deleted_at NULLS FIRST, created_at DESC
  LIMIT 1;

  IF v_member_id IS NOT NULL THEN
    UPDATE public.members
    SET
      user_id = NEW.user_id,
      role = NEW.role,
      status = NEW.status::text::public.member_status,
      deleted_at = CASE WHEN NEW.status = 'active' THEN NULL ELSE deleted_at END,
      updated_at = now()
    WHERE id = v_member_id;
  ELSE
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

  -- 2. Sync to public.alumni if role is ALUMNI (prefer live row; fall back to soft-deleted)
  IF NEW.role = 'alumni' THEN
    SELECT id INTO v_alumni_id
    FROM public.alumni
    WHERE organization_id = NEW.organization_id
      AND (user_id = NEW.user_id OR (email IS NOT NULL AND email = v_user_email))
    ORDER BY deleted_at NULLS FIRST, created_at DESC
    LIMIT 1;

    IF v_alumni_id IS NOT NULL THEN
       UPDATE public.alumni
       SET
         user_id = NEW.user_id,
         deleted_at = CASE WHEN NEW.status = 'active' THEN NULL ELSE deleted_at END,
         updated_at = now()
       WHERE id = v_alumni_id;
    ELSE
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
