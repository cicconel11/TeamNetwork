ALTER TABLE public.schedule_sources
  ADD COLUMN IF NOT EXISTS last_event_count integer,
  ADD COLUMN IF NOT EXISTS last_imported integer,
  ADD COLUMN IF NOT EXISTS last_updated integer,
  ADD COLUMN IF NOT EXISTS last_cancelled integer;
