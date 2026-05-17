-- =============================================================================
-- App Store UGC compliance (Guideline 1.2): user_blocks + content_reports
-- =============================================================================

-- 1. user_blocks ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (blocker_id <> blocked_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_blocks_unique_active
  ON public.user_blocks (blocker_id, blocked_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS user_blocks_blocker_active_idx
  ON public.user_blocks (blocker_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS user_blocks_blocked_active_idx
  ON public.user_blocks (blocked_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_blocks_select_own" ON public.user_blocks;
CREATE POLICY "user_blocks_select_own"
  ON public.user_blocks
  FOR SELECT
  TO authenticated
  USING (
    blocker_id = (select auth.uid())
    OR blocked_id = (select auth.uid())
  );

DROP POLICY IF EXISTS "user_blocks_insert_own" ON public.user_blocks;
CREATE POLICY "user_blocks_insert_own"
  ON public.user_blocks
  FOR INSERT
  TO authenticated
  WITH CHECK (blocker_id = (select auth.uid()));

DROP POLICY IF EXISTS "user_blocks_update_own" ON public.user_blocks;
CREATE POLICY "user_blocks_update_own"
  ON public.user_blocks
  FOR UPDATE
  TO authenticated
  USING (blocker_id = (select auth.uid()))
  WITH CHECK (blocker_id = (select auth.uid()));

DROP POLICY IF EXISTS "user_blocks_service" ON public.user_blocks;
CREATE POLICY "user_blocks_service"
  ON public.user_blocks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.user_blocks IS
  'Symmetric block relationships. toggle_block() creates one row per direction so both sides see the block.';

-- 2. content_reports -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.content_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  reporter_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  target_type text NOT NULL CHECK (target_type IN ('chat_message','feed_post','feed_comment','user_profile')),
  target_id uuid NOT NULL,
  reported_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN ('spam','harassment','hate','sexual','violence','self_harm','illegal','impersonation','other')),
  details text CHECK (details IS NULL OR char_length(details) <= 1000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewing','actioned','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS content_reports_org_recent_idx
  ON public.content_reports (organization_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS content_reports_reporter_idx
  ON public.content_reports (reporter_id);

CREATE INDEX IF NOT EXISTS content_reports_reported_user_idx
  ON public.content_reports (reported_user_id);

CREATE INDEX IF NOT EXISTS content_reports_target_idx
  ON public.content_reports (target_type, target_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "content_reports_select_reporter" ON public.content_reports;
CREATE POLICY "content_reports_select_reporter"
  ON public.content_reports
  FOR SELECT
  TO authenticated
  USING (reporter_id = (select auth.uid()));

DROP POLICY IF EXISTS "content_reports_select_admin" ON public.content_reports;
CREATE POLICY "content_reports_select_admin"
  ON public.content_reports
  FOR SELECT
  TO authenticated
  USING (public.has_active_role(organization_id, array['admin']));

DROP POLICY IF EXISTS "content_reports_insert_member" ON public.content_reports;
CREATE POLICY "content_reports_insert_member"
  ON public.content_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (
    reporter_id = (select auth.uid())
    AND public.has_active_role(
      organization_id,
      array['admin','active_member','alumni','parent']
    )
  );

DROP POLICY IF EXISTS "content_reports_service" ON public.content_reports;
CREATE POLICY "content_reports_service"
  ON public.content_reports
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.content_reports IS
  'Polymorphic UGC reports (chat_message, feed_post, feed_comment, user_profile). App Store Guideline 1.2.';

-- 3. toggle_block RPC ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.toggle_block(p_blocked_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid;
  v_existing_id uuid;
  v_now timestamptz := now();
BEGIN
  v_me := auth.uid();
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_blocked_id IS NULL OR p_blocked_id = v_me THEN
    RAISE EXCEPTION 'invalid blocked user';
  END IF;

  -- Forward direction: me -> them
  SELECT id INTO v_existing_id
  FROM public.user_blocks
  WHERE blocker_id = v_me AND blocked_id = p_blocked_id AND deleted_at IS NULL
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Currently blocked: unblock both directions
    UPDATE public.user_blocks
    SET deleted_at = v_now
    WHERE deleted_at IS NULL
      AND (
        (blocker_id = v_me AND blocked_id = p_blocked_id)
        OR (blocker_id = p_blocked_id AND blocked_id = v_me)
      );

    RETURN jsonb_build_object('blocked', false);
  END IF;

  -- Not blocked: insert both directions (revive soft-deleted rows if any)
  INSERT INTO public.user_blocks (blocker_id, blocked_id)
  VALUES (v_me, p_blocked_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.user_blocks (blocker_id, blocked_id)
  VALUES (p_blocked_id, v_me)
  ON CONFLICT DO NOTHING;

  -- In case the unique-active index allowed (soft-deleted) duplicates, revive them too
  UPDATE public.user_blocks
  SET deleted_at = NULL, created_at = v_now
  WHERE deleted_at IS NOT NULL
    AND (
      (blocker_id = v_me AND blocked_id = p_blocked_id)
      OR (blocker_id = p_blocked_id AND blocked_id = v_me)
    );

  RETURN jsonb_build_object('blocked', true);
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_block(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_block(uuid) TO authenticated;
