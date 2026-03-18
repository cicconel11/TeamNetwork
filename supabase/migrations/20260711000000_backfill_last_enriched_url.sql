-- Backfill last_enriched_url for rows enriched before the column existed.
-- Priority: linkedin_profile_url (direct OAuth source), then org profile tables
-- (members, alumni, parents) where Settings-flow users store their URL.
UPDATE public.user_linkedin_connections c
SET last_enriched_url = COALESCE(
  c.linkedin_profile_url,
  (SELECT m.linkedin_url FROM public.members m
   WHERE m.user_id = c.user_id AND m.deleted_at IS NULL AND m.linkedin_url IS NOT NULL
   LIMIT 1),
  (SELECT a.linkedin_url FROM public.alumni a
   WHERE a.user_id = c.user_id AND a.deleted_at IS NULL AND a.linkedin_url IS NOT NULL
   LIMIT 1),
  (SELECT p.linkedin_url FROM public.parents p
   WHERE p.user_id = c.user_id AND p.deleted_at IS NULL AND p.linkedin_url IS NOT NULL
   LIMIT 1)
)
WHERE c.last_enriched_at IS NOT NULL
  AND c.last_enriched_url IS NULL;
