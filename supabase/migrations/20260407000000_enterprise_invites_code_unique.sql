-- Enforce uniqueness on enterprise_invites.code.
--
-- Context: migration 20260403231320_drop_unused_indexes dropped
-- enterprise_invites_code_idx on the premise that it had zero scans. The
-- drop was correct for *query performance*, but it left `code` with no
-- UNIQUE constraint at all — only the primary key on `id` and a UNIQUE
-- on `token` remained. Two invites could in principle share the same
-- code and nothing in the schema would stop it.
--
-- Verified on 2026-04-07 that the live table has zero duplicate codes
-- and zero NULLs, so a plain UNIQUE is safe to add without a backfill.
ALTER TABLE public.enterprise_invites
  ADD CONSTRAINT enterprise_invites_code_key UNIQUE (code);
