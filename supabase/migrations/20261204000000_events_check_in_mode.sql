-- Add a per-event check-in mode so creators can choose between QR-based
-- check-in and a simple RSVP confirmation.
--
-- 'qr'   = scan-to-check-in flow (existing behavior)
-- 'rsvp' = RSVP buttons only, no check-in step

create type public.event_check_in_mode as enum ('qr', 'rsvp');

alter table public.events
  add column check_in_mode public.event_check_in_mode not null default 'rsvp';

-- Existing events were all created under the QR-check-in flow; preserve that.
update public.events set check_in_mode = 'qr';
