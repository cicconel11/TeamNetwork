-- Replace self_check_in_event so geofence enforcement uses real GPS distance
-- (Haversine) instead of trusting a boolean "I'm at the venue" from the client.
-- The mobile app captures the user's GPS via expo-location and passes p_lat/p_lng;
-- p_venue_confirmed is kept for backward compatibility with older clients but is
-- only honored when both coords are null (i.e. clients that pre-date GPS capture).

create or replace function public.self_check_in_event(
  p_event_id uuid,
  p_lat double precision default null,
  p_lng double precision default null,
  p_venue_confirmed boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_event record;
  v_distance_m double precision;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  select
    e.id, e.organization_id, e.geofence_enabled, e.geofence_radius_m,
    e.latitude, e.longitude, e.location as ev_location, e.check_in_mode
  into v_event
  from public.events e
  where e.id = p_event_id and e.deleted_at is null;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Event not found');
  end if;

  if not public.has_active_role(
    v_event.organization_id,
    array['admin', 'active_member', 'alumni', 'parent']::text[]
  ) then
    return jsonb_build_object('success', false, 'error', 'Not a member of this organization');
  end if;

  if v_event.check_in_mode is not null and v_event.check_in_mode <> 'qr' then
    return jsonb_build_object('success', false, 'error', 'This event does not use QR check-in.');
  end if;

  if coalesce(v_event.geofence_enabled, false) then
    -- Modern client: validate against real GPS via Haversine.
    if p_lat is not null and p_lng is not null then
      if v_event.latitude is null or v_event.longitude is null then
        return jsonb_build_object(
          'success', false,
          'error', 'This event is missing a venue location.'
        );
      end if;

      v_distance_m := 6371000.0 * 2.0 * asin(sqrt(
        sin(radians((p_lat - v_event.latitude) / 2.0)) ^ 2 +
        cos(radians(v_event.latitude)) * cos(radians(p_lat)) *
        sin(radians((p_lng - v_event.longitude) / 2.0)) ^ 2
      ));

      if v_distance_m > coalesce(v_event.geofence_radius_m, 100) then
        return jsonb_build_object(
          'success', false,
          'error', format(
            'You''re %s m from the venue. You must be within %s m.',
            round(v_distance_m)::text,
            coalesce(v_event.geofence_radius_m, 100)::text
          ),
          'distance_m', round(v_distance_m)
        );
      end if;
    else
      -- Legacy client (pre-GPS) only sends p_venue_confirmed. Require a non-empty
      -- venue string AND the confirmation flag, exactly like the old behavior.
      if length(trim(coalesce(v_event.ev_location, ''))) < 1 then
        return jsonb_build_object(
          'success', false,
          'error', 'This event needs a location before self check-in with venue verification.'
        );
      end if;
      if not coalesce(p_venue_confirmed, false) then
        return jsonb_build_object(
          'success', false,
          'error', 'Open the venue in Apple Maps, then confirm you''re there before checking in.'
        );
      end if;
    end if;
  end if;

  perform set_config('app.allow_self_event_check_in', '1', true);

  -- Preserve the original arrival timestamp on repeat calls. We only set
  -- checked_in_at / checked_in_by when the row hasn't been checked in yet,
  -- so the audit trail reflects first-arrival, not the latest tap.
  insert into public.event_rsvps (event_id, user_id, organization_id, status, checked_in_at, checked_in_by)
  values (p_event_id, v_uid, v_event.organization_id, 'attending', now(), v_uid)
  on conflict (event_id, user_id) do update set
    status = 'attending',
    checked_in_at = coalesce(public.event_rsvps.checked_in_at, excluded.checked_in_at),
    checked_in_by = coalesce(public.event_rsvps.checked_in_by, excluded.checked_in_by),
    updated_at = now();

  perform set_config('app.allow_self_event_check_in', '0', true);
  return jsonb_build_object('success', true);
exception when others then
  perform set_config('app.allow_self_event_check_in', '0', true);
  raise;
end;
$function$;
