-- Add configurable posting permissions for jobs and discussions
ALTER TABLE public.organizations
  ADD COLUMN job_post_roles text[] NOT NULL DEFAULT ARRAY['admin', 'alumni'],
  ADD COLUMN discussion_post_roles text[] NOT NULL DEFAULT ARRAY['admin', 'active_member', 'alumni'];
