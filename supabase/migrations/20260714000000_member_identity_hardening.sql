-- Harden member identity resolution for org membership sync and AI consumers.
-- Fixes linked members that currently land as first_name = 'Member', last_name = ''
-- even when auth/public user data has a real human name.

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

-- One-time repair for linked members that still carry placeholder identity.
UPDATE public.members AS m
SET
  first_name = split_part(btrim(u.name), ' ', 1),
  last_name = COALESCE(
    NULLIF(btrim(substr(btrim(u.name), length(split_part(btrim(u.name), ' ', 1)) + 1)), ''),
    ''
  ),
  updated_at = now()
FROM public.users AS u
WHERE m.user_id = u.id
  AND m.user_id IS NOT NULL
  AND m.deleted_at IS NULL
  AND (
    (COALESCE(btrim(m.first_name), '') = '' AND COALESCE(btrim(m.last_name), '') = '')
    OR (COALESCE(btrim(m.first_name), '') = 'Member' AND COALESCE(btrim(m.last_name), '') = '')
  )
  AND u.name IS NOT NULL
  AND btrim(u.name) <> ''
  AND btrim(u.name) <> 'Member'
  AND position('@' in btrim(u.name)) = 0;
