-- Allow logged-in parents to redeem parent invite codes via the /app/join page.
-- Also standardizes new parent invite codes to 8-char uppercase format (folding in
-- the fix from the prior fix_parent_invite_code_length migration).

-- 1. Fix parent invite code default to 8-char uppercase without post-sanitization shrinkage
ALTER TABLE public.parent_invites
  ALTER COLUMN code
  SET DEFAULT upper(encode(gen_random_bytes(4), 'hex'));

-- 2. Create redeem_parent_invite RPC
-- Mirrors redeem_org_invite but checks parent_invites table.
-- Called from the /app/join page when org and enterprise RPCs don't find the code.
CREATE OR REPLACE FUNCTION public.redeem_parent_invite(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invite     record;
  v_org        record;
  v_existing   record;
  v_user_id    uuid;
  v_user_email text;
  v_claimed    record;
  v_parent     record;
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
      -- Reactivate revoked user with parent role
      UPDATE public.user_organization_roles
      SET status = 'active', role = 'parent'::public.user_role
      WHERE user_id = v_user_id
        AND organization_id = v_invite.organization_id;

      -- Atomically claim the invite
      UPDATE public.parent_invites
      SET status = 'accepted', accepted_at = now()
      WHERE id = v_invite.id AND status = 'pending';

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

  -- Atomically claim the invite (prevents double-redemption)
  UPDATE public.parent_invites
  SET status = 'accepted', accepted_at = now()
  WHERE id = v_invite.id AND status = 'pending'
  RETURNING * INTO v_claimed;

  IF v_claimed IS NULL THEN
    -- Another request claimed it first
    RETURN jsonb_build_object('success', false, 'error', 'This invite has already been used');
  END IF;

  -- Upsert parent record: reuse existing non-deleted record for this org+user if present
  SELECT * INTO v_parent
  FROM public.parents
  WHERE organization_id = v_invite.organization_id
    AND user_id = v_user_id
    AND deleted_at IS NULL;

  IF v_parent IS NULL AND v_user_email IS NOT NULL THEN
    -- Also check by email (admin may have pre-created a parent record)
    SELECT * INTO v_parent
    FROM public.parents
    WHERE organization_id = v_invite.organization_id
      AND lower(email) = lower(v_user_email)
      AND deleted_at IS NULL;

    IF v_parent IS NOT NULL THEN
      -- Link existing record to this auth user
      UPDATE public.parents
      SET user_id = v_user_id, updated_at = now()
      WHERE id = v_parent.id;
    END IF;
  END IF;

  IF v_parent IS NULL THEN
    -- Create new parent record using auth user's email and metadata
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

  -- Grant org membership with parent role, active status
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
