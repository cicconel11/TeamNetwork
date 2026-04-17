-- Phase 0: Align can_view_announcement with app semantics (src/lib/announcements.ts).
-- Parents on members/active_members audiences, active_members same as members,
-- legacy DB role "member" treated like active_member, unknown audience => false,
-- individuals null-safe. Add batch RPC for TS to call one round-trip.

CREATE OR REPLACE FUNCTION public.can_view_announcement(announcement_row public.announcements)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  user_role text;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT uor.role INTO user_role
  FROM public.user_organization_roles uor
  WHERE uor.user_id = v_user_id
    AND uor.organization_id = announcement_row.organization_id
    AND uor.status = 'active'::public.membership_status
  LIMIT 1;

  IF user_role IS NULL THEN
    RETURN false;
  END IF;

  IF user_role = 'admin' THEN
    RETURN true;
  END IF;

  IF announcement_row.audience = 'all' THEN
    RETURN true;
  ELSIF announcement_row.audience IN ('members', 'active_members') THEN
    RETURN user_role IN ('active_member', 'parent', 'member');
  ELSIF announcement_row.audience = 'alumni' THEN
    RETURN user_role IN ('alumni', 'parent');
  ELSIF announcement_row.audience = 'individuals' THEN
    RETURN v_user_id = ANY(COALESCE(announcement_row.audience_user_ids, ARRAY[]::uuid[]));
  ELSE
    RETURN false;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.filter_announcement_ids_for_user(
  p_org_id uuid,
  p_announcement_ids uuid[]
)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT a.id
      FROM public.announcements a
      WHERE a.organization_id = p_org_id
        AND a.deleted_at IS NULL
        AND cardinality(COALESCE(p_announcement_ids, ARRAY[]::uuid[])) > 0
        AND a.id = ANY(p_announcement_ids)
        AND public.can_view_announcement(a)
      ORDER BY a.created_at DESC
    ),
    ARRAY[]::uuid[]
  );
$$;

REVOKE ALL ON FUNCTION public.filter_announcement_ids_for_user(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_announcement_ids_for_user(uuid, uuid[]) TO authenticated;
