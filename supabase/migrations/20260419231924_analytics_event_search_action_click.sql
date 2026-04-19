-- Add search_action_click to the analytics_event_name enum so the global
-- search palette's quick-action tracking validates end-to-end.
do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on e.enumtypid = t.oid
    where t.typname = 'analytics_event_name'
      and e.enumlabel = 'search_action_click'
  ) then
    alter type public.analytics_event_name add value 'search_action_click';
  end if;
end
$$;
