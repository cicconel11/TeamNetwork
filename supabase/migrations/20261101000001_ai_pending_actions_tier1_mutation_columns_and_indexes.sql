-- Phase 0b of the Tier 1 edit/delete parity plan. Extends ai_pending_actions
-- to support the new prepare_edit_* / prepare_delete_* tool families without
-- further schema churn once the application code lands.
--
-- Columns:
--   target_entity_{type,id}  Populated at prepare time for edit/delete ops so
--                            resolveAgentActionTarget can index-lookup "most
--                            recent X I touched" without decoding payload jsonb.
--   payload_before           Pre-mutation row snapshot for destructive ops —
--                            forensic trail required by security review A2.5.
--   resolved_target          What the resolver returned at prepare time, distinct
--                            from raw tool args. Lets audits separate model intent
--                            from resolver expansion.
--   attempt_count            Number of times this row has been claimed confirmed.
--                            Surfaces retry behaviour to operators / UI.
--   last_attempt_error       Error classification from the most recent failed
--                            attempt. Cleared on executed.
--   replay_result            Stored response shape so idempotent re-confirms
--                            return identical data, not just { ok: true }.
--
-- Indexes:
--   idx_ai_pending_actions_user_entity_executed
--     Partial composite serving the resolver's "most-recent-entity" fallback.
--     INCLUDE (result_entity_id) enables index-only scan.
--     Columns: (user_id, organization_id, result_entity_type, executed_at DESC, id)
--     id is the deterministic tiebreaker when two actions execute in the same ms.
--   idx_ai_pending_actions_one_pending_per_target
--     Unique partial — prevents concurrent pending mutations on the same entity
--     (two edits, or edit+delete, racing against each other).
--
-- Data safety: all additions are nullable or non-volatile defaults. PG 11+
-- handles ADD COLUMN ... NOT NULL DEFAULT as metadata-only, no table rewrite.
-- Indexes use plain CREATE INDEX per repo convention (see
-- 20260812000003_perf_hotpath_indexes_and_initplan.sql) — Supabase migrations
-- run in a transaction, CONCURRENTLY would fail. ai_pending_actions is
-- TTL-bounded and small, so the brief write lock is acceptable.
--
-- Plan: ~/.claude/plans/i-want-you-to-quirky-sprout.md (Phase 0b; addendum A6).

ALTER TABLE public.ai_pending_actions
  ADD COLUMN IF NOT EXISTS target_entity_type text,
  ADD COLUMN IF NOT EXISTS target_entity_id uuid,
  ADD COLUMN IF NOT EXISTS payload_before jsonb,
  ADD COLUMN IF NOT EXISTS resolved_target jsonb,
  ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_error text,
  ADD COLUMN IF NOT EXISTS replay_result jsonb;

CREATE INDEX IF NOT EXISTS idx_ai_pending_actions_user_entity_executed
  ON public.ai_pending_actions (user_id, organization_id, result_entity_type, executed_at DESC, id)
  INCLUDE (result_entity_id)
  WHERE status = 'executed' AND result_entity_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_pending_actions_one_pending_per_target
  ON public.ai_pending_actions (organization_id, target_entity_type, target_entity_id)
  WHERE status = 'pending' AND target_entity_id IS NOT NULL;
