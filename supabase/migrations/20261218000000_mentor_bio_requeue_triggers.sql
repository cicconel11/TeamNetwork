-- Re-enqueue mentor bio regeneration when source data changes.
--
-- The mentor-bio pipeline regenerates an AI bio from a mentor profile's
-- expertise/topic/sport/etc. metadata, plus the enriched profile fields on the
-- person's members/alumni row. Without these triggers the queue
-- (public.mentor_bio_backfill_queue) only ever gets seeded by the admin
-- backfill RPC, so bios go stale whenever that source data is edited.
--
-- Each trigger function enqueues the affected mentor profile and relies on the
-- partial unique index idx_mentor_bio_backfill_queue_pending_dedupe
-- (organization_id, mentor_profile_id WHERE processed_at IS NULL) plus
-- ON CONFLICT DO NOTHING to coalesce duplicate enqueues into one pending row.
--
-- Manual bios are never re-enqueued (bio_source = 'manual'). UPDATE statements
-- short-circuit when no regeneration-relevant column changed; in particular the
-- mentor_profiles trigger ignores bio/bio_source/bio_generated_at/bio_input_hash
-- writes so the queue draining its own generated bio back onto the row does not
-- cause an infinite re-enqueue loop.

-- =============================================================================
-- 1. mentor_profiles: enqueue on metadata changes
-- =============================================================================

CREATE OR REPLACE FUNCTION public.requeue_mentor_bio_on_profile_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Never regenerate an admin-authored manual bio.
  IF NEW.bio_source IS NOT DISTINCT FROM 'manual' THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, only re-enqueue when a column that feeds the bio changed.
  -- Deliberately ignores bio/bio_source/bio_generated_at/bio_input_hash/updated_at
  -- so the queue writing the generated bio back does not loop.
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.expertise_areas IS NOT DISTINCT FROM OLD.expertise_areas)
       AND (NEW.topics IS NOT DISTINCT FROM OLD.topics)
       AND (NEW.sports IS NOT DISTINCT FROM OLD.sports)
       AND (NEW.positions IS NOT DISTINCT FROM OLD.positions)
       AND (NEW.industries IS NOT DISTINCT FROM OLD.industries)
       AND (NEW.role_families IS NOT DISTINCT FROM OLD.role_families)
       AND (NEW.custom_attributes IS NOT DISTINCT FROM OLD.custom_attributes)
    THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.mentor_bio_backfill_queue(organization_id, mentor_profile_id)
  VALUES (NEW.organization_id, NEW.id)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.requeue_mentor_bio_on_profile_change() IS
  'Trigger function: re-enqueue mentor bio regeneration when profile metadata changes (skips manual bios).';

-- =============================================================================
-- 2. alumni: enqueue the linked mentor profile on enrichment changes
-- =============================================================================

CREATE OR REPLACE FUNCTION public.requeue_mentor_bio_on_alumni_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Unlinked alumni rows have no mentor profile to enqueue.
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, only re-enqueue when an enrichable column that feeds the bio changed.
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.current_company IS NOT DISTINCT FROM OLD.current_company)
       AND (NEW.industry IS NOT DISTINCT FROM OLD.industry)
       AND (NEW.job_title IS NOT DISTINCT FROM OLD.job_title)
       AND (NEW.position_title IS NOT DISTINCT FROM OLD.position_title)
       AND (NEW.graduation_year IS NOT DISTINCT FROM OLD.graduation_year)
       AND (NEW.headline IS NOT DISTINCT FROM OLD.headline)
       AND (NEW.summary IS NOT DISTINCT FROM OLD.summary)
    THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.mentor_bio_backfill_queue(organization_id, mentor_profile_id)
  SELECT mp.organization_id, mp.id
  FROM public.mentor_profiles mp
  WHERE mp.organization_id = NEW.organization_id
    AND mp.user_id = NEW.user_id
    AND mp.bio_source IS DISTINCT FROM 'manual'
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.requeue_mentor_bio_on_alumni_change() IS
  'Trigger function: re-enqueue a linked mentor profile when its alumni enrichment fields change (skips manual bios).';

-- =============================================================================
-- 3. members: enqueue the linked mentor profile on enrichment changes
-- =============================================================================
-- The members table has no job_title/position_title/headline/summary columns
-- (those live on alumni), so only current_company/industry/graduation_year are
-- guarded here.

CREATE OR REPLACE FUNCTION public.requeue_mentor_bio_on_member_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Unlinked member rows have no mentor profile to enqueue.
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, only re-enqueue when an enrichable column that feeds the bio changed.
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.current_company IS NOT DISTINCT FROM OLD.current_company)
       AND (NEW.industry IS NOT DISTINCT FROM OLD.industry)
       AND (NEW.graduation_year IS NOT DISTINCT FROM OLD.graduation_year)
    THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.mentor_bio_backfill_queue(organization_id, mentor_profile_id)
  SELECT mp.organization_id, mp.id
  FROM public.mentor_profiles mp
  WHERE mp.organization_id = NEW.organization_id
    AND mp.user_id = NEW.user_id
    AND mp.bio_source IS DISTINCT FROM 'manual'
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.requeue_mentor_bio_on_member_change() IS
  'Trigger function: re-enqueue a linked mentor profile when its member enrichment fields change (skips manual bios).';

-- =============================================================================
-- 4. Trigger registration (idempotent: drop-first then create)
-- =============================================================================

DROP TRIGGER IF EXISTS trg_mentor_bio_requeue_mentor_profiles ON public.mentor_profiles;
CREATE TRIGGER trg_mentor_bio_requeue_mentor_profiles
  AFTER INSERT OR UPDATE ON public.mentor_profiles
  FOR EACH ROW EXECUTE FUNCTION public.requeue_mentor_bio_on_profile_change();

DROP TRIGGER IF EXISTS trg_mentor_bio_requeue_alumni ON public.alumni;
CREATE TRIGGER trg_mentor_bio_requeue_alumni
  AFTER INSERT OR UPDATE ON public.alumni
  FOR EACH ROW EXECUTE FUNCTION public.requeue_mentor_bio_on_alumni_change();

DROP TRIGGER IF EXISTS trg_mentor_bio_requeue_members ON public.members;
CREATE TRIGGER trg_mentor_bio_requeue_members
  AFTER INSERT OR UPDATE ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.requeue_mentor_bio_on_member_change();
