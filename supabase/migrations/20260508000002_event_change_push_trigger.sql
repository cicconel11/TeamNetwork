-- Schedule-change push fan-out for the public.events table.
--
-- Fires only on meaningful changes admins or members care about:
--   - Cancellation: deleted_at transitions from null to non-null
--   - Reschedule:   start_date or end_date changes
--   - Relocation:   location changes
--
-- Other column flips (title typo, description, audience adjustment) are
-- intentionally noisy-low-value and skipped. Inserts are already pushed by
-- the existing /api/notifications/send flow when admins create events from
-- web or mobile, so this trigger only handles UPDATE.
--
-- Routing: category='event_reminder' so the existing
-- notification_preferences.event_reminder_push_enabled gate applies (this
-- column already exists, default true). Mobile getNotificationRoute already
-- handles type='event_reminder' → /<orgSlug>/events/<id>.

create or replace function public.enqueue_event_change_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_title text;
  v_body text;
  v_audience text;
begin
  -- Determine which kind of change this is. First match wins; cancellation
  -- preempts reschedule/location since the event is gone anyway.
  if NEW.deleted_at is not null and OLD.deleted_at is null then
    v_kind := 'cancelled';
  elsif NEW.start_date is distinct from OLD.start_date
     or NEW.end_date is distinct from OLD.end_date then
    v_kind := 'rescheduled';
  elsif NEW.location is distinct from OLD.location then
    v_kind := 'relocated';
  else
    return NEW;
  end if;

  -- Skip already-deleted rows (admin editing soft-deleted events).
  if v_kind <> 'cancelled' and NEW.deleted_at is not null then
    return NEW;
  end if;

  v_title := case v_kind
    when 'cancelled' then 'Event cancelled: ' || coalesce(NEW.title, 'Untitled')
    when 'rescheduled' then 'Event rescheduled: ' || coalesce(NEW.title, 'Untitled')
    when 'relocated' then 'New location: ' || coalesce(NEW.title, 'Untitled')
  end;

  v_body := case v_kind
    when 'cancelled' then 'This event has been cancelled.'
    when 'rescheduled' then 'New time: ' || to_char(NEW.start_date at time zone 'UTC', 'Mon DD, HH24:MI') || ' UTC'
    when 'relocated' then 'Now at ' || coalesce(NEW.location, 'a new location')
  end;

  -- Map events.audience to notification_jobs.audience.
  v_audience := case coalesce(NEW.audience, 'both')
    when 'members' then 'members'
    when 'alumni' then 'alumni'
    else 'all'
  end;

  insert into public.notification_jobs (
    organization_id,
    kind,
    audience,
    target_user_ids,
    category,
    push_type,
    push_resource_id,
    title,
    body,
    data
  ) values (
    NEW.organization_id,
    'standard',
    v_audience,
    NEW.target_user_ids,  -- honors per-event targeting if set
    'event_reminder',
    'event_reminder',
    NEW.id,
    v_title,
    v_body,
    jsonb_build_object('eventId', NEW.id, 'changeKind', v_kind)
  );

  return NEW;
end;
$$;

drop trigger if exists event_change_push_trigger on public.events;
create trigger event_change_push_trigger
  after update on public.events
  for each row execute function public.enqueue_event_change_push();

comment on function public.enqueue_event_change_push() is
  'Enqueues notification_jobs row when an event is cancelled, rescheduled, or relocated. Skips other column updates.';
