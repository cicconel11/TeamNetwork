-- Fix community table FKs: point to public.users instead of auth.users
-- so PostgREST can resolve FK-based joins for author name lookups.

-- 1. discussion_threads.author_id
ALTER TABLE public.discussion_threads DROP CONSTRAINT discussion_threads_author_id_fkey;
ALTER TABLE public.discussion_threads ADD CONSTRAINT discussion_threads_author_id_fkey
  FOREIGN KEY (author_id) REFERENCES public.users(id);

-- 2. discussion_replies.author_id
ALTER TABLE public.discussion_replies DROP CONSTRAINT discussion_replies_author_id_fkey;
ALTER TABLE public.discussion_replies ADD CONSTRAINT discussion_replies_author_id_fkey
  FOREIGN KEY (author_id) REFERENCES public.users(id);

-- 3. job_postings.posted_by
ALTER TABLE public.job_postings DROP CONSTRAINT job_postings_posted_by_fkey;
ALTER TABLE public.job_postings ADD CONSTRAINT job_postings_posted_by_fkey
  FOREIGN KEY (posted_by) REFERENCES public.users(id);

-- 4. feed_posts.author_id
ALTER TABLE public.feed_posts DROP CONSTRAINT feed_posts_author_id_fkey;
ALTER TABLE public.feed_posts ADD CONSTRAINT feed_posts_author_id_fkey
  FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- 5. feed_comments.author_id
ALTER TABLE public.feed_comments DROP CONSTRAINT feed_comments_author_id_fkey;
ALTER TABLE public.feed_comments ADD CONSTRAINT feed_comments_author_id_fkey
  FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- 6. mentor_profiles.user_id
ALTER TABLE public.mentor_profiles DROP CONSTRAINT mentor_profiles_user_id_fkey;
ALTER TABLE public.mentor_profiles ADD CONSTRAINT mentor_profiles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id);
