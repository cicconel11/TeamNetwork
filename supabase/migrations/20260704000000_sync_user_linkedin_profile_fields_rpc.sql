CREATE OR REPLACE FUNCTION public.sync_user_linkedin_profile_fields(
  p_user_id uuid,
  p_first_name text,
  p_last_name text,
  p_photo_url text
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
  SET first_name = p_first_name,
      last_name = p_last_name,
      photo_url = p_photo_url
  WHERE user_id = p_user_id
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_members_updated = ROW_COUNT;

  UPDATE public.alumni
  SET first_name = p_first_name,
      last_name = p_last_name,
      photo_url = p_photo_url
  WHERE user_id = p_user_id
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_alumni_updated = ROW_COUNT;

  UPDATE public.parents
  SET first_name = p_first_name,
      last_name = p_last_name,
      photo_url = p_photo_url
  WHERE user_id = p_user_id
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_parents_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'updated_count',
    v_members_updated + v_alumni_updated + v_parents_updated
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_user_linkedin_profile_fields(uuid, text, text, text) TO service_role;
