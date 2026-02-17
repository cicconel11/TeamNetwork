-- Create tables for discussions, job board, and mentorship features
-- Migration: 20260521000000_create_discussions_jobs_mentors.sql

-- Enable RLS on all tables
ALTER TABLE IF EXISTS public.discussion_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.discussion_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.job_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.mentor_profiles ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 1. discussion_threads table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.discussion_threads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  is_pinned boolean NOT NULL DEFAULT false,
  is_locked boolean NOT NULL DEFAULT false,
  reply_count integer NOT NULL DEFAULT 0,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- Index for main thread listing (pinned threads first, then by activity)
CREATE INDEX idx_discussion_threads_listing ON public.discussion_threads (
  organization_id,
  deleted_at,
  is_pinned DESC,
  last_activity_at DESC
);

COMMENT ON TABLE public.discussion_threads IS 'Discussion forum threads for organization members';
COMMENT ON COLUMN public.discussion_threads.reply_count IS 'Cached count of non-deleted replies (updated by trigger)';
COMMENT ON COLUMN public.discussion_threads.last_activity_at IS 'Timestamp of last reply (updated by trigger)';
COMMENT ON COLUMN public.discussion_threads.is_pinned IS 'Pinned threads appear at top of listing';
COMMENT ON COLUMN public.discussion_threads.is_locked IS 'Locked threads cannot receive new replies';

-- RLS Policies for discussion_threads
CREATE POLICY "discussion_threads_select" ON public.discussion_threads
  FOR SELECT USING (
    has_active_role(organization_id, array['admin','active_member','alumni'])
  );

CREATE POLICY "discussion_threads_insert" ON public.discussion_threads
  FOR INSERT WITH CHECK (
    author_id = auth.uid()
    AND has_active_role(organization_id, array['admin','active_member','alumni'])
  );

CREATE POLICY "discussion_threads_update" ON public.discussion_threads
  FOR UPDATE USING (
    author_id = auth.uid()
    OR has_active_role(organization_id, array['admin'])
  )
  WITH CHECK (
    author_id = auth.uid()
    OR has_active_role(organization_id, array['admin'])
  );

CREATE POLICY "discussion_threads_delete" ON public.discussion_threads
  FOR UPDATE USING (
    (author_id = auth.uid() OR has_active_role(organization_id, array['admin']))
    AND deleted_at IS NULL
  )
  WITH CHECK (
    (author_id = auth.uid() OR has_active_role(organization_id, array['admin']))
    AND deleted_at IS NOT NULL
  );

