-- Admin-gated RPC to list pending org memberships with resolved identity.
-- Bypasses users_select RLS (which hides non-active rows) and the
-- handle_org_member_sync skip-pending guard, while keeping both unchanged.
-- Identity sourced from public.users, then auth.users (incl. raw_user_meta_data).

CREATE OR REPLACE FUNCTION public.get_pending_approvals(p_organization_id uuid)
RETURNS TABLE (
  user_id uuid,
  role public.user_role,
  status public.membership_status,
  created_at timestamptz,
  name text,
  email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_org_admin(p_organization_id) THEN
    RAISE EXCEPTION 'permission denied for organization %', p_organization_id
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    uor.user_id,
    uor.role,
    uor.status,
    uor.created_at,
    COALESCE(
      NULLIF(pu.name, ''),
      NULLIF(au.raw_user_meta_data->>'full_name', ''),
      NULLIF(
        TRIM(CONCAT_WS(' ',
          au.raw_user_meta_data->>'first_name',
          au.raw_user_meta_data->>'last_name'
        )),
        ''
      )
    ) AS name,
    COALESCE(NULLIF(pu.email, ''), au.email) AS email
  FROM public.user_organization_roles uor
  LEFT JOIN public.users pu ON pu.id = uor.user_id
  LEFT JOIN auth.users au ON au.id = uor.user_id
  WHERE uor.organization_id = p_organization_id
    AND uor.status = 'pending'
  ORDER BY uor.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_pending_approvals(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pending_approvals(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pending_approvals(uuid) TO authenticated;
