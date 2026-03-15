-- Feed Polls: LinkedIn-style inline polls in feed posts

-- 1. Extend feed_posts with post_type and metadata
ALTER TABLE feed_posts
  ADD COLUMN post_type TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN metadata  JSONB DEFAULT NULL;

ALTER TABLE feed_posts
  ADD CONSTRAINT feed_posts_post_type_check CHECK (post_type IN ('text', 'poll'));

-- 2. Create feed_poll_votes table
CREATE TABLE feed_poll_votes (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id         UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  option_index    SMALLINT NOT NULL CHECK (option_index >= 0 AND option_index <= 5),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(post_id, user_id)
);

CREATE INDEX idx_feed_poll_votes_post ON feed_poll_votes(post_id);

-- 3. RLS policies (mirror feed_likes pattern)
ALTER TABLE feed_poll_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view poll votes"
  ON feed_poll_votes FOR SELECT
  USING (is_org_member(organization_id));

CREATE POLICY "Members can cast votes"
  ON feed_poll_votes FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND is_org_member(organization_id)
  );

CREATE POLICY "Users can update own votes"
  ON feed_poll_votes FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own votes"
  ON feed_poll_votes FOR DELETE
  USING (auth.uid() = user_id);
