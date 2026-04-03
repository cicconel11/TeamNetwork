-- Update handle_org_member_sync to skip member directory sync for pending users.
-- This must come AFTER 20260714000000_member_identity_hardening.sql which is
-- the latest migration that redefines this function.
--
-- Pending users should not appear in member directories until approved.
-- The normal approval path (pending -> active UPDATE) is NOT caught by the guard,
-- so it correctly syncs to members when an admin approves.
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
  v_full_name text;
  v_display_name text;
  v_avatar_url text;
  v_member_id uuid;
  v_alumni_id uuid;
  v_parent_id uuid;
BEGIN
  IF NEW.status = 'revoked' THEN
    IF NEW.role = 'alumni' AND NEW.user_id IS NOT NULL THEN
      UPDATE public.alumni
      SET deleted_at = now(), updated_at = now()
      WHERE organization_id = NEW.organization_id
        AND user_id = NEW.user_id
        AND deleted_at IS NULL;
    END IF;

    IF NEW.user_id IS NOT NULL THEN
      UPDATE public.members
      SET deleted_at = now(), updated_at = now()
      WHERE organization_id = NEW.organization_id
        AND user_id = NEW.user_id
        AND deleted_at IS NULL;
    END IF;

    IF NEW.role = 'parent' AND NEW.user_id IS NOT NULL THEN
      UPDATE public.parents
      SET deleted_at = now(), updated_at = now()
      WHERE organization_id = NEW.organization_id
        AND user_id = NEW.user_id
        AND deleted_at IS NULL;
    END IF;

    RETURN NEW;
  END IF;

  -- Pending users should not appear in member directories until approved.
  -- Covers both: new INSERT with pending, AND revoked->pending UPDATE path.
  -- The normal approval UPDATE (pending -> active) is NOT caught here,
  -- so it correctly syncs to members/alumni/parents when an admin approves.
  IF NEW.status = 'pending' AND (
    TG_OP = 'INSERT'
    OR (TG_OP = 'UPDATE' AND OLD.status = 'revoked')
  ) THEN
    RETURN NEW;
  END IF;

  SELECT
    email,
    NULLIF(btrim(raw_user_meta_data->>'first_name'), ''),
    NULLIF(btrim(raw_user_meta_data->>'last_name'), ''),
    NULLIF(btrim(raw_user_meta_data->>'full_name'), ''),
    NULLIF(btrim(raw_user_meta_data->>'name'), ''),
    raw_user_meta_data->>'avatar_url'
  INTO v_user_email, v_first_name, v_last_name, v_full_name, v_display_name, v_avatar_url
  FROM auth.users
  WHERE id = NEW.user_id;

  IF COALESCE(v_first_name, '') = '' AND COALESCE(v_last_name, '') = '' THEN
    v_full_name := COALESCE(v_full_name, v_display_name);

    IF COALESCE(v_full_name, '') <> '' THEN
      v_first_name := split_part(v_full_name, ' ', 1);
      v_last_name := COALESCE(
        NULLIF(btrim(substr(v_full_name, length(split_part(v_full_name, ' ', 1)) + 1)), ''),
        ''
      );
    END IF;
  END IF;

  v_first_name := COALESCE(v_first_name, 'Member');
  v_last_name := COALESCE(v_last_name, '');

  SELECT id INTO v_member_id
  FROM public.members
  WHERE organization_id = NEW.organization_id
    AND (user_id = NEW.user_id OR (email IS NOT NULL AND email = v_user_email))
  LIMIT 1;

  IF v_member_id IS NOT NULL THEN
    UPDATE public.members
    SET
      user_id = NEW.user_id,
      first_name = CASE
        WHEN (
          COALESCE(btrim(first_name), '') = '' AND COALESCE(btrim(last_name), '') = ''
        ) OR (
          COALESCE(btrim(first_name), '') = 'Member' AND COALESCE(btrim(last_name), '') = ''
        )
        THEN v_first_name
        ELSE first_name
      END,
      last_name = CASE
        WHEN (
          COALESCE(btrim(first_name), '') = '' AND COALESCE(btrim(last_name), '') = ''
        ) OR (
          COALESCE(btrim(first_name), '') = 'Member' AND COALESCE(btrim(last_name), '') = ''
        )
        THEN v_last_name
        ELSE last_name
      END,
      role = NEW.role,
      status = NEW.status::text::public.member_status,
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

  IF NEW.role = 'alumni' THEN
    SELECT id INTO v_alumni_id
    FROM public.alumni
    WHERE organization_id = NEW.organization_id
      AND (user_id = NEW.user_id OR (email IS NOT NULL AND email = v_user_email))
    LIMIT 1;

    IF v_alumni_id IS NOT NULL THEN
      UPDATE public.alumni
      SET
        user_id = NEW.user_id,
        updated_at = now()
      WHERE id = v_alumni_id;
    ELSE
      PERFORM public.assert_alumni_quota(NEW.organization_id);

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
      UPDATE public.parents
      SET
        user_id = NEW.user_id,
        email = COALESCE(email, v_user_email),
        photo_url = COALESCE(photo_url, v_avatar_url),
        updated_at = now()
      WHERE id = v_parent_id;
    ELSE
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

  IF TG_OP = 'UPDATE' AND OLD.role = 'alumni' AND NEW.role != 'alumni' THEN
    UPDATE public.alumni
    SET deleted_at = now(), updated_at = now()
    WHERE organization_id = NEW.organization_id
      AND user_id = NEW.user_id
      AND deleted_at IS NULL;
  END IF;

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
