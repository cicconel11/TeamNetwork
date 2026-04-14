-- =====================================================
-- Migration: Mentorship Pair Deletion Cascade & Org Consistency
-- Date: 2026-10-13
-- Purpose: Enforce organization_id immutability and cascade soft-deletes
-- =====================================================

-- =====================================================
-- Part 1: Org Consistency Enforcement
-- =====================================================

-- Enforce that organization_id on tasks/meetings always matches the pair's org.
-- Prevents cross-tenant IDOR where a caller could insert tasks for pairs in other orgs.
-- Called BEFORE INSERT OR UPDATE to overwrite any caller-supplied organization_id
-- with the pair's actual organization_id.
CREATE OR REPLACE FUNCTION public.enforce_mentorship_org_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pair_org_id uuid;
BEGIN
  -- Fetch the pair's organization_id
  SELECT organization_id INTO v_pair_org_id
  FROM public.mentorship_pairs
  WHERE id = new.pair_id;

  -- Guard: pair must exist (not deleted)
  IF v_pair_org_id IS NULL THEN
    RAISE EXCEPTION 'mentorship pair not found or deleted';
  END IF;

  -- Always derive org_id from the pair row, ignoring whatever the caller supplied.
  -- This prevents cross-tenant writes via the REST API.
  new.organization_id := v_pair_org_id;
  RETURN new;
END;
$$;

-- Apply org consistency to mentorship_tasks
CREATE TRIGGER mentorship_tasks_org_consistency
  BEFORE INSERT OR UPDATE ON public.mentorship_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_mentorship_org_consistency();

-- Apply org consistency to mentorship_meetings
CREATE TRIGGER mentorship_meetings_org_consistency
  BEFORE INSERT OR UPDATE ON public.mentorship_meetings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_mentorship_org_consistency();

-- =====================================================
-- Part 2: Soft-Delete Cascade
-- =====================================================

-- When a mentorship pair is soft-deleted, cascade to all its tasks and meetings.
-- Triggered when mentorship_pairs.deleted_at changes from NULL to not-NULL.
-- Uses "OF deleted_at" to only fire when that specific column changes.
CREATE OR REPLACE FUNCTION public.cascade_mentorship_pair_soft_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Only cascade if deleted_at transitioned from NULL to not-NULL
  IF new.deleted_at IS NOT NULL AND old.deleted_at IS NULL THEN
    -- Cascade soft-delete to all non-deleted tasks
    UPDATE public.mentorship_tasks
    SET deleted_at = new.deleted_at, updated_at = now()
    WHERE pair_id = new.id AND deleted_at IS NULL;

    -- Cascade soft-delete to all non-deleted meetings
    UPDATE public.mentorship_meetings
    SET deleted_at = new.deleted_at, updated_at = now()
    WHERE pair_id = new.id AND deleted_at IS NULL;
  END IF;

  RETURN new;
END;
$$;

-- Trigger cascade on mentorship_pairs deleted_at column change
CREATE TRIGGER mentorship_pair_soft_delete_cascade
  AFTER UPDATE OF deleted_at ON public.mentorship_pairs
  FOR EACH ROW
  EXECUTE FUNCTION public.cascade_mentorship_pair_soft_delete();
