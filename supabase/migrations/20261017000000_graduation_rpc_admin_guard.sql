-- Guard graduation RPCs against unauthorized authenticated callers.
--
-- Prior versions ran SECURITY DEFINER without verifying the caller is
-- an admin of the target org. The only intended callers are:
--   1. The daily graduation cron (uses the service role, auth.uid() IS NULL)
--   2. The manual reinstate API route (already gates on admin role at the
--      app layer, but defense-in-depth belongs at the DB layer too)
--
-- Fix: when auth.uid() is present (i.e. the call originates from a user
-- JWT rather than the service role), require admin role in the target org.
-- Service-role calls retain their existing behavior.

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
  v_caller uuid;
  v_current_role text;
  v_graduated_at timestamptz;
  v_graduation_year integer;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NOT NULL AND NOT public.is_org_admin(p_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Forbidden');
  END IF;

  SELECT role INTO v_current_role
  FROM public.user_organization_roles
  WHERE organization_id = p_org_id
    AND user_id = p_user_id;

  IF v_current_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Role row not found');
  END IF;

  IF v_current_role = 'admin' THEN
    RETURN jsonb_build_object('success', false, 'skipped', true, 'error', 'Admin members are not graduated');
  END IF;

  SELECT graduated_at INTO v_graduated_at
  FROM public.members
  WHERE id = p_member_id;

  IF v_graduated_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;

  IF NOT public.can_add_alumni(p_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Alumni quota exceeded');
  END IF;

  UPDATE public.user_organization_roles
  SET role = 'alumni'
  WHERE organization_id = p_org_id
    AND user_id = p_user_id;

  UPDATE public.members
  SET graduated_at = now()
  WHERE id = p_member_id;

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

  RETURN jsonb_build_object('success', true);
END;
$$;

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
  v_caller uuid;
  v_current_role text;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NOT NULL AND NOT public.is_org_admin(p_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Forbidden');
  END IF;

  SELECT role INTO v_current_role
  FROM public.user_organization_roles
  WHERE organization_id = p_org_id
    AND user_id = p_user_id;

  IF v_current_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Role row not found');
  END IF;

  IF v_current_role = 'admin' THEN
    RETURN jsonb_build_object('success', false, 'skipped', true, 'error', 'Admin members cannot be reinstated');
  END IF;

  IF v_current_role = 'active_member' THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;

  UPDATE public.members
  SET graduated_at = NULL,
      graduation_warning_sent_at = NULL
  WHERE id = p_member_id;

  UPDATE public.user_organization_roles
  SET role = 'active_member',
      status = p_status
  WHERE organization_id = p_org_id
    AND user_id = p_user_id;

  UPDATE public.alumni
  SET deleted_at = now()
  WHERE organization_id = p_org_id
    AND user_id = p_user_id
    AND deleted_at IS NULL;

  RETURN jsonb_build_object('success', true);
END;
$$;

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
  v_caller uuid;
  v_current_role text;
  v_graduated_at timestamptz;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NOT NULL AND NOT public.is_org_admin(p_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Forbidden');
  END IF;

  SELECT role INTO v_current_role
  FROM public.user_organization_roles
  WHERE organization_id = p_org_id
    AND user_id = p_user_id;

  IF v_current_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Role row not found');
  END IF;

  IF v_current_role = 'admin' THEN
    RETURN jsonb_build_object('success', false, 'skipped', true, 'error', 'Admin members are not revoked');
  END IF;

  SELECT graduated_at INTO v_graduated_at
  FROM public.members
  WHERE id = p_member_id;

  IF v_graduated_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;

  UPDATE public.user_organization_roles
  SET status = 'revoked'
  WHERE organization_id = p_org_id
    AND user_id = p_user_id;

  UPDATE public.members
  SET graduated_at = now()
  WHERE id = p_member_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Lock down default PUBLIC execute: only authenticated (and service role,
-- which is unaffected by REVOKE PUBLIC) may invoke these RPCs. Cron paths
-- use the service role and are unaffected; the manual admin API uses the
-- service role too. Direct client calls require the in-function admin guard.
REVOKE ALL ON FUNCTION public.transition_member_to_alumni(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transition_member_to_alumni(uuid, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.reinstate_alumni_to_active(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reinstate_alumni_to_active(uuid, uuid, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.revoke_graduated_member(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_graduated_member(uuid, uuid, uuid) TO authenticated;
