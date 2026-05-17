-- Per Apple App Store Review Guideline 3.2.1(vi), only registered nonprofit
-- organizations may collect donations through the iOS app. This flag is set
-- by TeamMeet operations after verifying 501(c)(3) status (or international
-- equivalent). When false, the iOS donation API rejects with a 403 and the
-- mobile client must steer the user to the web flow.
alter table public.organizations
  add column if not exists donation_eligible_ios boolean not null default false;

comment on column public.organizations.donation_eligible_ios is
  'When true, the iOS app may present a native (Apple Pay) donation flow. Set by ops after verifying nonprofit status per Apple Guideline 3.2.1(vi).';
