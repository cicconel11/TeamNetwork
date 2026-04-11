-- Migration: Add 'parent' role to remaining SELECT policies
-- Fixes tables not covered by 20260613000000_parent_role_content_access.sql

-- event_rsvps
DROP POLICY IF EXISTS event_rsvps_select ON public.event_rsvps;
CREATE POLICY event_rsvps_select ON public.event_rsvps
  FOR SELECT
  USING (public.has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']));

DROP POLICY IF EXISTS event_rsvps_insert ON public.event_rsvps;
CREATE POLICY event_rsvps_insert ON public.event_rsvps
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND public.has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
  );

DROP POLICY IF EXISTS event_rsvps_update ON public.event_rsvps;
CREATE POLICY event_rsvps_update ON public.event_rsvps
  FOR UPDATE
  USING (
    auth.uid() = user_id
    AND public.has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
  )
  WITH CHECK (
    auth.uid() = user_id
    AND public.has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
  );

-- calendar_feeds (personal scope unchanged; only org scope gets 'parent')
DROP POLICY IF EXISTS calendar_feeds_select ON public.calendar_feeds;
CREATE POLICY calendar_feeds_select ON public.calendar_feeds
  FOR SELECT
  USING (
    (scope = 'personal' AND auth.uid() = user_id)
    OR (scope = 'org' AND public.has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']))
  );

-- calendar_events (personal scope unchanged; only org scope gets 'parent')
DROP POLICY IF EXISTS calendar_events_select ON public.calendar_events;
CREATE POLICY calendar_events_select ON public.calendar_events
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR (scope = 'org' AND public.has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']))
    OR (scope = 'personal' AND public.has_active_role(organization_id, ARRAY['admin']))
  );

-- schedule_events (note: uses org_id, not organization_id)
DROP POLICY IF EXISTS schedule_events_select ON public.schedule_events;
CREATE POLICY schedule_events_select ON public.schedule_events
  FOR SELECT
  USING (public.has_active_role(org_id, ARRAY['admin','active_member','alumni','parent']));

-- media_items approved items (defensive: drop 20260502 moderation policy if still present)
DROP POLICY IF EXISTS "media_items_select_approved" ON public.media_items;
CREATE POLICY "media_items_select_approved" ON public.media_items
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND status = 'approved'
    AND public.has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
  );
