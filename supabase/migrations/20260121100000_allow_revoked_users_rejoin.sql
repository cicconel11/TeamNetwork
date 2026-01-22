-- Allow revoked users to rejoin an organization using a valid invite code
-- This enables easy re-onboarding of previously revoked members
CREATE OR REPLACE FUNCTION public.redeem_org_invite(p_code text)
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
BEGIN
  v_user_id := auth.uid();

  -- Must be authenticated
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'You must be logged in to redeem an invite');
  END IF;

  -- Find invite by code OR token
  SELECT * INTO v_invite
  FROM public.organization_invites
  WHERE (upper(code) = upper(trim(p_code)) OR token = trim(p_code))
    AND revoked_at IS NULL;

  IF v_invite IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid invite code (not found)');
  END IF;

  -- Check if invite has expired
  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'This invite has expired');
  END IF;

  -- Check if invite has uses remaining
  IF v_invite.uses_remaining IS NOT NULL AND v_invite.uses_remaining <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'This invite has no uses remaining');
  END IF;

  -- Check if user already has a membership in this org
  SELECT * INTO v_existing
  FROM public.user_organization_roles
  WHERE user_id = v_user_id
    AND organization_id = v_invite.organization_id;

  IF v_existing IS NOT NULL THEN
    SELECT * INTO v_org FROM public.organizations WHERE id = v_invite.organization_id;

    IF v_existing.status = 'revoked' THEN
      -- Reactivate the revoked user, preserving their original role to prevent privilege escalation
      UPDATE public.user_organization_roles
      SET status = 'active'
      WHERE user_id = v_user_id AND organization_id = v_invite.organization_id;

      -- Decrement uses_remaining if it's set
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
        'role', v_existing.role,
        'pending_approval', false
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

  -- Insert new membership with ACTIVE status (auto-approved via invite code)
  INSERT INTO public.user_organization_roles (user_id, organization_id, role, status)
  VALUES (v_user_id, v_invite.organization_id, v_invite.role::public.user_role, 'active');

  -- Decrement uses_remaining if it's set
  IF v_invite.uses_remaining IS NOT NULL THEN
    UPDATE public.organization_invites
    SET uses_remaining = uses_remaining - 1
    WHERE id = v_invite.id;
  END IF;

  SELECT * INTO v_org FROM public.organizations WHERE id = v_invite.organization_id;

  RETURN jsonb_build_object(
    'success', true,
    'organization_id', v_invite.organization_id,
    'slug', v_org.slug,
    'name', v_org.name,
    'role', v_invite.role,
    'pending_approval', false
  );
END;
$$;
