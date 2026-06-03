-- Fix cross-person user_id collisions that made the mentorship directory render
-- one person's enriched company/industry on a different person's card.
--
-- Root cause: some `alumni` rows were stamped with a real member's `user_id`
-- while describing a DIFFERENT person (sample/import artifacts). Surfaces that
-- join enrichment by `user_id` (e.g. the mentorship directory) then attributed
-- the stray alumni record's company/industry to the member.
--
-- Part A — detach the mismatched alumni rows (keep them as manual alumni
--          entries; just stop them impersonating the member's account).
-- Part B — add partial unique indexes so a person can never have duplicate
--          rows per org going forward.

-- ---------------------------------------------------------------------------
-- Part A: detach alumni rows whose user_id collides with a DIFFERENT-named
-- member in the same org. The name-mismatch guard ensures legitimately linked
-- alumni (same person as the member) are never touched.
-- ---------------------------------------------------------------------------
UPDATE public.alumni a
SET user_id = NULL,
    updated_at = now()
FROM public.members m
WHERE m.organization_id = a.organization_id
  AND m.user_id = a.user_id
  AND m.deleted_at IS NULL
  AND a.deleted_at IS NULL
  AND a.user_id IS NOT NULL
  AND lower(trim(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, '')))
      <> lower(trim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')));

-- ---------------------------------------------------------------------------
-- Part B: enforce one live row per (organization_id, user_id) per table. These
-- prevent duplicate member/alumni rows for the same person; the cross-table
-- member<->alumni collision is additionally guarded operationally by reading a
-- person's enrichment from their own role-appropriate row (members -> alumni ->
-- parents) in application code (see lib/profile/enriched-fields.ts).
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS alumni_org_user_id_live_unique
  ON public.alumni (organization_id, user_id)
  WHERE deleted_at IS NULL AND user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS members_org_user_id_live_unique
  ON public.members (organization_id, user_id)
  WHERE deleted_at IS NULL AND user_id IS NOT NULL;
