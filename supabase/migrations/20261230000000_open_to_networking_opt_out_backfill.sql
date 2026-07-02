-- Switch members + alumni networking consent to an opt-out model.
--
-- 20261227000000 shipped open_to_networking as opt-in (default false, no
-- backfill), but the engine only gated parents and alumni→alumni edges, so the
-- consent toggle's promise ("turn this off to stay out of others' suggestions")
-- was a no-op for members and alumni. The engine now enforces candidate consent
-- for every person type (isConnectionEdgeAllowed in
-- apps/web/src/lib/people-graph/suggestions.ts); without a backfill that would
-- empty the suggestions surface overnight, since nobody has opted in yet.
--
-- Opt-out preserves today's observed visibility exactly — members and alumni
-- are currently suggestible regardless of the flag — while making the toggle
-- real: turning it off now genuinely hides the person. Parents keep the
-- stricter opt-in default (false); their visibility has been consent-gated
-- since day one.
--
-- The owner-only BEFORE UPDATE triggers from 20261227000000 reject any
-- open_to_networking change not made by the row owner, including this
-- migration's backfill (no auth.uid()), so they are disabled around the UPDATE.

ALTER TABLE public.members DISABLE TRIGGER members_open_to_networking_owner;
ALTER TABLE public.alumni  DISABLE TRIGGER alumni_open_to_networking_owner;

UPDATE public.members SET open_to_networking = true WHERE open_to_networking = false;
UPDATE public.alumni  SET open_to_networking = true WHERE open_to_networking = false;

ALTER TABLE public.members ENABLE TRIGGER members_open_to_networking_owner;
ALTER TABLE public.alumni  ENABLE TRIGGER alumni_open_to_networking_owner;

-- New member/alumni rows start opted in (opt-out model). Parents keep DEFAULT false.
ALTER TABLE public.members ALTER COLUMN open_to_networking SET DEFAULT true;
ALTER TABLE public.alumni  ALTER COLUMN open_to_networking SET DEFAULT true;
