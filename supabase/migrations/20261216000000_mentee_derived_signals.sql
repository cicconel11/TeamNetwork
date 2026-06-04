-- Mentorship: LLM/deterministic derived matching signals for data-thin mentees.
--
-- Context:
--   Students rarely fill the structured mentee_preferences arrays, so the
--   overlap-based matcher produces empty or weak rankings. We derive canonical
--   industries/role-families/topics/skills from their free-text goals (+ major)
--   — deterministically first, with a constrained LLM fallback — and persist
--   them so the ranker fires at match time with NO per-request LLM call.
--
--   Also adds cached "why" prose columns on mentorship_pairs (populated when an
--   admin confirms a pairing) so confirmed pairs can show a human explanation
--   without re-calling the LLM.
--
-- Idempotent: safe to re-run.
begin;

-- =============================================================================
-- 1. Derived-signal columns on mentee_preferences
-- =============================================================================

alter table public.mentee_preferences
  add column if not exists derived_signals jsonb,
  add column if not exists derived_signals_input_hash text;

comment on column public.mentee_preferences.derived_signals is
  'Canonical matching signals derived from goals/major: {industries[],roleFamilies[],topics[],skills[],model,updated_at}. Enriches (never overrides) the structured preference arrays at match time.';
comment on column public.mentee_preferences.derived_signals_input_hash is
  'Hash of the inputs (goals/focus/major) the derived_signals were computed from. Used to skip recomputation when inputs are unchanged.';

-- =============================================================================
-- 2. Cached "why" prose on mentorship_pairs
-- =============================================================================

alter table public.mentorship_pairs
  add column if not exists match_why text,
  add column if not exists match_why_model text;

comment on column public.mentorship_pairs.match_why is
  'Human-readable explanation of why this pair was matched, generated from match_signals at proposal/confirm time. Falls back to a deterministic template when the LLM is unavailable.';
comment on column public.mentorship_pairs.match_why_model is
  'Model that produced match_why ("template" when deterministic).';

-- =============================================================================
-- 3. upsert_mentee_derived_signals RPC (service_role only)
-- =============================================================================
-- Writes are performed by the server (service client) after computing signals.
-- SECURITY DEFINER + locked-down grants keep this off the public API surface,
-- mirroring admin_propose_pair.

create or replace function public.upsert_mentee_derived_signals(
  p_organization_id uuid,
  p_user_id uuid,
  p_signals jsonb,
  p_input_hash text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.mentee_preferences
     set derived_signals = p_signals,
         derived_signals_input_hash = p_input_hash,
         updated_at = now()
   where organization_id = p_organization_id
     and user_id = p_user_id;
end;
$$;

revoke all on function public.upsert_mentee_derived_signals(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.upsert_mentee_derived_signals(uuid, uuid, jsonb, text) to service_role;

commit;
