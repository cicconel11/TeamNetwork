-- Extend the event-change push trigger to also enqueue Live Activity update/end
-- jobs alongside the existing standard push. Without this, an admin who
-- reschedules or cancels an event sends a banner push but the lock-screen
-- Live Activity card stays on the wrong info until the OS times it out.
--
-- Cancellation → live_activity_end (with dismissal-date = now() so the card
-- disappears immediately). Reschedule / relocation → live_activity_update so
-- the on-card countdown re-anchors to the new start time.
--
-- We replace the function body but keep the trigger; this preserves any other
-- columns/conditions in the original (20260508000002) without forcing a drop.

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
  v_has_active_la boolean;
begin
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
    NEW.target_user_ids,
    'event_reminder',
    'event_reminder',
    NEW.id,
    v_title,
    v_body,
    jsonb_build_object('eventId', NEW.id, 'changeKind', v_kind)
  );

  -- Skip the LA fan-out entirely if no devices have a Live Activity running
  -- for this event — saves a notification_jobs insert and the dispatcher's
  -- subsequent token query.
  select exists (
    select 1 from public.live_activity_tokens
    where event_id = NEW.id and ended_at is null
  ) into v_has_active_la;

  if v_has_active_la then
    insert into public.notification_jobs (
      organization_id,
      kind,
      priority,
      title,
      body,
      data
    ) values (
      NEW.organization_id,
      case v_kind when 'cancelled' then 'live_activity_end' else 'live_activity_update' end,
      1,
      v_title,
      v_body,
      jsonb_build_object(
        'event_id', NEW.id,
        'change_kind', v_kind,
        'content_state', jsonb_build_object(
          'checkedInCount', 0,
          'totalAttending', 0,
          'isCheckedIn', false,
          'status', case v_kind when 'cancelled' then 'cancelled' else 'starting' end,
          'startsAt', extract(epoch from NEW.start_date)::int,
          'endsAt', extract(epoch from coalesce(NEW.end_date, NEW.start_date + interval '1 hour'))::int
        ),
        'alert', jsonb_build_object('title', v_title, 'body', v_body),
        'dismissal_date', case v_kind when 'cancelled' then extract(epoch from now())::int end
      )
    );
  end if;

  return NEW;
end;
$$;

comment on function public.enqueue_event_change_push() is
  'Enqueues a standard push and (when active LA tokens exist) a Live Activity update/end job for cancelled/rescheduled/relocated events.';
