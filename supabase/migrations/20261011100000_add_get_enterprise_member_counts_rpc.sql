-- RPC function to get member counts for multiple enterprises efficiently
CREATE OR REPLACE FUNCTION public.get_enterprise_member_counts(enterprise_ids uuid[])
RETURNS TABLE(enterprise_id uuid, member_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    o.enterprise_id,
    COUNT(DISTINCT uor.user_id) as member_count
  FROM public.organizations o
  JOIN public.user_organization_roles uor ON uor.organization_id = o.id
  WHERE o.enterprise_id = ANY(enterprise_ids)
    AND uor.status = 'active'
  GROUP BY o.enterprise_id
$$;
