-- Discussion push fan-out via notification_jobs queue.
--
-- Both the web POST route and the mobile direct insert path land rows in
-- discussion_threads / discussion_replies. To avoid coupling push delivery to
-- the client, we enqueue a notification_jobs row inside an AFTER INSERT
-- trigger. The dispatcher cron (apps/web/src/app/api/cron/notification-dispatch)
-- drains the queue and delivers via Expo, gated by
-- notification_preferences.discussion_push_enabled (default false).

-- New thread → broadcast to whole org (recipient resolver applies preferences).
create or replace function public.enqueue_discussion_thread_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author_name text;
  v_truncated_title text;
begin
  if NEW.deleted_at is not null then
    return NEW;
  end if;

  select coalesce(name, 'A member')
    into v_author_name
    from public.users
    where id = NEW.author_id;

  v_truncated_title := case
    when length(NEW.title) > 80 then substr(NEW.title, 1, 77) || '…'
    else NEW.title
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
    'discussion',
    'discussion',
    NEW.id,
    'New discussion: ' || v_truncated_title,
    coalesce(v_author_name, 'A member') || ' started a new thread',
    jsonb_build_object('threadId', NEW.id)
  );

  return NEW;
end;
$$;

drop trigger if exists discussion_thread_push_trigger on public.discussion_threads;
create trigger discussion_thread_push_trigger
  after insert on public.discussion_threads
  for each row execute function public.enqueue_discussion_thread_push();

-- New reply → push to thread author + prior repliers, minus the new replier.
create or replace function public.enqueue_discussion_reply_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replier_name text;
  v_thread_title text;
  v_thread_author uuid;
  v_targets uuid[];
  v_truncated_body text;
  v_truncated_title text;
begin
  if NEW.deleted_at is not null then
    return NEW;
  end if;

  select coalesce(name, 'A member')
    into v_replier_name
    from public.users
    where id = NEW.author_id;

  select author_id, title
    into v_thread_author, v_thread_title
    from public.discussion_threads
    where id = NEW.thread_id;

  -- Aggregate participants. Exclude the new replier.
  select coalesce(array_agg(distinct user_id), array[]::uuid[])
    into v_targets
  from (
    select v_thread_author as user_id
    union
    select author_id
    from public.discussion_replies
    where thread_id = NEW.thread_id
      and deleted_at is null
      and id <> NEW.id
  ) participants
  where user_id is not null and user_id <> NEW.author_id;

  if array_length(v_targets, 1) is null then
    return NEW;
  end if;

  v_truncated_body := case
    when length(NEW.body) > 140 then substr(NEW.body, 1, 137) || '…'
    else NEW.body
  end;

  v_truncated_title := case
    when length(coalesce(v_thread_title, '')) > 60
      then substr(v_thread_title, 1, 57) || '…'
    else coalesce(v_thread_title, 'Discussion')
  end;

  insert into public.notification_jobs (
    organization_id,
    kind,
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
    v_targets,
    'discussion',
    'discussion',
    NEW.thread_id,
    coalesce(v_replier_name, 'A member') || ' replied: ' || v_truncated_title,
    v_truncated_body,
    jsonb_build_object('threadId', NEW.thread_id, 'replyId', NEW.id)
  );

  return NEW;
end;
$$;

drop trigger if exists discussion_reply_push_trigger on public.discussion_replies;
create trigger discussion_reply_push_trigger
  after insert on public.discussion_replies
  for each row execute function public.enqueue_discussion_reply_push();

comment on function public.enqueue_discussion_thread_push() is
  'Enqueues notification_jobs row for new discussion thread broadcast. Drained by /api/cron/notification-dispatch.';
comment on function public.enqueue_discussion_reply_push() is
  'Enqueues notification_jobs row for thread participants on new reply. Excludes the new replier.';
