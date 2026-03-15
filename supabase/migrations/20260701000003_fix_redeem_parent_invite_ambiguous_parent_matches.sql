-- Fix: reject ambiguous parent matches in redeem_parent_invite.
--
-- The prior migration added LIMIT 1 to duplicate-prone parents lookups so the
-- function no longer raised on duplicate rows. That avoided hard failures, but
-- it also allowed silent mis-linking when an organization has multiple active
-- parent records for the same guardian email or user.
--
-- Fix: detect 2+ matching non-deleted parent rows and fail closed with a
-- handled JSON error before claiming the invite or changing membership state.

CREATE OR REPLACE FUNCTION public.redeem_parent_invite(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invite                  record;
  v_org                     record;
  v_existing                record;
  v_user_id                 uuid;
  v_user_email              text;
  v_claimed                 record;
  v_parent                  record;
  v_parent_match_count      integer;
  v_parent_match_id         uuid;
  v_ambiguous_parent_error  constant text := 'Multiple parent records match this account. Please contact your organization admin.';
BEGIN
  v_user_id := auth.uid();

  -- Must be authenticated
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'You must be logged in to redeem an invite');
  END IF;

  -- Look up the user's email from auth.users
  SELECT email INTO v_user_email
  FROM auth.users
  WHERE id = v_user_id;

  -- Find invite by code (case-insensitive, trimmed)
  SELECT * INTO v_invite
  FROM public.parent_invites
  WHERE upper(code) = upper(trim(p_code))
    AND status = 'pending';

  IF v_invite IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid invite code');
  END IF;

  -- Check if invite has expired
  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'This invite has expired');
  END IF;

  -- Get the organization
  SELECT * INTO v_org
  FROM public.organizations
  WHERE id = v_invite.organization_id;

  IF v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization not found');
  END IF;

  -- Check if user already has a membership in this org
  SELECT * INTO v_existing
  FROM public.user_organization_roles
  WHERE user_id = v_user_id
    AND organization_id = v_invite.organization_id;

  IF v_existing IS NOT NULL THEN
    IF v_existing.status = 'revoked' THEN
      -- Resolve an existing parent row before claiming the invite so ambiguous
      -- duplicates fail closed without consuming the invite or reactivating the user.
      SELECT count(*)::integer, min(id)
      INTO v_parent_match_count, v_parent_match_id
      FROM (
        SELECT id
        FROM public.parents
        WHERE organization_id = v_invite.organization_id
          AND user_id = v_user_id
          AND deleted_at IS NULL
        LIMIT 2
      ) matched_parents;

      IF v_parent_match_count > 1 THEN
        RETURN jsonb_build_object('success', false, 'error', v_ambiguous_parent_error);
      END IF;

      IF v_parent_match_count = 1 THEN
        SELECT * INTO v_parent
        FROM public.parents
        WHERE id = v_parent_match_id;
      END IF;

      IF v_parent IS NULL AND v_user_email IS NOT NULL THEN
        SELECT count(*)::integer, min(id)
        INTO v_parent_match_count, v_parent_match_id
        FROM (
          SELECT id
          FROM public.parents
          WHERE organization_id = v_invite.organization_id
            AND lower(email) = lower(v_user_email)
            AND deleted_at IS NULL
          LIMIT 2
        ) matched_parents;

        IF v_parent_match_count > 1 THEN
          RETURN jsonb_build_object('success', false, 'error', v_ambiguous_parent_error);
        END IF;

        IF v_parent_match_count = 1 THEN
          SELECT * INTO v_parent
          FROM public.parents
          WHERE id = v_parent_match_id;
        END IF;
      END IF;

      -- Atomically claim the invite after ambiguity checks pass.
      UPDATE public.parent_invites
      SET status = 'accepted', accepted_at = now()
      WHERE id = v_invite.id AND status = 'pending'
      RETURNING * INTO v_claimed;

      IF v_claimed IS NULL THEN
        -- Another concurrent request already claimed this invite
        RETURN jsonb_build_object('success', false, 'error', 'This invite has already been used');
      END IF;

      -- Reactivate revoked user with parent role only after the invite is secured.
      UPDATE public.user_organization_roles
      SET status = 'active', role = 'parent'::public.user_role
      WHERE user_id = v_user_id
        AND organization_id = v_invite.organization_id;

      IF v_parent IS NOT NULL AND v_parent.user_id IS DISTINCT FROM v_user_id THEN
        -- Link existing record to this auth user.
        UPDATE public.parents
        SET user_id = v_user_id, updated_at = now()
        WHERE id = v_parent.id;
      END IF;

      IF v_parent IS NULL THEN
        -- Create new parent record using auth user's email and metadata.
        INSERT INTO public.parents (organization_id, user_id, email, first_name, last_name)
        VALUES (
          v_invite.organization_id,
          v_user_id,
          v_user_email,
          coalesce(
            (SELECT raw_user_meta_data ->> 'first_name' FROM auth.users WHERE id = v_user_id),
            split_part(coalesce(v_user_email, ''), '@', 1)
          ),
          coalesce(
            (SELECT raw_user_meta_data ->> 'last_name' FROM auth.users WHERE id = v_user_id),
            ''
          )
        );
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'organization_id', v_invite.organization_id,
        'slug', v_org.slug,
        'name', v_org.name,
        'role', 'parent',
        'pending_approval', false
      );
    END IF;

    -- Already active member (any role)
    RETURN jsonb_build_object(
      'success', true,
      'organization_id', v_invite.organization_id,
      'slug', v_org.slug,
      'name', v_org.name,
      'already_member', true,
      'status', v_existing.status
    );
  END IF;

  -- Resolve an existing parent row before claiming the invite so ambiguous
  -- duplicates fail closed without consuming the invite.
  SELECT count(*)::integer, min(id)
  INTO v_parent_match_count, v_parent_match_id
  FROM (
    SELECT id
    FROM public.parents
    WHERE organization_id = v_invite.organization_id
      AND user_id = v_user_id
      AND deleted_at IS NULL
    LIMIT 2
  ) matched_parents;

  IF v_parent_match_count > 1 THEN
    RETURN jsonb_build_object('success', false, 'error', v_ambiguous_parent_error);
  END IF;

  IF v_parent_match_count = 1 THEN
    SELECT * INTO v_parent
    FROM public.parents
    WHERE id = v_parent_match_id;
  END IF;

  IF v_parent IS NULL AND v_user_email IS NOT NULL THEN
    SELECT count(*)::integer, min(id)
    INTO v_parent_match_count, v_parent_match_id
    FROM (
      SELECT id
      FROM public.parents
      WHERE organization_id = v_invite.organization_id
        AND lower(email) = lower(v_user_email)
        AND deleted_at IS NULL
      LIMIT 2
    ) matched_parents;

    IF v_parent_match_count > 1 THEN
      RETURN jsonb_build_object('success', false, 'error', v_ambiguous_parent_error);
    END IF;

    IF v_parent_match_count = 1 THEN
      SELECT * INTO v_parent
      FROM public.parents
      WHERE id = v_parent_match_id;
    END IF;
  END IF;

  -- Atomically claim the invite after ambiguity checks pass.
  UPDATE public.parent_invites
  SET status = 'accepted', accepted_at = now()
  WHERE id = v_invite.id AND status = 'pending'
  RETURNING * INTO v_claimed;

  IF v_claimed IS NULL THEN
    -- Another request claimed it first
    RETURN jsonb_build_object('success', false, 'error', 'This invite has already been used');
  END IF;

  IF v_parent IS NOT NULL AND v_parent.user_id IS DISTINCT FROM v_user_id THEN
    -- Link existing record to this auth user.
    UPDATE public.parents
    SET user_id = v_user_id, updated_at = now()
    WHERE id = v_parent.id;
  END IF;

  IF v_parent IS NULL THEN
    -- Create new parent record using auth user's email and metadata.
    INSERT INTO public.parents (organization_id, user_id, email, first_name, last_name)
    VALUES (
      v_invite.organization_id,
      v_user_id,
      v_user_email,
      coalesce(
        (SELECT raw_user_meta_data ->> 'first_name' FROM auth.users WHERE id = v_user_id),
        split_part(coalesce(v_user_email, ''), '@', 1)
      ),
      coalesce(
        (SELECT raw_user_meta_data ->> 'last_name' FROM auth.users WHERE id = v_user_id),
        ''
      )
    );
  END IF;

  -- Grant org membership with parent role, active status.
  INSERT INTO public.user_organization_roles (user_id, organization_id, role, status)
  VALUES (v_user_id, v_invite.organization_id, 'parent'::public.user_role, 'active');

  RETURN jsonb_build_object(
    'success', true,
    'organization_id', v_invite.organization_id,
    'slug', v_org.slug,
    'name', v_org.name,
    'role', 'parent',
    'pending_approval', false
  );
END;
$$;
