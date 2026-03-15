CREATE OR REPLACE FUNCTION public.save_user_linkedin_url(
  p_user_id uuid,
  p_linkedin_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_members_updated integer := 0;
  v_alumni_updated integer := 0;
  v_parents_updated integer := 0;
BEGIN
  UPDATE public.members
  SET linkedin_url = p_linkedin_url
  WHERE user_id = p_user_id
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_members_updated = ROW_COUNT;

  UPDATE public.alumni
  SET linkedin_url = p_linkedin_url
  WHERE user_id = p_user_id
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_alumni_updated = ROW_COUNT;

  UPDATE public.parents
  SET linkedin_url = p_linkedin_url
  WHERE user_id = p_user_id
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_parents_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'updated_count',
    v_members_updated + v_alumni_updated + v_parents_updated
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_user_linkedin_url(uuid, text) TO service_role;
