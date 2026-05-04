-- Add deep-link metadata to notifications so inbox row taps can route to
-- the related resource the same way push taps do (via mobile
-- getNotificationRoute()).
--
-- Columns:
--   type         text — notification kind (announcement, event, chat, ...)
--   resource_id  uuid — id of the related row (announcement.id, event.id, ...)
--   data         jsonb — extra payload mirroring the Expo push `data` blob
--
-- All three are nullable: legacy rows stay valid; only newly-inserted rows
-- need to populate them. Mobile inbox taps fall back to a no-op when missing.

alter table public.notifications
  add column if not exists type text,
  add column if not exists resource_id uuid,
  add column if not exists data jsonb not null default '{}'::jsonb;

create index if not exists notifications_type_idx
  on public.notifications(type)
  where deleted_at is null;
