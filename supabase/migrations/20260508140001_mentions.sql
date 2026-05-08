-- =============================================================================
-- @mentions — column-based mention lists + push fan-out trigger.
-- =============================================================================
-- Approach: clients responsible for resolving @-strings to user UUIDs at send
-- time and writing them as `mentioned_user_ids uuid[]` on the parent row.
-- This avoids fragile server-side string parsing where two members share a
-- display name.
--
-- A trigger on each surface (chat_messages, discussion_replies, announcements)
-- enqueues a notification_jobs row with category='mention', priority=2 (jumps
-- ahead of standard=5). The dispatcher's quiet-hours gate (Phase B) extends
-- to this category so a 3am ping waits until morning.
-- =============================================================================

-- 1. Columns. All three surfaces get the same shape.
alter table public.chat_messages
  add column if not exists mentioned_user_ids uuid[] not null default '{}';
create index if not exists chat_messages_mentions_gin
  on public.chat_messages using gin (mentioned_user_ids);

alter table public.discussion_replies
  add column if not exists mentioned_user_ids uuid[] not null default '{}';
create index if not exists discussion_replies_mentions_gin
  on public.discussion_replies using gin (mentioned_user_ids);

alter table public.announcements
  add column if not exists mentioned_user_ids uuid[] not null default '{}';
create index if not exists announcements_mentions_gin
  on public.announcements using gin (mentioned_user_ids);

-- 2. Per-user category gate. Defaults true — @mentions are a high-signal
-- transactional notification.
alter table public.notification_preferences
  add column if not exists mention_push_enabled boolean not null default true;

-- 3. Trigger function: extract mentions, exclude the author + any user_ids
-- not in the org's members table, enqueue a single notification_jobs row
-- targeting them.
create or replace function public.enqueue_mention_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := TG_ARGV[0];
  v_targets uuid[];
  v_org uuid := NEW.organization_id;
  v_author uuid;
  v_title text;
  v_body text;
  v_resource_id uuid;
  v_route text;
begin
  if NEW.mentioned_user_ids is null
     or array_length(NEW.mentioned_user_ids, 1) is null then
    return NEW;
  end if;

  -- Author varies by table. The trigger is invoked separately on each
  -- surface so we resolve the author column here.
  if v_kind = 'chat_message' then
    v_author := NEW.author_id;
    v_resource_id := NEW.chat_group_id;
    v_title := 'Mentioned you in chat';
    v_body := left(NEW.body, 140);
  elsif v_kind = 'discussion_reply' then
    v_author := NEW.author_id;
    v_resource_id := NEW.thread_id;
    v_title := 'Mentioned you in a discussion';
    v_body := left(NEW.body, 140);
  elsif v_kind = 'announcement' then
    v_author := NEW.created_by_user_id;
    v_resource_id := NEW.id;
    v_title := 'Mentioned you in an announcement';
    v_body := left(coalesce(NEW.title, ''), 140);
  else
    return NEW;
  end if;

  -- Filter: exclude author from their own mention; require recipients to be
  -- active members of the org.
  select array_agg(distinct uid) into v_targets
  from unnest(NEW.mentioned_user_ids) as uid
  where uid <> v_author
    and exists (
      select 1 from public.members m
      where m.user_id = uid
        and m.organization_id = v_org
        and m.deleted_at is null
    );

  if v_targets is null or array_length(v_targets, 1) is null then
    return NEW;
  end if;

  insert into public.notification_jobs (
    organization_id,
    kind,
    priority,
    audience,
    target_user_ids,
    category,
    push_type,
    push_resource_id,
    title,
    body,
    data,
    status,
    scheduled_for
  ) values (
    v_org,
    'standard',
    2, -- ahead of standard=5 but behind LA=1
    null,
    v_targets,
    'mention',
    'mention',
    v_resource_id,
    v_title,
    v_body,
    jsonb_build_object('mention_kind', v_kind, 'author_id', v_author),
    'pending',
    now()
  );

  return NEW;
end;
$$;

drop trigger if exists chat_messages_mention_push on public.chat_messages;
create trigger chat_messages_mention_push
  after insert on public.chat_messages
  for each row execute function public.enqueue_mention_push('chat_message');

drop trigger if exists discussion_replies_mention_push on public.discussion_replies;
create trigger discussion_replies_mention_push
  after insert on public.discussion_replies
  for each row execute function public.enqueue_mention_push('discussion_reply');

drop trigger if exists announcements_mention_push on public.announcements;
create trigger announcements_mention_push
  after insert on public.announcements
  for each row execute function public.enqueue_mention_push('announcement');

comment on function public.enqueue_mention_push() is
  'Trigger fn: enqueues a single notification_jobs row when a row with mentioned_user_ids is inserted. Filters out author + non-members.';
