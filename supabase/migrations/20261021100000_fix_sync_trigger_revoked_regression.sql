-- Fix regression from 20261015100000_sync_member_restore_on_reapproval which
-- removed the revoked-status early-return and SET search_path = '' from
-- handle_org_member_sync.  When an admin revokes a member, the trigger tried
-- to cast 'revoked' to member_status (which only has active/inactive/pending),
-- causing a DB error and a 500 response.
--
-- This migration merges:
--   • Revoked early-return + soft-delete (from 20260631 / 20260803)
--   • Pending-skip guard (from 20260803)
--   • Identity hardening — btrim/NULLIF/full_name fallback (from 20260803)
--   • Restore-on-reapproval — ORDER BY deleted_at NULLS FIRST, clear
--     deleted_at when status = 'active' (from 20261015)
--   • SET search_path = '' (from 20260803)

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
  -- ── Revoked: soft-delete related records and exit ─────────────────────
  -- 'revoked' is not a valid member_status enum value, so we must not
  -- fall through to the normal sync path which casts to that enum.
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

  -- ── Pending: skip directory sync until approved ───────────────────────
  -- Covers new INSERT with pending AND revoked→pending UPDATE path.
  -- The normal approval UPDATE (pending → active) is NOT caught here,
  -- so it correctly syncs to members/alumni/parents when an admin approves.
  IF NEW.status = 'pending' AND (
    TG_OP = 'INSERT'
    OR (TG_OP = 'UPDATE' AND OLD.status = 'revoked')
  ) THEN
    RETURN NEW;
  END IF;

  -- ── Resolve identity from auth.users ──────────────────────────────────
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

  -- ── 1. Sync to public.members ─────────────────────────────────────────
  -- Prefer live row; fall back to soft-deleted row to restore on reapproval.
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

  -- ── 2. Sync to public.alumni if role is ALUMNI ────────────────────────
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

  -- ── 3. Sync to public.parents if role is PARENT ───────────────────────
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

  -- ── 4. Cleanup: role changed AWAY from alumni ─────────────────────────
  IF TG_OP = 'UPDATE' AND OLD.role = 'alumni' AND NEW.role != 'alumni' THEN
    UPDATE public.alumni
    SET deleted_at = now(), updated_at = now()
    WHERE organization_id = NEW.organization_id
      AND user_id = NEW.user_id
      AND deleted_at IS NULL;
  END IF;

  -- ── 5. Cleanup: role changed AWAY from parent ─────────────────────────
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
