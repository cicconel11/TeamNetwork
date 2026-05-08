-- Make Live Activity lock-screen tracking opt-in instead of automatic.
--
-- Original PR #206 design: every RSVP=attending row auto-enrolls the user
-- in a Live Activity for that event. Product feedback: this is too noisy —
-- users want to opt in per event.
--
-- A boolean column on event_rsvps gates the mobile useActiveEventsForLiveActivity
-- query. Default FALSE so no existing RSVP gets a surprise lock-screen card
-- on the next app open after this migration ships.
alter table public.event_rsvps
  add column if not exists track_on_lock_screen boolean not null default false;

-- Partial index supports the mobile filter `attending AND track_on_lock_screen`.
create index if not exists event_rsvps_track_on_lock_screen_idx
  on public.event_rsvps (user_id, event_id)
  where track_on_lock_screen = true and status = 'attending';

comment on column public.event_rsvps.track_on_lock_screen is
  'User opted into Live Activity / lock-screen tracking for this event. Off by default per product decision (PR #206 follow-up).';
