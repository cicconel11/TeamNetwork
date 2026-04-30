-- Per-org monthly AI spend cap.
-- One row per (org, calendar UTC month). Service-role only writes.
-- Admins of the org may read their own ledger rows.

CREATE TABLE IF NOT EXISTS public.ai_spend_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_start    date NOT NULL,
  spend_microusd  bigint NOT NULL DEFAULT 0,
  request_count   integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_ai_spend_ledger_org_period
  ON public.ai_spend_ledger(org_id, period_start DESC);

ALTER TABLE public.ai_spend_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_spend_ledger_admin_select ON public.ai_spend_ledger;
CREATE POLICY ai_spend_ledger_admin_select ON public.ai_spend_ledger
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_organization_roles uor
      WHERE uor.user_id = auth.uid()
        AND uor.organization_id = ai_spend_ledger.org_id
        AND uor.role = 'admin'
        AND uor.status = 'active'
    )
  );

ALTER TABLE public.organization_subscriptions
  ADD COLUMN IF NOT EXISTS ai_monthly_cap_cents integer;

COMMENT ON COLUMN public.organization_subscriptions.ai_monthly_cap_cents IS
  'Per-org override for monthly AI spend cap (cents). NULL falls back to AI_SPEND_CAP_CENTS env (default 2200 = $22).';

-- Atomic charge: insert or increment in one statement, returns post-charge state.
CREATE OR REPLACE FUNCTION public.charge_ai_spend(
  p_org_id   uuid,
  p_microusd bigint
) RETURNS TABLE (
  spend_microusd bigint,
  period_start   date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period date := date_trunc('month', timezone('UTC', now()))::date;
BEGIN
  RETURN QUERY
  INSERT INTO public.ai_spend_ledger AS l (org_id, period_start, spend_microusd, request_count)
    VALUES (p_org_id, v_period, GREATEST(p_microusd, 0), 1)
    ON CONFLICT (org_id, period_start) DO UPDATE
      SET spend_microusd = l.spend_microusd + EXCLUDED.spend_microusd,
          request_count  = l.request_count + 1,
          updated_at     = now()
    RETURNING l.spend_microusd, l.period_start;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.charge_ai_spend(uuid, bigint) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.charge_ai_spend(uuid, bigint) TO service_role;

-- Read-only helper for pre-call gate. Returns 0 spend if no row exists yet.
CREATE OR REPLACE FUNCTION public.get_ai_spend_for_period(p_org_id uuid)
RETURNS TABLE (spend_microusd bigint, period_start date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(l.spend_microusd, 0)::bigint, q.p::date
  FROM (SELECT date_trunc('month', timezone('UTC', now()))::date AS p) q
  LEFT JOIN public.ai_spend_ledger l
    ON l.org_id = p_org_id AND l.period_start = q.p;
$$;

REVOKE EXECUTE ON FUNCTION public.get_ai_spend_for_period(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_ai_spend_for_period(uuid) TO service_role;
