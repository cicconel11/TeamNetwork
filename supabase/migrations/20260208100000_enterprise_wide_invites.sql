-- =====================================================
-- Migration: Enterprise-Wide Invites
-- Date: 2026-02-08
-- Purpose: Allow enterprise invites without a specific organization.
--   When organization_id is NULL, users choose which org to join.
-- =====================================================

-- =====================================================
-- Part 1: Allow NULL organization_id on enterprise_invites
-- =====================================================

ALTER TABLE public.enterprise_invites
  ALTER COLUMN organization_id DROP NOT NULL;

-- =====================================================
-- Part 2: Update create_enterprise_invite to accept optional org_id
-- =====================================================

CREATE OR REPLACE FUNCTION public.create_enterprise_invite(
  p_enterprise_id uuid,
  p_organization_id uuid DEFAULT NULL,
  p_role text DEFAULT 'active_member',
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

  -- If organization_id is provided, verify it belongs to this enterprise
  IF p_organization_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.organizations
      WHERE id = p_organization_id
        AND enterprise_id = p_enterprise_id
    ) THEN
      RAISE EXCEPTION 'Organization does not belong to this enterprise';
    END IF;
  END IF;

  -- Validate role
  IF p_role NOT IN ('admin', 'active_member', 'alumni') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  -- Respect alumni quota for alumni invites (only when org is specified)
  IF p_role = 'alumni' AND p_organization_id IS NOT NULL THEN
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
-- Part 3: Update redeem_enterprise_invite to handle NULL org_id
-- =====================================================

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
  v_orgs jsonb;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Must be authenticated';
  END IF;

  -- Find the invite by code or token (lock row to prevent race conditions)
  SELECT * INTO v_invite
  FROM public.enterprise_invites
  WHERE (code = upper(p_code_or_token) OR token = p_code_or_token)
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
    AND (uses_remaining IS NULL OR uses_remaining > 0)
  FOR UPDATE;

  IF v_invite IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid, expired, or fully used invite code'
    );
  END IF;

  -- If invite has no specific org, return available orgs for user to choose
  IF v_invite.organization_id IS NULL THEN
    SELECT jsonb_agg(jsonb_build_object(
      'id', o.id,
      'name', o.name,
      'slug', o.slug,
      'description', o.description
    ) ORDER BY o.name)
    INTO v_orgs
    FROM public.organizations o
    WHERE o.enterprise_id = v_invite.enterprise_id
      AND NOT EXISTS (
        SELECT 1 FROM public.user_organization_roles ur
        WHERE ur.user_id = v_user_id
          AND ur.organization_id = o.id
          AND ur.status IN ('active', 'pending')
      );

    RETURN jsonb_build_object(
      'success', true,
      'status', 'choose_org',
      'enterprise_id', v_invite.enterprise_id,
      'role', v_invite.role,
      'organizations', COALESCE(v_orgs, '[]'::jsonb),
      'invite_token', v_invite.token
    );
  END IF;

  -- Org-specific invite: existing behavior
  -- Check existing membership status
  SELECT status INTO v_existing_status
  FROM public.user_organization_roles
  WHERE user_id = v_user_id AND organization_id = v_invite.organization_id;

  IF v_existing_status = 'revoked' THEN
    -- Restore revoked user with new role from invite
    UPDATE public.user_organization_roles
    SET status = 'active', role = v_invite.role
    WHERE user_id = v_user_id AND organization_id = v_invite.organization_id;
  ELSIF v_existing_status IS NOT NULL THEN
    -- User already has active or pending role
    RETURN jsonb_build_object(
      'success', false,
      'error', 'You already have a role in this organization'
    );
  ELSE
    -- Respect alumni quota for alumni invites
    IF v_invite.role = 'alumni' THEN
      PERFORM public.assert_alumni_quota(v_invite.organization_id);
    END IF;

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

  -- Get org details
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
-- Part 4: New RPC to complete enterprise-wide invite redemption
-- =====================================================

CREATE OR REPLACE FUNCTION public.complete_enterprise_invite_redemption(
  p_token text,
  p_organization_id uuid
)
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

  -- Find the invite by token (must be enterprise-wide: organization_id IS NULL)
  -- Lock row to prevent race conditions on uses_remaining
  SELECT * INTO v_invite
  FROM public.enterprise_invites
  WHERE token = p_token
    AND organization_id IS NULL
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
    AND (uses_remaining IS NULL OR uses_remaining > 0)
  FOR UPDATE;

  IF v_invite IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid, expired, or fully used invite'
    );
  END IF;

  -- Verify the chosen organization belongs to this enterprise
  IF NOT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = p_organization_id
      AND enterprise_id = v_invite.enterprise_id
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Organization does not belong to this enterprise'
    );
  END IF;

  -- Check existing membership status
  SELECT status INTO v_existing_status
  FROM public.user_organization_roles
  WHERE user_id = v_user_id AND organization_id = p_organization_id;

  IF v_existing_status = 'revoked' THEN
    UPDATE public.user_organization_roles
    SET status = 'active', role = v_invite.role
    WHERE user_id = v_user_id AND organization_id = p_organization_id;
  ELSIF v_existing_status IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'You already have a role in this organization'
    );
  ELSE
    -- Respect alumni quota for alumni invites
    IF v_invite.role = 'alumni' THEN
      PERFORM public.assert_alumni_quota(p_organization_id);
    END IF;

    INSERT INTO public.user_organization_roles (
      user_id,
      organization_id,
      role,
      status
    ) VALUES (
      v_user_id,
      p_organization_id,
      v_invite.role,
      'active'
    );
  END IF;

  -- Get org details
  SELECT name, slug INTO v_org_name, v_org_slug
  FROM public.organizations
  WHERE id = p_organization_id;

  -- Decrement uses if applicable
  IF v_invite.uses_remaining IS NOT NULL THEN
    UPDATE public.enterprise_invites
    SET uses_remaining = uses_remaining - 1
    WHERE id = v_invite.id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'organization_id', p_organization_id,
    'organization_name', v_org_name,
    'organization_slug', v_org_slug,
    'role', v_invite.role
  );
END;
$$;

-- =====================================================
-- Grant execute permissions
-- =====================================================

GRANT EXECUTE ON FUNCTION public.complete_enterprise_invite_redemption(text, uuid) TO authenticated;

-- =====================================================
-- Comments
-- =====================================================

COMMENT ON FUNCTION public.create_enterprise_invite IS
  'Creates an enterprise invite. When organization_id is NULL, creates an enterprise-wide invite where users choose their org.';

COMMENT ON FUNCTION public.redeem_enterprise_invite IS
  'Redeems an enterprise invite. For enterprise-wide invites (NULL org_id), returns choose_org status with available organizations.';

COMMENT ON FUNCTION public.complete_enterprise_invite_redemption IS
  'Completes redemption of an enterprise-wide invite by joining the user to a chosen organization.';

-- =====================================================
-- Part 5: Performance index for token-based lookups
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_enterprise_invites_token
  ON public.enterprise_invites(token)
  WHERE revoked_at IS NULL;
