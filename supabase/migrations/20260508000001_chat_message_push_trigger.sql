-- Chat message push fan-out via notification_jobs queue.
--
-- AFTER INSERT trigger on chat_messages enqueues one notification_jobs row per
-- approved message. Recipients = all active chat_group_members minus the
-- author. Per-user gating via notification_preferences.chat_push_enabled is
-- applied later in sendPush. Pending-approval messages are skipped (the
-- approval flow can fire its own push when transitioning to 'approved' if
-- desired — out of scope here).

create or replace function public.enqueue_chat_message_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author_name text;
  v_group_name text;
  v_recipient_ids uuid[];
  v_truncated_body text;
begin
  -- Skip pending-moderation, deleted, or self-only messages.
  if NEW.deleted_at is not null then
    return NEW;
  end if;
  if NEW.status is distinct from 'approved' then
    return NEW;
  end if;

  -- Recipients: active group members other than the author.
  select coalesce(array_agg(distinct user_id), array[]::uuid[])
    into v_recipient_ids
  from public.chat_group_members
  where chat_group_id = NEW.chat_group_id
    and removed_at is null
    and user_id <> NEW.author_id;

  if array_length(v_recipient_ids, 1) is null then
    return NEW;
  end if;

  select coalesce(name, 'Sender')
    into v_author_name
    from public.users
    where id = NEW.author_id;

  select coalesce(name, 'Chat')
    into v_group_name
    from public.chat_groups
    where id = NEW.chat_group_id;

  v_truncated_body := case
    when length(NEW.body) > 140 then substr(NEW.body, 1, 137) || '…'
    else NEW.body
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
    v_recipient_ids,
    'chat',
    'chat',
    NEW.chat_group_id,
    coalesce(v_author_name, 'Sender') || ' • ' || coalesce(v_group_name, 'Chat'),
    v_truncated_body,
    jsonb_build_object('chatGroupId', NEW.chat_group_id, 'messageId', NEW.id)
  );

  return NEW;
end;
$$;

drop trigger if exists chat_message_push_trigger on public.chat_messages;
create trigger chat_message_push_trigger
  after insert on public.chat_messages
  for each row execute function public.enqueue_chat_message_push();

comment on function public.enqueue_chat_message_push() is
  'Enqueues notification_jobs row per approved chat message. Recipients: active group members minus author.';
