-- "Jump back in" digest needs a per-user, per-org timestamp of when the member
-- last acknowledged the org feed. The home page counts posts / event RSVPs /
-- new members created after this instant and shows a catch-up strip. The value
-- only advances when the member explicitly acknowledges (clicks "Catch up" or
-- dismisses), so the strip survives refreshes until acted on.
--
-- NULL means "never acknowledged" — callers treat that as a recent floor (e.g.
-- the membership's created_at) so brand-new members don't see an inflated count.
alter table public.user_organization_roles
  add column if not exists feed_last_seen_at timestamptz;

comment on column public.user_organization_roles.feed_last_seen_at is
  'When the member last acknowledged the org feed (drives the "Jump back in" digest). NULL = never acknowledged; advanced only on explicit catch-up/dismiss.';
