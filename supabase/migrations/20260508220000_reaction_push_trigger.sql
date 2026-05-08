-- Reaction push fan-out — mirrors the chat_message / job_posting triggers.
-- AFTER INSERT on `reactions` (target_kind='chat_message' only for now)
-- enqueues one notification_jobs row addressed to the message author so they
-- get a push when someone likes/hearts their chat message. Drained by
-- /api/cron/notification-dispatch and gated by reaction_push_enabled.

-- 1. Per-user push preference column. Default true — reactions are
-- direct social signals on the user's own content, similar to chat default.
alter table public.notification_preferences
  add column if not exists reaction_push_enabled boolean not null default true;

comment on column public.notification_preferences.reaction_push_enabled is
  'Per-user gate for emoji reaction push notifications on the user''s own messages. Default true.';

-- 2. Trigger function: notify the chat message author when someone reacts.
create or replace function public.enqueue_reaction_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reactor_name text;
  v_target_author_id uuid;
  v_chat_group_id uuid;
  v_group_name text;
  v_message_excerpt text;
begin
  -- Scope to chat message reactions for now. Discussion replies and
  -- announcement reactions can be added in a follow-up if desired.
  if NEW.target_kind <> 'chat_message' then
    return NEW;
  end if;

  select cm.author_id, cm.chat_group_id,
         case
           when length(coalesce(cm.body, '')) > 80
             then substr(cm.body, 1, 77) || '…'
           else coalesce(cm.body, '')
         end
    into v_target_author_id, v_chat_group_id, v_message_excerpt
    from public.chat_messages cm
    where cm.id = NEW.target_id
      and cm.deleted_at is null;

  -- Author missing (deleted message) or self-reaction → nothing to send.
  if v_target_author_id is null or v_target_author_id = NEW.user_id then
    return NEW;
  end if;

  select coalesce(name, 'Someone')
    into v_reactor_name
    from public.users
    where id = NEW.user_id;

  select coalesce(name, 'Chat')
    into v_group_name
    from public.chat_groups
    where id = v_chat_group_id;

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
    array[v_target_author_id],
    'reaction',
    'reaction',
    v_chat_group_id,
    coalesce(v_reactor_name, 'Someone') || ' reacted ' || NEW.emoji,
    case
      when length(v_message_excerpt) > 0
        then 'in ' || coalesce(v_group_name, 'Chat') || ': "' || v_message_excerpt || '"'
      else 'reacted to your message in ' || coalesce(v_group_name, 'Chat')
    end,
    jsonb_build_object(
      'targetKind', NEW.target_kind,
      'chatGroupId', v_chat_group_id,
      'messageId', NEW.target_id,
      'emoji', NEW.emoji,
      'reactorId', NEW.user_id
    )
  );

  return NEW;
end;
$$;

drop trigger if exists reaction_push_trigger on public.reactions;
create trigger reaction_push_trigger
  after insert on public.reactions
  for each row execute function public.enqueue_reaction_push();

comment on function public.enqueue_reaction_push() is
  'Enqueues notification_jobs row when a user reacts to a chat message. Notifies the message author only.';
