-- =====================================================
-- Migration: Enterprise Invite Fixes
-- Date: 2026-02-05
-- Purpose: Fix two backend gaps in enterprise invites:
--   1. Add alumni quota enforcement to create_enterprise_invite
--   2. Allow redeem_enterprise_invite to restore revoked users
-- =====================================================

-- =====================================================
-- Part 1: Update create_enterprise_invite with Alumni Quota Check
-- =====================================================
-- This matches the pattern used in create_org_invite (see 20260412093000_alumni_quota_enforcement.sql)
-- Alumni invites should respect the organization's alumni quota to prevent over-enrollment.

CREATE OR REPLACE FUNCTION public.create_enterprise_invite(
  p_enterprise_id uuid,
  p_organization_id uuid,
  p_role text,
  p_uses integer DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS public.enterprise_invites
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_code text;
  v_token text;
  v_invite public.enterprise_invites;
  v_user_id uuid;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Must be authenticated';
  END IF;

  -- Verify user is enterprise admin
  IF NOT EXISTS (
    SELECT 1 FROM public.user_enterprise_roles
    WHERE enterprise_id = p_enterprise_id
      AND user_id = v_user_id
      AND role IN ('owner', 'org_admin')
  ) THEN
    RAISE EXCEPTION 'Only enterprise owners and org_admins can create invites';
  END IF;

  -- Verify organization belongs to this enterprise
  IF NOT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = p_organization_id
      AND enterprise_id = p_enterprise_id
  ) THEN
    RAISE EXCEPTION 'Organization does not belong to this enterprise';
  END IF;

  -- Validate role
  IF p_role NOT IN ('admin', 'active_member', 'alumni') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  -- Respect alumni quota for alumni invites
  -- This prevents creating invites that would exceed the org's alumni limit
  IF p_role = 'alumni' THEN
    PERFORM public.assert_alumni_quota(p_organization_id);
  END IF;

  -- Generate secure code (8 chars, alphanumeric, no confusing chars)
  v_code := upper(substring(
    replace(replace(replace(encode(extensions.gen_random_bytes(6), 'base64'), '/', ''), '+', ''), '=', '')
    FROM 1 FOR 8
  ));

  -- Generate secure token (32 chars)
  v_token := encode(extensions.gen_random_bytes(24), 'base64');
  v_token := replace(replace(replace(v_token, '/', ''), '+', ''), '=', '');
  v_token := substring(v_token FROM 1 FOR 32);

  -- Insert the invite
  INSERT INTO public.enterprise_invites (
    enterprise_id,
    organization_id,
    code,
    token,
    role,
    uses_remaining,
    expires_at,
    created_by_user_id
  ) VALUES (
    p_enterprise_id,
    p_organization_id,
    v_code,
    v_token,
    p_role,
    p_uses,
    p_expires_at,
    v_user_id
  )
  RETURNING * INTO v_invite;

  RETURN v_invite;
END;
$$;

-- =====================================================
-- Part 2: Update redeem_enterprise_invite to Handle Revoked Users
-- =====================================================
-- The previous implementation rejected users with ANY existing role.
-- This update allows revoked users to rejoin with a new role from the invite,
-- while still rejecting users who already have active or pending status.

CREATE OR REPLACE FUNCTION public.redeem_enterprise_invite(p_code_or_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_invite public.enterprise_invites;
  v_user_id uuid;
  v_org_name text;
  v_org_slug text;
  v_existing_status text;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Must be authenticated';
  END IF;

  -- Find the invite by code or token
  SELECT * INTO v_invite
  FROM public.enterprise_invites
  WHERE (code = upper(p_code_or_token) OR token = p_code_or_token)
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
    AND (uses_remaining IS NULL OR uses_remaining > 0);

  IF v_invite IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid, expired, or fully used invite code'
    );
  END IF;

  -- Check existing membership status
  -- This allows revoked users to rejoin while blocking active/pending users
  SELECT status INTO v_existing_status
  FROM public.user_organization_roles
  WHERE user_id = v_user_id AND organization_id = v_invite.organization_id;

  IF v_existing_status = 'revoked' THEN
    -- Restore revoked user with new role from invite
    -- This gives users a second chance when re-invited
    UPDATE public.user_organization_roles
    SET status = 'active', role = v_invite.role
    WHERE user_id = v_user_id AND organization_id = v_invite.organization_id;
  ELSIF v_existing_status IS NOT NULL THEN
    -- User already has active or pending role - cannot use invite
    RETURN jsonb_build_object(
      'success', false,
      'error', 'You already have a role in this organization'
    );
  ELSE
    -- Get org details for response
    SELECT name, slug INTO v_org_name, v_org_slug
    FROM public.organizations
    WHERE id = v_invite.organization_id;

    -- Create new membership with active status (auto-approved for enterprise invites)
    INSERT INTO public.user_organization_roles (
      user_id,
      organization_id,
      role,
      status
    ) VALUES (
      v_user_id,
      v_invite.organization_id,
      v_invite.role,
      'active'
    );
  END IF;

  -- Get org details (needed for all paths including revoked restore)
  SELECT name, slug INTO v_org_name, v_org_slug
  FROM public.organizations
  WHERE id = v_invite.organization_id;

  -- Decrement uses if applicable
  IF v_invite.uses_remaining IS NOT NULL THEN
    UPDATE public.enterprise_invites
    SET uses_remaining = uses_remaining - 1
    WHERE id = v_invite.id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'organization_id', v_invite.organization_id,
    'organization_name', v_org_name,
    'organization_slug', v_org_slug,
    'role', v_invite.role
  );
END;
$$;

-- =====================================================
-- Comments
-- =====================================================

COMMENT ON FUNCTION public.create_enterprise_invite IS
  'Creates an enterprise invite for a sub-organization. Enforces alumni quota for alumni invites.';

COMMENT ON FUNCTION public.redeem_enterprise_invite IS
  'Redeems an enterprise invite code/token. Allows revoked users to rejoin with the new role.';
