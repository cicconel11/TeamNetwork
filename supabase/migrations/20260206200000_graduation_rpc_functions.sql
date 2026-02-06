-- Transactional RPC functions for graduation lifecycle.
-- Each function wraps multi-table mutations in an implicit transaction
-- so partial-failure states (e.g. role changed but graduated_at not set) cannot occur.

-- 1. transition_member_to_alumni
-- Called by the daily graduation cron when a member's expected_graduation_date has passed.
CREATE OR REPLACE FUNCTION public.transition_member_to_alumni(
  p_member_id uuid,
  p_user_id uuid,
  p_org_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_role text;
  v_graduated_at timestamptz;
  v_graduation_year integer;
BEGIN
  -- Guard: check current role
  SELECT role INTO v_current_role
  FROM public.user_organization_roles
  WHERE organization_id = p_org_id
    AND user_id = p_user_id;

  IF v_current_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Role row not found');
  END IF;

  -- Guard: skip admins
  IF v_current_role = 'admin' THEN
    RETURN jsonb_build_object('success', false, 'skipped', true, 'error', 'Admin members are not graduated');
  END IF;

  -- Guard: skip already-graduated
  SELECT graduated_at INTO v_graduated_at
  FROM public.members
  WHERE id = p_member_id;

  IF v_graduated_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;

  -- Guard: check alumni quota
  IF NOT public.can_add_alumni(p_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Alumni quota exceeded');
  END IF;

  -- Atomic: update role to alumni
  UPDATE public.user_organization_roles
  SET role = 'alumni'
  WHERE organization_id = p_org_id
    AND user_id = p_user_id;

  -- Atomic: mark graduated_at
  UPDATE public.members
  SET graduated_at = now()
  WHERE id = p_member_id;

  -- Copy graduation_year to alumni row (best-effort within transaction)
  SELECT graduation_year INTO v_graduation_year
  FROM public.members
  WHERE id = p_member_id;

  IF v_graduation_year IS NOT NULL THEN
    UPDATE public.alumni
    SET graduation_year = v_graduation_year
    WHERE user_id = p_user_id
      AND organization_id = p_org_id
      AND deleted_at IS NULL;
  END IF;

  -- The handle_org_member_sync trigger on user_organization_roles
  -- automatically creates the alumni record if needed.

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 2. reinstate_alumni_to_active
-- Called by the cron (reverse flow) and the manual reinstate API.
-- p_status defaults to 'active' for cron; the manual API passes 'pending'.
CREATE OR REPLACE FUNCTION public.reinstate_alumni_to_active(
  p_member_id uuid,
  p_user_id uuid,
  p_org_id uuid,
  p_status text DEFAULT 'active'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_role text;
BEGIN
  -- Guard: check current role
  SELECT role INTO v_current_role
  FROM public.user_organization_roles
  WHERE organization_id = p_org_id
    AND user_id = p_user_id;

  IF v_current_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Role row not found');
  END IF;

  -- Guard: skip admins
  IF v_current_role = 'admin' THEN
    RETURN jsonb_build_object('success', false, 'skipped', true, 'error', 'Admin members cannot be reinstated');
  END IF;

  -- Guard: skip already-active members
  IF v_current_role = 'active_member' THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;

  -- Atomic: clear graduation tracking
  UPDATE public.members
  SET graduated_at = NULL,
      graduation_warning_sent_at = NULL
  WHERE id = p_member_id;

  -- Atomic: set role to active_member with requested status
  UPDATE public.user_organization_roles
  SET role = 'active_member',
      status = p_status
  WHERE organization_id = p_org_id
    AND user_id = p_user_id;

  -- Atomic: soft-delete alumni record
  UPDATE public.alumni
  SET deleted_at = now()
  WHERE organization_id = p_org_id
    AND user_id = p_user_id
    AND deleted_at IS NULL;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 3. revoke_graduated_member
-- Called when alumni quota is exceeded and member must be revoked instead of transitioning.
CREATE OR REPLACE FUNCTION public.revoke_graduated_member(
  p_member_id uuid,
  p_user_id uuid,
  p_org_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_role text;
  v_graduated_at timestamptz;
BEGIN
  -- Guard: check current role
  SELECT role INTO v_current_role
  FROM public.user_organization_roles
  WHERE organization_id = p_org_id
    AND user_id = p_user_id;

  IF v_current_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Role row not found');
  END IF;

  -- Guard: skip admins
  IF v_current_role = 'admin' THEN
    RETURN jsonb_build_object('success', false, 'skipped', true, 'error', 'Admin members are not revoked');
  END IF;

  -- Guard: skip already-graduated
  SELECT graduated_at INTO v_graduated_at
  FROM public.members
  WHERE id = p_member_id;

  IF v_graduated_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;

  -- Atomic: revoke access
  UPDATE public.user_organization_roles
  SET status = 'revoked'
  WHERE organization_id = p_org_id
    AND user_id = p_user_id;

  -- Atomic: mark graduated_at
  UPDATE public.members
  SET graduated_at = now()
  WHERE id = p_member_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
