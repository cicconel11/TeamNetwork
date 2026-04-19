begin;

alter table public.mentee_preferences
  add column if not exists seeking_mentorship boolean not null default false;

comment on column public.mentee_preferences.seeking_mentorship is
  'Explicit mentee opt-in flag for mentorship discovery, AI recommendations, and admin match rounds.';

create index if not exists mentee_preferences_org_seeking_idx
  on public.mentee_preferences (organization_id, seeking_mentorship);

commit;
