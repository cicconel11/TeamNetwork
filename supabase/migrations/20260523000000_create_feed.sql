-- Create tables for social feed feature
-- Migration: 20260523000000_create_feed.sql

-- =============================================================================
-- 1. feed_posts table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.feed_posts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  like_count integer NOT NULL DEFAULT 0,
  comment_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE public.feed_posts ENABLE ROW LEVEL SECURITY;

-- Index for main feed listing
CREATE INDEX idx_feed_posts_listing ON public.feed_posts (
  organization_id,
  deleted_at,
  created_at DESC
);

COMMENT ON TABLE public.feed_posts IS 'Social feed posts for organization members';
COMMENT ON COLUMN public.feed_posts.like_count IS 'Cached count of likes (updated by trigger)';
COMMENT ON COLUMN public.feed_posts.comment_count IS 'Cached count of non-deleted comments (updated by trigger)';

-- RLS Policies for feed_posts
CREATE POLICY "feed_posts_select" ON public.feed_posts
  FOR SELECT USING (
    has_active_role(organization_id, array['admin','active_member','alumni'])
  );

CREATE POLICY "feed_posts_insert" ON public.feed_posts
  FOR INSERT WITH CHECK (
    author_id = auth.uid()
    AND has_active_role(organization_id, array['admin','active_member','alumni'])
  );

CREATE POLICY "feed_posts_update" ON public.feed_posts
  FOR UPDATE USING (
    author_id = auth.uid()
    OR has_active_role(organization_id, array['admin'])
  )
  WITH CHECK (
    author_id = auth.uid()
    OR has_active_role(organization_id, array['admin'])
  );

CREATE POLICY "feed_posts_delete" ON public.feed_posts
  FOR UPDATE USING (
    (author_id = auth.uid() OR has_active_role(organization_id, array['admin']))
    AND deleted_at IS NULL
  )
  WITH CHECK (
    (author_id = auth.uid() OR has_active_role(organization_id, array['admin']))
    AND deleted_at IS NOT NULL
  );

-- =============================================================================
-- 2. feed_comments table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.feed_comments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES public.feed_posts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE public.feed_comments ENABLE ROW LEVEL SECURITY;

-- Index for fetching comments on a post
CREATE INDEX idx_feed_comments_post ON public.feed_comments (
  post_id,
  deleted_at,
  created_at
);

COMMENT ON TABLE public.feed_comments IS 'Comments on social feed posts';

-- RLS Policies for feed_comments
CREATE POLICY "feed_comments_select" ON public.feed_comments
  FOR SELECT USING (
    has_active_role(organization_id, array['admin','active_member','alumni'])
  );

CREATE POLICY "feed_comments_insert" ON public.feed_comments
  FOR INSERT WITH CHECK (
    author_id = auth.uid()
    AND has_active_role(organization_id, array['admin','active_member','alumni'])
  );

CREATE POLICY "feed_comments_update" ON public.feed_comments
  FOR UPDATE USING (
    author_id = auth.uid()
  )
  WITH CHECK (
    author_id = auth.uid()
  );

CREATE POLICY "feed_comments_delete" ON public.feed_comments
  FOR UPDATE USING (
    (author_id = auth.uid() OR has_active_role(organization_id, array['admin']))
    AND deleted_at IS NULL
  )
  WITH CHECK (
    (author_id = auth.uid() OR has_active_role(organization_id, array['admin']))
    AND deleted_at IS NOT NULL
  );

-- =============================================================================
-- 3. feed_likes table (hard delete, no soft delete)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.feed_likes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES public.feed_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(post_id, user_id)
);

ALTER TABLE public.feed_likes ENABLE ROW LEVEL SECURITY;

-- Indexes for feed_likes
CREATE INDEX idx_feed_likes_post ON public.feed_likes (post_id);
CREATE INDEX idx_feed_likes_user_post ON public.feed_likes (user_id, post_id);

COMMENT ON TABLE public.feed_likes IS 'Likes on social feed posts (hard delete on unlike)';

-- RLS Policies for feed_likes
CREATE POLICY "feed_likes_select" ON public.feed_likes
  FOR SELECT USING (
    has_active_role(organization_id, array['admin','active_member','alumni'])
  );

CREATE POLICY "feed_likes_insert" ON public.feed_likes
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND has_active_role(organization_id, array['admin','active_member','alumni'])
  );

CREATE POLICY "feed_likes_delete" ON public.feed_likes
  FOR DELETE USING (
    user_id = auth.uid()
  );

-- =============================================================================
-- 4. Trigger functions for cached counts
-- =============================================================================

-- Comment count trigger (mirrors update_thread_reply_count pattern)
CREATE OR REPLACE FUNCTION update_feed_post_comment_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.feed_posts
    SET comment_count = comment_count + 1
    WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Soft delete: deleted_at changing from NULL to non-NULL
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      UPDATE public.feed_posts
      SET comment_count = GREATEST(comment_count - 1, 0)
      WHERE id = NEW.post_id;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION update_feed_post_comment_count() IS 'Maintains comment_count on feed_posts';

CREATE TRIGGER feed_comments_insert_trigger
  AFTER INSERT ON public.feed_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_feed_post_comment_count();

CREATE TRIGGER feed_comments_soft_delete_trigger
  AFTER UPDATE ON public.feed_comments
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION update_feed_post_comment_count();

-- Like count trigger
CREATE OR REPLACE FUNCTION update_feed_post_like_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.feed_posts
    SET like_count = like_count + 1
    WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.feed_posts
    SET like_count = GREATEST(like_count - 1, 0)
    WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION update_feed_post_like_count() IS 'Maintains like_count on feed_posts';

CREATE TRIGGER feed_likes_insert_trigger
  AFTER INSERT ON public.feed_likes
  FOR EACH ROW
  EXECUTE FUNCTION update_feed_post_like_count();

CREATE TRIGGER feed_likes_delete_trigger
  AFTER DELETE ON public.feed_likes
  FOR EACH ROW
  EXECUTE FUNCTION update_feed_post_like_count();

-- =============================================================================
-- 5. Add feed_post_roles to organizations
-- =============================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS feed_post_roles text[] NOT NULL DEFAULT '{admin,active_member,alumni}';

COMMENT ON COLUMN public.organizations.feed_post_roles IS 'Roles allowed to create feed posts (checked at API level)';
