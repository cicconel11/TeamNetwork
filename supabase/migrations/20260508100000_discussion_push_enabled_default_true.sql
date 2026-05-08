-- Flip discussion_push_enabled to default true for parity with chat and
-- event_reminder. Discussions are high-signal "someone replied to your thread"
-- or "new thread posted" events; opting in by default matches what users
-- expect. The original default (false) was leftover caution from when the
-- feature was email-only; now that the Postgres trigger exists and pushes are
-- live, the column should match the rest of the high-signal categories.
--
-- Backfill: set existing rows where discussion_push_enabled = false back to
-- true. None of those users explicitly opted out (the toggle was never
-- exposed); they are stuck on the original default. Users who later flip it
-- off via the preferences UI keep their off state because this migration only
-- runs once.

alter table public.notification_preferences
  alter column discussion_push_enabled set default true;

update public.notification_preferences
   set discussion_push_enabled = true
 where discussion_push_enabled = false;
