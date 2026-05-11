-- Atomic write pair for member role changes.
-- UPDATE user_organization_roles + INSERT org_member_role_audit run inside the
-- caller's single transaction. Any RAISE rolls back both statements, closing
-- the partial-success window the previous JS-side two-call path had.

CREATE OR REPLACE FUNCTION public.execute_member_role_change(
  p_organization_id uuid,
  p_target_user_id uuid,
  p_actor_user_id uuid,
  p_pending_action_id uuid,
  p_source text,
  p_previous_role public.user_role,
  p_new_role public.user_role,
  p_previous_status public.membership_status,
  p_new_status public.membership_status,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_audit_id uuid;
  v_member_exists boolean;
BEGIN
  IF p_source NOT IN ('manual', 'ai_pending_action') THEN
    RAISE EXCEPTION 'invalid_source' USING ERRCODE = '22023';
  END IF;

  UPDATE public.user_organization_roles
  SET role = p_new_role,
      status = p_new_status
  WHERE organization_id = p_organization_id
    AND user_id = p_target_user_id
    AND role = p_previous_role
    AND status = p_previous_status;

  IF NOT FOUND THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.user_organization_roles
      WHERE organization_id = p_organization_id
        AND user_id = p_target_user_id
    ) INTO v_member_exists;

    IF v_member_exists THEN
      RAISE EXCEPTION 'stale_member_role' USING ERRCODE = 'P0003';
    END IF;

    RAISE EXCEPTION 'member_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.org_member_role_audit (
    organization_id,
    target_user_id,
    actor_user_id,
    pending_action_id,
    source,
    previous_role,
    new_role,
    previous_status,
    new_status,
    reason
  ) VALUES (
    p_organization_id,
    p_target_user_id,
    p_actor_user_id,
    p_pending_action_id,
    p_source,
    p_previous_role,
    p_new_role,
    p_previous_status,
    p_new_status,
    p_reason
  )
  RETURNING id INTO v_audit_id;

  RETURN v_audit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_member_role_change(
  uuid, uuid, uuid, uuid, text,
  public.user_role, public.user_role,
  public.membership_status, public.membership_status,
  text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.execute_member_role_change(
  uuid, uuid, uuid, uuid, text,
  public.user_role, public.user_role,
  public.membership_status, public.membership_status,
  text
) TO service_role;
