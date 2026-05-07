-- Harden claim_alumni_profiles by removing caller-supplied parameters.
--
-- Prior signature claim_alumni_profiles(p_user_id uuid, p_email text) accepted
-- both values from the client. Even though it verified
-- lower(auth.users.email WHERE id=p_user_id) = lower(p_email), an authenticated
-- attacker who knew another user's id + email could trigger the RPC for that
-- victim. Memberships still landed on the victim (no privilege escalation),
-- but the cross-user input surface was unnecessary.
--
-- New signature claim_alumni_profiles() takes no arguments and derives the
-- subject from auth.uid() + auth.users.email. SECURITY DEFINER is preserved
-- so the function can read alumni rows + insert UORs across orgs the caller
-- has no membership in (RLS would otherwise block).

DROP FUNCTION IF EXISTS public.claim_alumni_profiles(uuid, text);

CREATE OR REPLACE FUNCTION public.claim_alumni_profiles()
RETURNS TABLE (out_organization_id uuid, out_slug text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  IF v_email IS NULL OR btrim(v_email) = '' THEN
    RAISE EXCEPTION 'auth user has no email';
  END IF;

  INSERT INTO public.user_organization_roles (user_id, organization_id, role, status)
  SELECT
    v_user_id,
    a.organization_id,
    'alumni'::public.user_role,
    'active'::public.membership_status
  FROM public.alumni a
  WHERE a.user_id IS NULL
    AND a.deleted_at IS NULL
    AND a.email IS NOT NULL
    AND lower(a.email) = lower(v_email)
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  RETURN QUERY
  SELECT DISTINCT o.id, o.slug
  FROM public.user_organization_roles uor
  JOIN public.organizations o ON o.id = uor.organization_id
  JOIN public.alumni a ON a.organization_id = uor.organization_id
  WHERE uor.user_id = v_user_id
    AND uor.status = 'active'
    AND a.deleted_at IS NULL
    AND a.email IS NOT NULL
    AND lower(a.email) = lower(v_email)
    AND (a.user_id = v_user_id OR a.user_id IS NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_alumni_profiles() FROM public;
GRANT EXECUTE ON FUNCTION public.claim_alumni_profiles() TO authenticated;
