-- Migration: Add 'parent' role to SELECT policies for content tables
-- Parents can now view all standard content (members, events, alumni, workouts, etc.)
-- Feed and announcements were already updated in 20260611 and 20260612 respectively.

-- members
DROP POLICY IF EXISTS members_select ON public.members;
CREATE POLICY members_select ON public.members
  FOR SELECT USING (has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']));

-- alumni
DROP POLICY IF EXISTS alumni_select ON public.alumni;
CREATE POLICY alumni_select ON public.alumni
  FOR SELECT USING (has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']));

-- donations
DROP POLICY IF EXISTS donations_select ON public.donations;
CREATE POLICY donations_select ON public.donations
  FOR SELECT USING (has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']));

-- records
DROP POLICY IF EXISTS records_select ON public.records;
CREATE POLICY records_select ON public.records
  FOR SELECT USING (has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']));

-- competitions
DROP POLICY IF EXISTS competitions_select ON public.competitions;
CREATE POLICY competitions_select ON public.competitions
  FOR SELECT USING (has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']));

-- philanthropy_events
DROP POLICY IF EXISTS philanthropy_events_select ON public.philanthropy_events;
CREATE POLICY philanthropy_events_select ON public.philanthropy_events
  FOR SELECT USING (has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']));

-- notifications
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT USING (has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']));

-- events
DROP POLICY IF EXISTS events_select ON public.events;
CREATE POLICY events_select ON public.events
  FOR SELECT USING (has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']));

-- workouts
DROP POLICY IF EXISTS workouts_select ON public.workouts;
CREATE POLICY workouts_select ON public.workouts
  FOR SELECT USING (has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']));

-- discussion_threads
DROP POLICY IF EXISTS discussion_threads_select ON public.discussion_threads;
CREATE POLICY discussion_threads_select ON public.discussion_threads
  FOR SELECT USING (has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']));

-- job_postings
DROP POLICY IF EXISTS job_postings_select ON public.job_postings;
CREATE POLICY job_postings_select ON public.job_postings
  FOR SELECT USING (has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']));

-- media_items
DROP POLICY IF EXISTS media_items_select ON public.media_items;
CREATE POLICY media_items_select ON public.media_items
  FOR SELECT USING (has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']));

-- mentorship_pairs — preserve inner condition (admin or directly involved)
DROP POLICY IF EXISTS mentorship_pairs_select ON public.mentorship_pairs;
CREATE POLICY mentorship_pairs_select ON public.mentorship_pairs
  FOR SELECT USING (
    has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
    AND (
      has_active_role(organization_id, ARRAY['admin'])
      OR mentor_user_id = auth.uid()
      OR mentee_user_id = auth.uid()
    )
  );

-- chat_groups — preserve inner condition (admin or is group member)
DROP POLICY IF EXISTS chat_groups_select ON public.chat_groups;
CREATE POLICY chat_groups_select ON public.chat_groups
  FOR SELECT USING (
    has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
    AND (
      has_active_role(organization_id, ARRAY['admin'])
      OR (deleted_at IS NULL AND is_chat_group_member(id))
    )
  );

-- schedule_sources — uses org_id column (not organization_id)
DROP POLICY IF EXISTS schedule_sources_select ON public.schedule_sources;
CREATE POLICY schedule_sources_select ON public.schedule_sources
  FOR SELECT USING (has_active_role(org_id, ARRAY['admin','active_member','alumni','parent']));
