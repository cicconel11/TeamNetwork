update public.forms
set fields = (
  with patched_fields as (
    select
      case
        when exists (
          select 1
          from jsonb_array_elements(
            case
              when exists (
                select 1
                from jsonb_array_elements(forms.fields) existing_field
                where existing_field->>'id' = 'preferred_sports'
              )
                then forms.fields
                else forms.fields || jsonb_build_array(
                  jsonb_build_object(
                    'id', 'preferred_sports',
                    'type', 'multiselect',
                    'label', 'Preferred sport',
                    'required', false,
                    'options', jsonb_build_array(
                      'Basketball',
                      'Football',
                      'Baseball',
                      'Softball',
                      'Soccer',
                      'Volleyball',
                      'Track and Field',
                      'Swimming',
                      'Tennis',
                      'Golf',
                      'Lacrosse',
                      'Wrestling',
                      'Rowing',
                      'Field Hockey',
                      'Ice Hockey',
                      'Gymnastics'
                    )
                  )
                )
            end
          ) existing_field
          where existing_field->>'id' = 'preferred_positions'
        )
          then
            case
              when exists (
                select 1
                from jsonb_array_elements(forms.fields) existing_field
                where existing_field->>'id' = 'preferred_sports'
              )
                then forms.fields
                else forms.fields || jsonb_build_array(
                  jsonb_build_object(
                    'id', 'preferred_sports',
                    'type', 'multiselect',
                    'label', 'Preferred sport',
                    'required', false,
                    'options', jsonb_build_array(
                      'Basketball',
                      'Football',
                      'Baseball',
                      'Softball',
                      'Soccer',
                      'Volleyball',
                      'Track and Field',
                      'Swimming',
                      'Tennis',
                      'Golf',
                      'Lacrosse',
                      'Wrestling',
                      'Rowing',
                      'Field Hockey',
                      'Ice Hockey',
                      'Gymnastics'
                    )
                  )
                )
            end
        else
          (
            case
              when exists (
                select 1
                from jsonb_array_elements(forms.fields) existing_field
                where existing_field->>'id' = 'preferred_sports'
              )
                then forms.fields
                else forms.fields || jsonb_build_array(
                  jsonb_build_object(
                    'id', 'preferred_sports',
                    'type', 'multiselect',
                    'label', 'Preferred sport',
                    'required', false,
                    'options', jsonb_build_array(
                      'Basketball',
                      'Football',
                      'Baseball',
                      'Softball',
                      'Soccer',
                      'Volleyball',
                      'Track and Field',
                      'Swimming',
                      'Tennis',
                      'Golf',
                      'Lacrosse',
                      'Wrestling',
                      'Rowing',
                      'Field Hockey',
                      'Ice Hockey',
                      'Gymnastics'
                    )
                  )
                )
            end
          ) || jsonb_build_array(
            jsonb_build_object(
              'id', 'preferred_positions',
              'type', 'multiselect',
              'label', 'Preferred position or role',
              'required', false,
              'options', jsonb_build_array(
                'Quarterback',
                'Running Back',
                'Wide Receiver',
                'Linebacker',
                'Defender',
                'Midfielder',
                'Forward',
                'Goalkeeper',
                'Pitcher',
                'Catcher',
                'Point Guard',
                'Shooting Guard',
                'Center',
                'Setter',
                'Libero',
                'Outside Hitter',
                'Coach'
              )
            )
          )
      end as fields
  )
  select jsonb_agg(
    case
      when field->>'id' = 'mentor_attributes_required'
        then jsonb_set(
          field,
          '{options}',
          jsonb_build_array(
            'same_industry',
            'same_role_family',
            'same_sport',
            'same_position',
            'alumni_of_org',
            'local',
            'female',
            'veteran',
            'first_gen'
          )
        )
      when field->>'id' = 'mentor_attributes_nice_to_have'
        then jsonb_set(
          field,
          '{options}',
          jsonb_build_array(
            'same_industry',
            'same_role_family',
            'same_sport',
            'same_position',
            'alumni_of_org',
            'local',
            'female',
            'veteran',
            'first_gen'
          )
        )
      else field
    end
  )
  from patched_fields,
    lateral jsonb_array_elements(patched_fields.fields) field
)
where system_key = 'mentee_intake_v1'
  and deleted_at is null;
