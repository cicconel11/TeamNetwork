-- claim_alumni_profiles(p_user_id uuid, p_email text)
--
-- Auto-grant org membership to a freshly OTP-verified user for every
-- admin-imported alumni row that matches their verified email.
--
-- Background:
--   Imported alumni rows (Blackbaud / CSV / LinkedIn) carry the future user's
--   email and a NULL user_id. Today they wait behind invite redemption. The
--   admin-import + email-verification combination IS the membership grant.
--
--   This RPC inserts user_organization_roles rows for each unlinked alumni
--   row matching the verified email. The existing handle_org_member_sync
--   trigger (case-insensitive after 20261103000000) then links alumni.user_id
--   and provisions members/profile data.
--
-- Safety:
--   - SECURITY DEFINER: caller has zero memberships, so RLS would block
--     cross-org alumni reads + UOR inserts. Defender verifies p_email ==
--     auth.users.email for p_user_id before doing anything.
--   - Email match is case-insensitive (lower(email) = lower(p_email)).
--   - Only matches alumni rows with user_id IS NULL AND deleted_at IS NULL.
--   - ON CONFLICT (user_id, organization_id) DO NOTHING for idempotency.
--   - Returns claimed orgs from BOTH (a) freshly-inserted rows AND
--     (b) pre-existing active memberships for orgs whose alumni row matches —
--     so re-running yields a stable result.

CREATE OR REPLACE FUNCTION public.claim_alumni_profiles(
  p_user_id uuid,
  p_email text
)
-- OUT params named with out_ prefix to avoid ambiguity with
-- user_organization_roles.organization_id in RETURN QUERY.
RETURNS TABLE (out_organization_id uuid, out_slug text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth_email text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  IF p_email IS NULL OR btrim(p_email) = '' THEN
    RAISE EXCEPTION 'p_email is required';
  END IF;

  SELECT email INTO v_auth_email FROM auth.users WHERE id = p_user_id;

  IF v_auth_email IS NULL THEN
    RAISE EXCEPTION 'auth user not found';
  END IF;

  IF lower(v_auth_email) <> lower(btrim(p_email)) THEN
    RAISE EXCEPTION 'email mismatch';
  END IF;

  -- Insert membership rows for every unlinked alumni row matching the
  -- verified email. Trigger handle_org_member_sync fires per insert and
  -- links alumni.user_id + populates members/profile data.
  INSERT INTO public.user_organization_roles (user_id, organization_id, role, status)
  SELECT
    p_user_id,
    a.organization_id,
    'alumni'::public.user_role,
    'active'::public.membership_status
  FROM public.alumni a
  WHERE a.user_id IS NULL
    AND a.deleted_at IS NULL
    AND a.email IS NOT NULL
    AND lower(a.email) = lower(btrim(p_email))
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  -- Return the orgs the user now has active membership in AND for which a
  -- (now-linked) alumni row exists. Stable across re-runs.
  -- Return orgs where the user now has ANY active membership AND a
  -- matching alumni row exists. Role filter is intentionally dropped:
  -- if the user was already an active admin / active_member of an org
  -- whose roster also lists them as alumni, the import semantically
  -- "claimed" too — redirect there instead of bouncing to /app/join.
  RETURN QUERY
  SELECT DISTINCT o.id, o.slug
  FROM public.user_organization_roles uor
  JOIN public.organizations o ON o.id = uor.organization_id
  JOIN public.alumni a ON a.organization_id = uor.organization_id
  WHERE uor.user_id = p_user_id
    AND uor.status = 'active'
    AND a.deleted_at IS NULL
    AND a.email IS NOT NULL
    AND lower(a.email) = lower(btrim(p_email))
    AND (a.user_id = p_user_id OR a.user_id IS NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_alumni_profiles(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_alumni_profiles(uuid, text) TO authenticated;
