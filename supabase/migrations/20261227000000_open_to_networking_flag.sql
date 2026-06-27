-- open_to_networking: one self-set networking-consent flag across people tables.
--
-- A single consent primitive applied per-role to members, alumni, AND parents
-- (not three different flags). The connections "People You Should Meet" engine
-- reads it as the source/candidate eligibility signal:
--   * alumni → alumni candidate edges surface only when the SOURCE opted in;
--   * a parent is a candidate / messageable only when that parent opted in.
-- members ↔ alumni edges are unaffected (already shipped, no consent required).
--
-- Default false, additive, no backfill: opting in is an explicit user choice.

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS open_to_networking boolean NOT NULL DEFAULT false;

ALTER TABLE public.alumni
  ADD COLUMN IF NOT EXISTS open_to_networking boolean NOT NULL DEFAULT false;

ALTER TABLE public.parents
  ADD COLUMN IF NOT EXISTS open_to_networking boolean NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- Owner-only enforcement (column-level, defense in depth).
--
-- The existing *_update row policies allow BOTH the row owner AND org admins to
-- update a row. That is correct for ordinary profile edits, but networking
-- consent must belong to the PERSON, never an admin: an admin must not be able
-- to flip someone else's open_to_networking, and an unclaimed row (user_id NULL)
-- must never be opted in. The row policies can't express a per-column rule, so a
-- BEFORE UPDATE trigger guards just this column: if open_to_networking changes,
-- the caller must be the row owner (auth.uid() = user_id). This also blocks
-- unclaimed rows (auth.uid() = NULL is never true) and service-role writes
-- (no JWT) — the self-consent API therefore writes on the user (RLS) client.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_open_to_networking_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.open_to_networking IS DISTINCT FROM OLD.open_to_networking THEN
    IF NEW.user_id IS NULL OR auth.uid() IS NULL OR auth.uid() <> NEW.user_id THEN
      RAISE EXCEPTION 'open_to_networking can only be changed by the row owner'
        USING ERRCODE = '42501'; -- insufficient_privilege
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS members_open_to_networking_owner ON public.members;
CREATE TRIGGER members_open_to_networking_owner
  BEFORE UPDATE ON public.members
  FOR EACH ROW
  WHEN (NEW.open_to_networking IS DISTINCT FROM OLD.open_to_networking)
  EXECUTE FUNCTION public.enforce_open_to_networking_owner();

DROP TRIGGER IF EXISTS alumni_open_to_networking_owner ON public.alumni;
CREATE TRIGGER alumni_open_to_networking_owner
  BEFORE UPDATE ON public.alumni
  FOR EACH ROW
  WHEN (NEW.open_to_networking IS DISTINCT FROM OLD.open_to_networking)
  EXECUTE FUNCTION public.enforce_open_to_networking_owner();

DROP TRIGGER IF EXISTS parents_open_to_networking_owner ON public.parents;
CREATE TRIGGER parents_open_to_networking_owner
  BEFORE UPDATE ON public.parents
  FOR EACH ROW
  WHEN (NEW.open_to_networking IS DISTINCT FROM OLD.open_to_networking)
  EXECUTE FUNCTION public.enforce_open_to_networking_owner();

-- Partial indexes: the engine filters candidates/parents by open_to_networking
-- per org; these keep the opted-in scan off the full tables.
CREATE INDEX IF NOT EXISTS idx_alumni_open_to_networking
  ON public.alumni (organization_id)
  WHERE open_to_networking AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_parents_open_to_networking
  ON public.parents (organization_id)
  WHERE open_to_networking AND deleted_at IS NULL;
