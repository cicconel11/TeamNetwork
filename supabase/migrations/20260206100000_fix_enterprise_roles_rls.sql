-- =====================================================
-- Migration: Fix Enterprise Roles RLS Infinite Recursion
-- Date: 2026-02-06
-- Purpose: Fix infinite recursion in user_enterprise_roles RLS policy
-- =====================================================

-- Create SECURITY DEFINER function to check if user is enterprise owner
-- This bypasses RLS to avoid infinite recursion
CREATE OR REPLACE FUNCTION public.is_enterprise_owner(ent_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_enterprise_roles
    WHERE enterprise_id = ent_id
      AND user_id = (select auth.uid())
      AND role = 'owner'
  );
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.is_enterprise_owner(uuid) TO authenticated;

-- Drop the problematic policy
DROP POLICY IF EXISTS user_enterprise_roles_select_owner ON public.user_enterprise_roles;

-- Recreate using the SECURITY DEFINER function (no recursion)
CREATE POLICY user_enterprise_roles_select_owner ON public.user_enterprise_roles
  FOR SELECT USING (public.is_enterprise_owner(enterprise_id));
