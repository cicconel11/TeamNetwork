-- =============================================================================
-- reactions — polymorphic emoji reactions across chat / discussions / announcements.
-- =============================================================================
-- One row per (target, user, emoji). The (target_kind, target_id) pair points
-- at chat_messages / discussion_replies / announcements respectively.
-- Polymorphism keeps the table count down and lets one query power "give me
-- reactions on this object" regardless of source. RLS is enforced by joining
-- back to the parent table's org so a user can only see/write reactions on
-- objects in orgs they belong to.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'reaction_target_kind') then
    create type public.reaction_target_kind as enum (
      'chat_message',
      'discussion_reply',
      'announcement'
    );
  end if;
end $$;

create table if not exists public.reactions (
  id uuid primary key default gen_random_uuid(),
  target_kind public.reaction_target_kind not null,
  target_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  emoji text not null check (length(emoji) between 1 and 16),
  created_at timestamptz not null default now()
);

-- One reaction per (target, user, emoji). User can react with multiple emoji
-- to the same message but not the same emoji twice.
create unique index if not exists reactions_unique_per_user_emoji
  on public.reactions (target_kind, target_id, user_id, emoji);

-- Aggregate query: "all reactions on this target" sorted by created_at.
create index if not exists reactions_target_idx
  on public.reactions (target_kind, target_id, created_at);

create index if not exists reactions_user_idx
  on public.reactions (user_id);

alter table public.reactions enable row level security;

-- SELECT: org members can read reactions on objects belonging to their org.
drop policy if exists reactions_select_same_org on public.reactions;
create policy reactions_select_same_org
  on public.reactions for select to authenticated
  using (
    exists (
      select 1 from public.members m
      where m.organization_id = reactions.organization_id
        and m.user_id = auth.uid()
        and m.deleted_at is null
    )
  );

-- INSERT: user is the actor and they belong to the target's org.
drop policy if exists reactions_insert_self on public.reactions;
create policy reactions_insert_self
  on public.reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.members m
      where m.organization_id = reactions.organization_id
        and m.user_id = auth.uid()
        and m.deleted_at is null
    )
  );

-- DELETE: only the user who reacted can remove their own reaction.
drop policy if exists reactions_delete_self on public.reactions;
create policy reactions_delete_self
  on public.reactions for delete to authenticated
  using (user_id = auth.uid());

comment on table public.reactions is
  'Polymorphic emoji reactions across chat_messages, discussion_replies, announcements. Unique per (target, user, emoji).';
