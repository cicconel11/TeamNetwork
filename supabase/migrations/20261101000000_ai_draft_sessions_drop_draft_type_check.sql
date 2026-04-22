-- Drop the stale ai_draft_sessions.draft_type CHECK constraint.
--
-- The CHECK has been amended five-plus times as the agent's tool surface has
-- grown (create_announcement, send_chat_message, create_event, reply/chat
-- variants, etc.). Tier 1 edit/delete parity adds more draft_type values and
-- further tiers will add more; each amendment is another DDL change with
-- production lock exposure on a hot-path table.
--
-- Validation moves to the TypeScript layer. Phase 1a lands a Zod enum gate
-- inside saveDraftSession keyed on DRAFT_SESSION_TYPES. Until Phase 1a ships,
-- DraftSessionType in src/lib/ai/draft-sessions.ts is the de-facto gate —
-- every caller is type-checked against the union.
--
-- Plan: ~/.claude/plans/i-want-you-to-quirky-sprout.md (Phase 0a; addendum A6).

ALTER TABLE public.ai_draft_sessions
  DROP CONSTRAINT IF EXISTS ai_draft_sessions_draft_type_check;
