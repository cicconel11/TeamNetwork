-- Fix trigger chain bug: handle_org_member_sync crashes when
-- handle_members_soft_delete sets user_organization_roles.status = 'revoked'
-- because 'revoked' is not a valid member_status enum value.
--
-- Root cause: Deleting a member → members_soft_delete_sync trigger revokes the
-- user_organization_roles row → that UPDATE fires handle_org_member_sync →
-- which casts NEW.status::text::member_status → fails because 'revoked' is not
-- in the enum (only active, inactive, pending).
--
-- Fix: Early return when NEW.status = 'revoked'. The role is being revoked,
-- so there is nothing to sync to members/alumni/parents tables.
--
-- This migration was applied directly to production on 2026-03-10; this file
-- captures the change locally to keep migration history in sync.

CREATE OR REPLACE FUNCTION public.handle_org_member_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_email text;
  v_first_name text;
  v_last_name text;
  v_avatar_url text;
  v_member_id uuid;
  v_alumni_id uuid;
  v_parent_id uuid;
BEGIN
  -- Skip sync when role is being revoked — 'revoked' is not a valid
  -- member_status enum value and there is nothing meaningful to sync.
  IF NEW.status = 'revoked' THEN
    RETURN NEW;
  END IF;

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
       -- Enforce alumni quota before creating a new profile
       PERFORM public.assert_alumni_quota(NEW.organization_id);

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

  -- 3. Sync to public.parents if role is PARENT
  IF NEW.role = 'parent' THEN
    SELECT id INTO v_parent_id
    FROM public.parents
    WHERE organization_id = NEW.organization_id
      AND deleted_at IS NULL
      AND (
        user_id = NEW.user_id OR (
          v_user_email IS NOT NULL
          AND email IS NOT NULL
          AND lower(email) = lower(v_user_email)
        )
      )
    LIMIT 1;

    IF v_parent_id IS NOT NULL THEN
      -- Link existing parent record without overwriting admin-entered fields
      UPDATE public.parents
      SET
        user_id = NEW.user_id,
        email = COALESCE(email, v_user_email),
        photo_url = COALESCE(photo_url, v_avatar_url),
        updated_at = now()
      WHERE id = v_parent_id;
    ELSE
      -- Create new parent profile
      INSERT INTO public.parents (
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

  -- 4. Cleanup: if role changed AWAY from parent, soft-delete the parents record
  --    TG_OP = 'UPDATE' guards this block so INSERT paths are never affected.
  IF TG_OP = 'UPDATE' AND OLD.role = 'parent' AND NEW.role != 'parent' THEN
    UPDATE public.parents
    SET deleted_at = now(), updated_at = now()
    WHERE organization_id = NEW.organization_id
      AND user_id = NEW.user_id
      AND deleted_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;
