-- Make handle_org_member_sync match member + alumni rows on email
-- case-insensitively (parents branch already does), AND respect
-- deleted_at IS NULL on those email-keyed lookups.
--
-- Background:
--   Imported alumni/member rows (Blackbaud, CSV, LinkedIn) carry mixed-case
--   emails. auth.users.email is normalized to lowercase. The previous
--   email = v_user_email comparison silently failed to link an imported row
--   to its claiming user when casing differed, leaving alumni.user_id NULL
--   forever (the trigger never re-runs for that user).
--
--   The members + alumni branches also lacked a deleted_at IS NULL filter on
--   the email-keyed lookup arm. Without it, the case-insensitive change can
--   resurrect a soft-deleted row whose email casing now matches the claimer.
--
-- This migration:
--   1. Redeclares public.handle_org_member_sync() with:
--      - members + alumni email lookups using lower(email) = lower(v_user_email)
--      - members + alumni email lookups gated on deleted_at IS NULL
--      - parents branch unchanged (already correct)
--   2. Runs an idempotent one-time reconciliation populating
--      alumni.user_id from the matching members row, where casing
--      previously prevented linkage. Bounded to a.user_id IS NULL — safe
--      to re-apply on rollback / re-run.
--
-- Supersedes: 20261021100000_fix_sync_trigger_revoked_regression.sql

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
  -- Email-keyed arm matches case-insensitively and skips soft-deleted rows.
  -- user_id arm still considers soft-deleted rows so revoked → reapproval
  -- can restore the same row (deleted_at NULLS FIRST in ORDER BY).
  SELECT id INTO v_member_id
  FROM public.members
  WHERE organization_id = NEW.organization_id
    AND (
      user_id = NEW.user_id
      OR (
        v_user_email IS NOT NULL
        AND email IS NOT NULL
        AND lower(email) = lower(v_user_email)
        AND deleted_at IS NULL
      )
    )
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
      AND (
        user_id = NEW.user_id
        OR (
          v_user_email IS NOT NULL
          AND email IS NOT NULL
          AND lower(email) = lower(v_user_email)
          AND deleted_at IS NULL
        )
      )
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

-- ── One-time historical reconciliation ──────────────────────────────────
-- Backfill alumni.user_id where a matching members row already has it.
-- Idempotent (filtered to a.user_id IS NULL); safe to re-run.
-- Pattern follows 20260714000000_member_identity_hardening.sql:228-248.
--
-- Ambiguity guard: skip rows where more than one active alumni or more than
-- one active members row share the same normalized email in the same org.
-- The trigger's INSERT/UPDATE path resolves ambiguity via ORDER BY ... LIMIT 1;
-- a bulk UPDATE has no equivalent tiebreaker, so we refuse to backfill rather
-- than link the wrong row. Operators can dedupe and re-run.
UPDATE public.alumni a
SET user_id = m.user_id,
    updated_at = now()
FROM public.members m
WHERE a.organization_id = m.organization_id
  AND a.user_id IS NULL
  AND m.user_id IS NOT NULL
  AND a.deleted_at IS NULL
  AND m.deleted_at IS NULL
  AND a.email IS NOT NULL
  AND m.email IS NOT NULL
  AND lower(a.email) = lower(m.email)
  AND NOT EXISTS (
    SELECT 1 FROM public.alumni a2
    WHERE a2.organization_id = a.organization_id
      AND a2.deleted_at IS NULL
      AND a2.email IS NOT NULL
      AND lower(a2.email) = lower(a.email)
      AND a2.id <> a.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.members m2
    WHERE m2.organization_id = m.organization_id
      AND m2.deleted_at IS NULL
      AND m2.email IS NOT NULL
      AND lower(m2.email) = lower(m.email)
      AND m2.id <> m.id
  );