-- =============================================================================
-- 2. discussion_replies table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.discussion_replies (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id uuid NOT NULL REFERENCES public.discussion_threads(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- Index for fetching replies in a thread
CREATE INDEX idx_discussion_replies_thread ON public.discussion_replies (
  thread_id,
  deleted_at,
  created_at
);

COMMENT ON TABLE public.discussion_replies IS 'Replies to discussion threads';

-- RLS Policies for discussion_replies
CREATE POLICY "discussion_replies_select" ON public.discussion_replies
  FOR SELECT USING (
    has_active_role(organization_id, array['admin','active_member','alumni'])
  );

CREATE POLICY "discussion_replies_insert" ON public.discussion_replies
  FOR INSERT WITH CHECK (
    author_id = auth.uid()
    AND has_active_role(organization_id, array['admin','active_member','alumni'])
  );

CREATE POLICY "discussion_replies_update" ON public.discussion_replies
  FOR UPDATE USING (
    author_id = auth.uid()
  )
  WITH CHECK (
    author_id = auth.uid()
  );

CREATE POLICY "discussion_replies_delete" ON public.discussion_replies
  FOR UPDATE USING (
    (author_id = auth.uid() OR has_active_role(organization_id, array['admin']))
    AND deleted_at IS NULL
  )
  WITH CHECK (
    (author_id = auth.uid() OR has_active_role(organization_id, array['admin']))
    AND deleted_at IS NOT NULL
  );

-- =============================================================================
-- 3. Trigger function for reply_count and last_activity_at
-- =============================================================================

CREATE OR REPLACE FUNCTION update_thread_reply_count()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION update_thread_reply_count() IS 'Maintains reply_count and last_activity_at on discussion_threads';

-- Create triggers
CREATE TRIGGER discussion_replies_insert_trigger
  AFTER INSERT ON public.discussion_replies
  FOR EACH ROW
  EXECUTE FUNCTION update_thread_reply_count();

CREATE TRIGGER discussion_replies_soft_delete_trigger
  AFTER UPDATE ON public.discussion_replies
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION update_thread_reply_count();

-- =============================================================================
-- 4. job_postings table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.job_postings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  posted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  company text NOT NULL,
  description text NOT NULL,
  location text,
  location_type text,
  application_url text,
  contact_email text,
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- Index for job board listing (active jobs first, ordered by expiration)
CREATE INDEX idx_job_postings_listing ON public.job_postings (
  organization_id,
  is_active,
  deleted_at,
  expires_at
);

COMMENT ON TABLE public.job_postings IS 'Job board postings for alumni and members';
COMMENT ON COLUMN public.job_postings.location_type IS 'e.g., remote, hybrid, on-site';
COMMENT ON COLUMN public.job_postings.is_active IS 'Active jobs are displayed on job board';
COMMENT ON COLUMN public.job_postings.expires_at IS 'Optional expiration date for job posting';

-- RLS Policies for job_postings
CREATE POLICY "job_postings_select" ON public.job_postings
  FOR SELECT USING (
    has_active_role(organization_id, array['admin','active_member','alumni'])
  );

CREATE POLICY "job_postings_insert" ON public.job_postings
  FOR INSERT WITH CHECK (
    posted_by = auth.uid()
    AND has_active_role(organization_id, array['admin','alumni'])
  );

CREATE POLICY "job_postings_update" ON public.job_postings
  FOR UPDATE USING (
    posted_by = auth.uid()
    OR has_active_role(organization_id, array['admin'])
  )
  WITH CHECK (
    posted_by = auth.uid()
    OR has_active_role(organization_id, array['admin'])
  );

CREATE POLICY "job_postings_delete" ON public.job_postings
  FOR UPDATE USING (
    (posted_by = auth.uid() OR has_active_role(organization_id, array['admin']))
    AND deleted_at IS NULL
  )
  WITH CHECK (
    (posted_by = auth.uid() OR has_active_role(organization_id, array['admin']))
    AND deleted_at IS NOT NULL
  );

-- =============================================================================
-- 5. mentor_profiles table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.mentor_profiles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bio text,
  expertise_areas text[] NOT NULL DEFAULT '{}',
  contact_email text,
  contact_linkedin text,
  contact_phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, organization_id)
);

-- Index for active mentor listings
CREATE INDEX idx_mentor_profiles_listing ON public.mentor_profiles (
  organization_id,
  is_active
);

COMMENT ON TABLE public.mentor_profiles IS 'Mentorship profiles for alumni offering guidance';
COMMENT ON COLUMN public.mentor_profiles.expertise_areas IS 'Array of expertise tags (e.g., ["Software Engineering", "Product Management"])';
COMMENT ON COLUMN public.mentor_profiles.is_active IS 'Only active profiles are shown in mentor directory';

-- RLS Policies for mentor_profiles
CREATE POLICY "mentor_profiles_select" ON public.mentor_profiles
  FOR SELECT USING (
    has_active_role(organization_id, array['admin','active_member','alumni'])
  );

CREATE POLICY "mentor_profiles_insert" ON public.mentor_profiles
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND has_active_role(organization_id, array['alumni'])
  );

CREATE POLICY "mentor_profiles_update" ON public.mentor_profiles
  FOR UPDATE USING (
    user_id = auth.uid()
  )
  WITH CHECK (
    user_id = auth.uid()
  );

CREATE POLICY "mentor_profiles_delete" ON public.mentor_profiles
  FOR DELETE USING (
    user_id = auth.uid()
  );
