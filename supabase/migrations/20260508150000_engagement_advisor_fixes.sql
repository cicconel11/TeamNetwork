-- =============================================================================
-- Advisor follow-ups for PR #206 (engagement: streaks/badges/reactions/mentions).
-- =============================================================================
-- 1. Pin search_path on tg_member_streaks_updated_at (function_search_path_mutable).
-- 2. Wrap auth.uid() in (select auth.uid()) on the 5 new RLS policies so the
--    planner caches the value once per query (auth_rls_initplan).
-- 3. Add covering indexes for the unindexed foreign keys flagged on
--    member_badges.badge_id and reactions.organization_id.
-- =============================================================================

-- 1. Lock down search_path on the streaks updated_at trigger.
create or replace function public.tg_member_streaks_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 2. Re-create RLS policies with (select auth.uid()) so RLS init-plan caches.

-- member_streaks
drop policy if exists member_streaks_select_same_org on public.member_streaks;
create policy member_streaks_select_same_org
  on public.member_streaks
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.members m
      where m.organization_id = public.member_streaks.organization_id
        and m.user_id = (select auth.uid())
        and m.deleted_at is null
    )
  );

-- member_badges
drop policy if exists member_badges_select_same_org on public.member_badges;
create policy member_badges_select_same_org
  on public.member_badges
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.members m
      where m.organization_id = public.member_badges.organization_id
        and m.user_id = (select auth.uid())
        and m.deleted_at is null
    )
  );

-- reactions: select / insert / delete
drop policy if exists reactions_select_same_org on public.reactions;
create policy reactions_select_same_org
  on public.reactions for select to authenticated
  using (
    exists (
      select 1 from public.members m
      where m.organization_id = reactions.organization_id
        and m.user_id = (select auth.uid())
        and m.deleted_at is null
    )
  );

drop policy if exists reactions_insert_self on public.reactions;
create policy reactions_insert_self
  on public.reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.members m
      where m.organization_id = reactions.organization_id
        and m.user_id = (select auth.uid())
        and m.deleted_at is null
    )
  );

drop policy if exists reactions_delete_self on public.reactions;
create policy reactions_delete_self
  on public.reactions for delete to authenticated
  using (user_id = (select auth.uid()));

-- 3. Cover the FKs flagged by the advisor.
create index if not exists member_badges_badge_id_idx
  on public.member_badges (badge_id);

create index if not exists reactions_organization_id_idx
  on public.reactions (organization_id);
