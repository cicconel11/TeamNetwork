-- Fix function_search_path_mutable warnings for 4 functions.
-- Sets search_path = '' and fully qualifies all table/function references.

-- 1. claim_stale_stripe_event
CREATE OR REPLACE FUNCTION public.claim_stale_stripe_event(p_event_id text)
RETURNS SETOF public.stripe_events
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  UPDATE public.stripe_events
  SET leased_at = NOW()
  WHERE event_id = p_event_id
    AND processed_at IS NULL
    AND leased_at < NOW() - INTERVAL '5 minutes'
  RETURNING *;
$$;

-- 2. update_thread_reply_count
CREATE OR REPLACE FUNCTION public.update_thread_reply_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Increment reply_count and update last_activity_at
    UPDATE public.discussion_threads
    SET
      reply_count = reply_count + 1,
      last_activity_at = NEW.created_at
    WHERE id = NEW.thread_id;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Check if this is a soft delete (deleted_at changing from NULL to non-NULL)
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      -- Decrement reply_count
      UPDATE public.discussion_threads
      SET reply_count = GREATEST(reply_count - 1, 0)
      WHERE id = NEW.thread_id;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

-- 3. create_org_invite
CREATE OR REPLACE FUNCTION public.create_org_invite(
  p_organization_id uuid,
  p_role            text DEFAULT 'active_member',
  p_uses            int  DEFAULT NULL,
  p_expires_at      timestamptz DEFAULT NULL,
  p_require_approval boolean DEFAULT NULL
)
RETURNS public.organization_invites
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code   text;
  v_token  text;
  v_result public.organization_invites;
BEGIN
  -- Verify caller is admin of the organization
  IF NOT public.is_org_admin(p_organization_id) THEN
    RAISE EXCEPTION 'Only organization admins can create invites';
  END IF;

  -- Validate role
  IF p_role NOT IN ('admin', 'active_member', 'alumni', 'parent') THEN
    RAISE EXCEPTION 'Invalid role. Must be admin, active_member, alumni, or parent';
  END IF;

  -- Respect alumni quota for alumni invites
  IF p_role = 'alumni' THEN
    PERFORM public.assert_alumni_quota(p_organization_id);
  END IF;

  -- Generate secure random code (8 chars, alphanumeric)
  v_code := upper(substr(
    replace(replace(replace(
      encode(gen_random_bytes(6), 'base64'),
      '/', ''), '+', ''), '=', ''),
    1, 8
  ));

  -- Generate secure token (URL-safe base64, 32 chars)
  v_token := replace(replace(replace(
    encode(gen_random_bytes(24), 'base64'),
    '/', '_'), '+', '-'), '=', '');

  INSERT INTO public.organization_invites (
    organization_id,
    code,
    token,
    role,
    uses_remaining,
    expires_at,
    created_by_user_id,
    require_approval
  ) VALUES (
    p_organization_id,
    v_code,
    v_token,
    p_role,
    p_uses,
    p_expires_at,
    auth.uid(),
    p_require_approval
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- 4. can_view_announcement
CREATE OR REPLACE FUNCTION public.can_view_announcement(announcement_row public.announcements)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  user_role text;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();

  SELECT role INTO user_role
  FROM public.user_organization_roles
  WHERE user_organization_roles.user_id = v_user_id
    AND organization_id = announcement_row.organization_id
    AND status = 'active'
  LIMIT 1;

  IF user_role = 'admin' THEN
    RETURN true;
  END IF;

  CASE announcement_row.audience
    WHEN 'all' THEN
      RETURN user_role IS NOT NULL;
    WHEN 'members' THEN
      RETURN user_role IN ('admin', 'active_member', 'member');
    WHEN 'active_members' THEN
      RETURN user_role IN ('admin', 'active_member');
    WHEN 'alumni' THEN
      RETURN user_role IN ('admin', 'alumni', 'parent');
    WHEN 'individuals' THEN
      RETURN v_user_id = ANY(announcement_row.audience_user_ids);
    ELSE
      RETURN user_role IS NOT NULL;
  END CASE;
END;
$$;
