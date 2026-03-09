-- Fix job_postings RLS policies:
-- 1. INSERT: Use dynamic job_post_roles from organizations table instead of hard-coded roles
-- 2. SELECT: Add 'parent' role to align with UI navigation (nav-items.tsx exposes Jobs to parents)

DROP POLICY IF EXISTS "job_postings_insert" ON public.job_postings;

CREATE POLICY "job_postings_insert" ON public.job_postings
  FOR INSERT WITH CHECK (
    posted_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_organization_roles uor
      JOIN public.organizations o ON o.id = uor.organization_id
      WHERE uor.organization_id = job_postings.organization_id
        AND uor.user_id = auth.uid()
        AND uor.status = 'active'
        AND uor.role::text = ANY(o.job_post_roles)
    )
  );

DROP POLICY IF EXISTS "job_postings_select" ON public.job_postings;

CREATE POLICY "job_postings_select" ON public.job_postings
  FOR SELECT USING (
    has_active_role(organization_id, array['admin','active_member','alumni','parent'])
  );
