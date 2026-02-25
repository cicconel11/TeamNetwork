-- Migration: 20260611000000_feed_parent_access.sql
-- Extend feed RLS to grant parent role read + interact access on Feed.

-- feed_posts: SELECT + INSERT
DROP POLICY IF EXISTS "feed_posts_select" ON public.feed_posts;
CREATE POLICY "feed_posts_select" ON public.feed_posts
  FOR SELECT USING (
    has_active_role(organization_id, array['admin','active_member','alumni','parent'])
  );

DROP POLICY IF EXISTS "feed_posts_insert" ON public.feed_posts;
CREATE POLICY "feed_posts_insert" ON public.feed_posts
  FOR INSERT WITH CHECK (
    author_id = (SELECT auth.uid())
    AND has_active_role(organization_id, array['admin','active_member','alumni','parent'])
  );

-- feed_comments: SELECT + INSERT
DROP POLICY IF EXISTS "feed_comments_select" ON public.feed_comments;
CREATE POLICY "feed_comments_select" ON public.feed_comments
  FOR SELECT USING (
    has_active_role(organization_id, array['admin','active_member','alumni','parent'])
  );

DROP POLICY IF EXISTS "feed_comments_insert" ON public.feed_comments;
CREATE POLICY "feed_comments_insert" ON public.feed_comments
  FOR INSERT WITH CHECK (
    author_id = (SELECT auth.uid())
    AND has_active_role(organization_id, array['admin','active_member','alumni','parent'])
  );

-- feed_likes: SELECT + INSERT
DROP POLICY IF EXISTS "feed_likes_select" ON public.feed_likes;
CREATE POLICY "feed_likes_select" ON public.feed_likes
  FOR SELECT USING (
    has_active_role(organization_id, array['admin','active_member','alumni','parent'])
  );

DROP POLICY IF EXISTS "feed_likes_insert" ON public.feed_likes;
CREATE POLICY "feed_likes_insert" ON public.feed_likes
  FOR INSERT WITH CHECK (
    user_id = (SELECT auth.uid())
    AND has_active_role(organization_id, array['admin','active_member','alumni','parent'])
  );
