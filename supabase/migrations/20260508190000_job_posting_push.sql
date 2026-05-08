-- Job posting push fan-out — mirrors the discussion / chat / event push
-- triggers added earlier. Mobile creates job_postings rows directly via
-- Supabase, so the trigger keeps push delivery decoupled from the client.
-- The dispatcher (apps/web/src/app/api/cron/notification-dispatch) drains
-- the queue and delivers via Expo, gated by
-- notification_preferences.job_push_enabled.

-- 1. Per-user push preference column. Default true — job posts are admin-
-- composed broadcasts so the noise level is low and users tend to want them.
alter table public.notification_preferences
  add column if not exists job_push_enabled boolean not null default true;

comment on column public.notification_preferences.job_push_enabled is
  'Per-user gate for job posting push notifications. Default true.';

-- 2. Trigger function: org-wide broadcast on each new job_posting.
create or replace function public.enqueue_job_posting_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_poster_name text;
  v_truncated_title text;
  v_company_clause text;
begin
  if NEW.deleted_at is not null then
    return NEW;
  end if;

  select coalesce(name, 'A member')
    into v_poster_name
    from public.users
    where id = NEW.posted_by;

  v_truncated_title := case
    when length(coalesce(NEW.title, '')) > 80
      then substr(NEW.title, 1, 77) || '…'
    else coalesce(NEW.title, 'New job posting')
  end;

  v_company_clause := case
    when NEW.company is not null and length(NEW.company) > 0
      then ' at ' || NEW.company
    else ''
  end;

  insert into public.notification_jobs (
    organization_id,
    kind,
    audience,
    category,
    push_type,
    push_resource_id,
    title,
    body,
    data
  ) values (
    NEW.organization_id,
    'standard',
    'all',
    'job',
    'job',
    NEW.id,
    'New job: ' || v_truncated_title,
    coalesce(v_poster_name, 'A member') || ' posted a new job' || v_company_clause,
    jsonb_build_object('jobId', NEW.id)
  );

  return NEW;
end;
$$;

drop trigger if exists job_posting_push_trigger on public.job_postings;
create trigger job_posting_push_trigger
  after insert on public.job_postings
  for each row execute function public.enqueue_job_posting_push();

comment on function public.enqueue_job_posting_push() is
  'Enqueues notification_jobs row broadcasting a new job posting to the org. Drained by /api/cron/notification-dispatch.';
