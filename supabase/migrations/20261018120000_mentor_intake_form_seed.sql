-- Mentorship Phase 2 follow-up: seed canonical mentor_intake form.
--
-- Mirrors the mentee_intake_v1 seed from 20261018000000_mentorship_phase2.sql
-- but captures the mentor side of the match (what the mentor offers, their
-- sport/position background, and capacity preferences).
--
-- Idempotent: only inserts when the org does not already have a mentor_intake
-- form. form_kind + system_key are immutable per the forms_enforce_system_invariants
-- trigger added in the Phase 2 migration, so re-runs are safe.
begin;

with mentor_intake_fields as (
  select jsonb_build_array(
    jsonb_build_object(
      'id','bio','type','textarea','label','Short bio',
      'required',true,
      'description','A paragraph mentees will see in your directory listing.'
    ),
    jsonb_build_object(
      'id','expertise_areas','type','multiselect','label','Expertise areas',
      'required',true,
      'options', jsonb_build_array(
        'finance','career-pivot','recruiting','leadership','wellness',
        'entrepreneurship','networking','job-search','coaching','mental-health'
      )
    ),
    jsonb_build_object(
      'id','industry','type','select','label','Primary industry',
      'required',false,
      'options', jsonb_build_array(
        'Technology','Finance','Healthcare','Media','Consulting','Law',
        'Aerospace','Real Estate','Nonprofit','Sports','Education'
      )
    ),
    jsonb_build_object(
      'id','role_family','type','select','label','Job field',
      'required',false,
      'options', jsonb_build_array(
        'Engineering','Product','Data','Finance','Consulting','Healthcare',
        'Law','Media','Operations','Research','Sports','Education'
      )
    ),
    jsonb_build_object(
      'id','sports','type','multiselect','label','Sport background',
      'required',false,
      'description','Sports you played or coached — mentees can filter on same_sport.',
      'options', jsonb_build_array(
        'Basketball','Football','Baseball','Softball','Soccer','Volleyball',
        'Track and Field','Swimming','Tennis','Golf','Lacrosse','Wrestling',
        'Rowing','Field Hockey','Ice Hockey','Gymnastics'
      )
    ),
    jsonb_build_object(
      'id','positions','type','multiselect','label','Position or role',
      'required',false,
      'description','Positions you played or coached — mentees can filter on same_position.',
      'options', jsonb_build_array(
        'Quarterback','Running Back','Wide Receiver','Linebacker','Defender',
        'Midfielder','Forward','Goalkeeper','Pitcher','Catcher',
        'Point Guard','Shooting Guard','Center','Setter','Libero',
        'Outside Hitter','Coach'
      )
    ),
    jsonb_build_object(
      'id','max_mentees','type','select','label','How many mentees can you take?',
      'required',true,
      'options', jsonb_build_array('1','2','3','4','5')
    ),
    jsonb_build_object(
      'id','time_commitment','type','select','label','Time commitment',
      'required',true,
      'options', jsonb_build_array('1hr/month','2hr/month','4hr/month','flexible')
    ),
    jsonb_build_object(
      'id','meeting_preferences','type','multiselect','label','Meeting preferences',
      'required',false,
      'options', jsonb_build_array('video','phone','in_person','async')
    ),
    jsonb_build_object(
      'id','accepting_new','type','select','label','Accepting new mentees right now?',
      'required',true,
      'options', jsonb_build_array('yes','no')
    )
  ) as fields
)
insert into public.forms (organization_id, title, description, fields, is_active, system_key, form_kind)
select o.id,
       'Mentor Intake',
       'Tell us about your mentorship availability and background so we can match you with the right mentees.',
       (select fields from mentor_intake_fields),
       true,
       'mentor_intake_v1',
       'mentor_intake'
  from public.organizations o
 where not exists (
   select 1 from public.forms f
    where f.organization_id = o.id
      and f.system_key = 'mentor_intake_v1'
 );

commit;
