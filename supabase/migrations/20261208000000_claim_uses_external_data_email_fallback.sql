-- Claim-flow defense in depth: fall back to the last-imported email snapshot
-- in alumni_external_ids.external_data when alumni.email is NULL.
--
-- Background:
--   A Blackbaud /emailaddresses sub-resource 5xx during sync used to overwrite
--   alumni.email with NULL (root cause fixed in the same PR by preserving
--   undefined fields at the writer). Until every sync run lands and re-fills
--   transiently-nulled rows, an alumni who lands on /auth/claim with a
--   verified OTP would match zero rows and bounce to /app/join.
--
--   alumni_external_ids.external_data is the "last successful import" snapshot
--   (storage.ts writes it on every successful constituent upsert). The
--   snapshot retains the previously-imported email even if the current alumni
--   row was transiently nulled. Use it as a fallback so the claim succeeds.
--
-- Scope:
--   1. Recreate claim_alumni_profiles() with a LEFT JOIN onto
--      alumni_external_ids; match on lower(coalesce(a.email, aei_email)).
--      Primary join still takes precedence when a.email is populated.
--   2. Recreate handle_org_member_sync() with the same fallback on the
--      alumni email-keyed lookup arm (lines 180-193 of the prior version).
--      Members + parents arms unchanged — only alumni rows carry the
--      external_data snapshot.
--
-- Idempotent: CREATE OR REPLACE; safe to re-run.

-- ──────────────────────────────────────────────────────────────────────
-- 1. claim_alumni_profiles() — RPC called from server action after OTP
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_alumni_profiles()
RETURNS TABLE (out_organization_id uuid, out_slug text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  IF v_email IS NULL OR btrim(v_email) = '' THEN
    RAISE EXCEPTION 'auth user has no email';
  END IF;

  -- Grant membership for every unlinked alumni whose email matches the
  -- verified session user's email. Primary match: alumni.email. Fallback
  -- match: the last successfully imported email snapshot in
  -- alumni_external_ids.external_data->>'email', for rows whose alumni.email
  -- is currently NULL (e.g. transient Blackbaud sub-resource failure).
  INSERT INTO public.user_organization_roles (user_id, organization_id, role, status)
  SELECT
    v_user_id,
    a.organization_id,
    'alumni'::public.user_role,
    'active'::public.membership_status
  FROM public.alumni a
  LEFT JOIN public.alumni_external_ids aei ON aei.alumni_id = a.id
  WHERE a.user_id IS NULL
    AND a.deleted_at IS NULL
    AND (
      (a.email IS NOT NULL AND lower(a.email) = lower(v_email))
      OR (
        a.email IS NULL
        AND aei.external_data IS NOT NULL
        AND aei.external_data->>'email' IS NOT NULL
        AND lower(aei.external_data->>'email') = lower(v_email)
      )
    )
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  -- Return the orgs the user is now an active member of where an alumni row
  -- existed for them. Same fallback applies on the read.
  RETURN QUERY
  SELECT DISTINCT o.id, o.slug
  FROM public.user_organization_roles uor
  JOIN public.organizations o ON o.id = uor.organization_id
  JOIN public.alumni a ON a.organization_id = uor.organization_id
  LEFT JOIN public.alumni_external_ids aei ON aei.alumni_id = a.id
  WHERE uor.user_id = v_user_id
    AND uor.status = 'active'
    AND a.deleted_at IS NULL
    AND (
      (a.email IS NOT NULL AND lower(a.email) = lower(v_email))
      OR (
        a.email IS NULL
        AND aei.external_data IS NOT NULL
        AND aei.external_data->>'email' IS NOT NULL
        AND lower(aei.external_data->>'email') = lower(v_email)
      )
    )
    AND (a.user_id = v_user_id OR a.user_id IS NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_alumni_profiles() FROM public;
GRANT EXECUTE ON FUNCTION public.claim_alumni_profiles() TO authenticated;

-- ──────────────────────────────────────────────────────────────────────
-- 2. handle_org_member_sync() — trigger that fires after UOR insert
-- ──────────────────────────────────────────────────────────────────────
-- Only the alumni arm changes (gain external_data fallback). Members and
-- parents arms are reproduced verbatim from 20261103000000.
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
  -- Alumni lookup gains a second email-keyed arm using the last-imported
  -- email snapshot in alumni_external_ids.external_data, used only when
  -- alumni.email is NULL (transient sync nulled the column).
  IF NEW.role = 'alumni' THEN
    SELECT a.id INTO v_alumni_id
    FROM public.alumni a
    LEFT JOIN public.alumni_external_ids aei ON aei.alumni_id = a.id
    WHERE a.organization_id = NEW.organization_id
      AND (
        a.user_id = NEW.user_id
        OR (
          v_user_email IS NOT NULL
          AND a.email IS NOT NULL
          AND lower(a.email) = lower(v_user_email)
          AND a.deleted_at IS NULL
        )
        OR (
          v_user_email IS NOT NULL
          AND a.email IS NULL
          AND a.deleted_at IS NULL
          AND aei.external_data IS NOT NULL
          AND aei.external_data->>'email' IS NOT NULL
          AND lower(aei.external_data->>'email') = lower(v_user_email)
        )
      )
    ORDER BY a.deleted_at NULLS FIRST, a.created_at DESC
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
