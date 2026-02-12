-- Remove duplicate schedule sources, keeping the most recently synced per (org_id, source_url).
-- Associated schedule_events are cascade-deleted via FK.
DELETE FROM public.schedule_sources
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY org_id, source_url
             ORDER BY last_synced_at DESC NULLS LAST, created_at DESC NULLS LAST
           ) AS rn
    FROM public.schedule_sources
  ) ranked
  WHERE rn > 1
);

-- Now safe to add the unique index.
CREATE UNIQUE INDEX IF NOT EXISTS schedule_sources_org_url_unique
  ON public.schedule_sources (org_id, source_url);
