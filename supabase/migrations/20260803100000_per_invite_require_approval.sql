-- Add per-invite approval override.
-- NULL = inherit from org setting, true = always require, false = never require.
ALTER TABLE public.organization_invites
  ADD COLUMN IF NOT EXISTS require_approval boolean DEFAULT NULL;

-- Drop old 4-param overload to prevent PostgreSQL function ambiguity
DROP FUNCTION IF EXISTS public.create_org_invite(uuid, text, int, timestamptz);

-- Recreate with 5 params (the only version)
CREATE OR REPLACE FUNCTION public.create_org_invite(
  p_organization_id uuid,
  p_role            text DEFAULT 'active_member',
  p_uses            int  DEFAULT NULL,
  p_expires_at      timestamptz DEFAULT NULL,
  p_require_approval boolean DEFAULT NULL
)
RETURNS public.organization_invites
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_code   text;
  v_token  text;
  v_result public.organization_invites;
BEGIN
  -- Verify caller is admin of the organization
  IF NOT public.is_org_admin(p_organization_id) THEN
    RAISE EXCEPTION 'Only organization admins can create invites';
  END IF;

  -- Validate role
  IF p_role NOT IN ('admin', 'active_member', 'alumni', 'parent') THEN
    RAISE EXCEPTION 'Invalid role. Must be admin, active_member, alumni, or parent';
  END IF;

  -- Respect alumni quota for alumni invites
  IF p_role = 'alumni' THEN
    PERFORM public.assert_alumni_quota(p_organization_id);
  END IF;

  -- Generate secure random code (8 chars, alphanumeric)
  v_code := upper(substr(
    replace(replace(replace(
      encode(gen_random_bytes(6), 'base64'),
      '/', ''), '+', ''), '=', ''),
    1, 8
  ));

  -- Generate secure token (URL-safe base64, 32 chars)
  v_token := replace(replace(replace(
    encode(gen_random_bytes(24), 'base64'),
    '/', '_'), '+', '-'), '=', '');

  INSERT INTO public.organization_invites (
    organization_id,
    code,
    token,
    role,
    uses_remaining,
    expires_at,
    created_by_user_id,
    require_approval
  ) VALUES (
    p_organization_id,
    v_code,
    v_token,
    p_role,
    p_uses,
    p_expires_at,
    auth.uid(),
    p_require_approval
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- Drop and recreate redeem_org_invite (not CREATE OR REPLACE) to force
-- PostgreSQL to recompile the row type for organization_invites, which now
-- includes the require_approval column. CREATE OR REPLACE reuses the cached
-- composite type and v_invite.require_approval silently resolves to NULL.
DROP FUNCTION IF EXISTS public.redeem_org_invite(text);

CREATE FUNCTION public.redeem_org_invite(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE
  v_invite public.organization_invites;
  v_org public.organizations;
  v_existing public.user_organization_roles;
  v_user_id uuid;
  v_new_status text;
  v_requires_approval boolean;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'You must be logged in to redeem an invite');
  END IF;

  -- Find invite by code OR token (lock row to prevent concurrent over-redemption)
  SELECT * INTO v_invite
  FROM public.organization_invites
  WHERE (upper(code) = upper(trim(p_code)) OR token = trim(p_code))
    AND revoked_at IS NULL
  FOR UPDATE;

  IF v_invite IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid invite code (not found)');
  END IF;

  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'This invite has expired');
  END IF;

  IF v_invite.uses_remaining IS NOT NULL AND v_invite.uses_remaining <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'This invite has no uses remaining');
  END IF;

  -- Fetch org (needed for approval flag and response fields)
  SELECT * INTO v_org FROM public.organizations WHERE id = v_invite.organization_id;

  -- Per-invite override takes precedence, then org-level setting
  v_requires_approval := COALESCE(v_invite.require_approval, v_org.require_invite_approval, false);

  v_new_status := CASE WHEN v_requires_approval THEN 'pending' ELSE 'active' END;

  -- Check if user already has a membership in this org
  SELECT * INTO v_existing
  FROM public.user_organization_roles
  WHERE user_id = v_user_id
    AND organization_id = v_invite.organization_id;

  IF v_existing IS NOT NULL THEN
    IF v_existing.status = 'revoked' THEN
      -- Revoked user rejoining: respect the approval setting
      UPDATE public.user_organization_roles
      SET status = v_new_status::public.membership_status,
          role = v_invite.role::public.user_role
      WHERE user_id = v_user_id
        AND organization_id = v_invite.organization_id;

      IF v_invite.uses_remaining IS NOT NULL THEN
        UPDATE public.organization_invites
        SET uses_remaining = uses_remaining - 1
        WHERE id = v_invite.id;
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'organization_id', v_invite.organization_id,
        'slug', v_org.slug,
        'name', v_org.name,
        'role', v_invite.role,
        'pending_approval', v_requires_approval
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'organization_id', v_invite.organization_id,
      'slug', v_org.slug,
      'name', v_org.name,
      'already_member', true,
      'status', v_existing.status
    );
  END IF;

  -- Insert new membership
  INSERT INTO public.user_organization_roles (user_id, organization_id, role, status)
  VALUES (v_user_id, v_invite.organization_id, v_invite.role::public.user_role, v_new_status::public.membership_status);

  IF v_invite.uses_remaining IS NOT NULL THEN
    UPDATE public.organization_invites
    SET uses_remaining = uses_remaining - 1
    WHERE id = v_invite.id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'organization_id', v_invite.organization_id,
    'slug', v_org.slug,
    'name', v_org.name,
    'role', v_invite.role,
    'pending_approval', v_requires_approval
  );
END;
$$;
